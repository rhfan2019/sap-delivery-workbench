import { renderPrompt } from '../item-workspace/development-prompts.mjs';
import { createRecorder, readTrace } from './diagnostics/recorder.mjs';
import { analyzeRun } from './diagnostics/analyzer.mjs';
import { lockSession, recoverInterruptedRuns } from './session-lock.mjs';
import { registerAgentAttachments, readyAttachments } from './attachments.mjs';
import { randomUUID } from 'node:crypto';
import { answerDecision } from './decisions.mjs';
import { readSessionState, isReviewContinuation, readingForRun } from './session-state.mjs';
import { planRun } from './coordinator.mjs';
import { conversation, createConversation, saveRevision } from './repository.mjs';
import { connectSelected, resolveTargetSelection } from './selection.mjs';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { deliveryContext } from '../delivery/context.mjs';
import { buildContext } from '../item-workspace/development-context.mjs';
import { pinAssociation, createProfileResolver } from './selection.mjs';
const runtimeSchema = JSON.parse(
  readFileSync(
    new URL(import.meta.resolve('@sap-delivery-workbench/contracts/agent-runtime/runtime.schema.json')),
    'utf8',
  ),
);
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validRun = ajv.compile(runtimeSchema);
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { adminContext } from '../admin/context.mjs';
import { version } from '../admin/validation.mjs';
import { failure } from '../../platform/auth.mjs';
import { getModel } from '../models/store.mjs';
import { openKey } from '../models/crypto.mjs';
import { createRunStore } from './runs.mjs';
import {
  isRenderRequest,
  renderTechnicalOutput,
  extractConfirmedAnswers,
  selectRenderSource,
} from './feedback.mjs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportFolder } from '../fs-workspace/export/storage.mjs';
import { unknownProfile } from './sap-profile.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerOf = (current) => ({ userId: current.user.id, sessionId: current.sessionId });
const coordinators = new WeakMap();
export function registerAbapFsdAgentRoutes(
  app,
  pool,
  organizationId,
  requireSession,
  generate,
  origin,
  agentConnect,
  options = {},
) {
  if (!options.executor || !options.context || !options.prefix?.includes('/work/development/'))
    throw new Error('Only the development assistant can register this shared runtime');
  const leaseOwner = randomUUID();
  const leaseTimer = setInterval(
    () =>
      pool
        .query(
          "UPDATE app.fsd_agent_run SET lease_until=clock_timestamp()+interval '90 seconds' WHERE lease_owner=$1 AND id=ANY($2::uuid[]) AND state IN ('queued','running') AND lease_until>clock_timestamp()",
          [leaseOwner, store.runningIds()],
        )
        .catch((err) => app.log.error({ err }, 'Run lease renewal failed')),
    20000,
  );
  leaseTimer.unref();
  app.addHook('onClose', async () => clearInterval(leaseTimer));
  const prefix = options.prefix ?? '/api/admin/abap-fsd-agent';
  const base = prefix + '/runs';
  const c = options.context ?? adminContext(pool, organizationId, requireSession),
    store = createRunStore({ generate });
  if (!coordinators.has(app))
    coordinators.set(app, { stores: [], withAdmission: store.withAdmission, epochs: new Map() });
  const coordinator = coordinators.get(app);
  coordinator.stores.push(store);
  const delivery = deliveryContext(pool, organizationId, requireSession);
  registerAgentAttachments(app, { c, pool, org: organizationId, delivery, prefix });
  const resolveProfile = createProfileResolver({
    pool,
    org: organizationId,
    connect: agentConnect,
  });
  app.post(prefix + '/system-profile', async (req) => {
    const current = await c.authorize(req);
    const selection = req.body ?? {};
    if (
      !validRun({
        modelId: '00000000-0000-4000-8000-000000000000',
        requestId: '00000000-0000-4000-8000-000000000000',
        rowVersion: '1',
        prompt: 'profile',
        selection,
      })
    )
      throw failure(400, '目标选择格式无效。');
    const { project } = await pinAssociation(pool, organizationId, current, selection, delivery);
    return resolveProfile(project, current, selection);
  });
  app.post(prefix + '/system-profiles', async (req) => {
    const current = await c.authorize(req);
    if (
      !validRun({
        modelId: '00000000-0000-4000-8000-000000000000',
        requestId: '00000000-0000-4000-8000-000000000000',
        rowVersion: '1',
        prompt: 'profiles',
        selection: req.body ?? {},
      })
    )
      throw failure(400, '目标选择格式无效');
    const selection = await resolveTargetSelection(
      pool,
      organizationId,
      current,
      req.body ?? {},
      delivery,
    );
    const { project } = await pinAssociation(pool, organizationId, current, selection, delivery);
    const DEV = await resolveProfile(project, current, selection);
    const QAS = await resolveProfile(project, current, {
      ...selection,
      systemId: selection.qasSystemId,
      environment: 'QAS',
      consultantVersion: undefined,
    });
    return { DEV, QAS };
  });
  app.addHook('onClose', async () => store.close());
  if (options.context)
    app.post(prefix + '/reset', async (req) => {
      const originalStage = req.params.stage;
      for (const stage of ['design', 'development']) {
        req.params.stage = stage;
        await c.authorize(req);
      }
      req.params.stage = originalStage;
      return coordinator.withAdmission(async () => {
        coordinator.epochs.set(
          req.params.itemId,
          (coordinator.epochs.get(req.params.itemId) ?? 0) + 1,
        );
        await Promise.all(coordinator.stores.map((s) => s.resetItem(req.params.itemId)));
        const result = await c.write(req, 'item_work.reset', 'development_item', async (db) => {
          // Check both owners again inside the transaction, after draining active tasks.
          for (const stage of ['design', 'development']) {
            req.params.stage = stage;
            await c.authorize(req, db, true);
          }
          req.params.stage = originalStage;
          const args = [organizationId, req.params.projectId, req.params.itemId];
          const { rows: sessions } = await db.query(
            "SELECT id FROM app.fsd_agent_session WHERE organization_id=$1 AND selection->>'projectId'=$2 AND selection->>'itemId'=$3 FOR UPDATE",
            args,
          );
          const ids = sessions.map((s) => s.id);
          const { rows: files } = await db.query(
            'SELECT id FROM app.fsd_agent_attachment WHERE conversation_id=ANY($1::uuid[])',
            [ids],
          );
          const { rows: workspaces } = await db.query(
            'SELECT id FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 FOR UPDATE',
            args,
          );
          const legacyFiles = [];
          for (const ws of workspaces) {
            const attachments = await db.query(
              'SELECT blob_key FROM app.fs_attachment WHERE workspace_id=$1',
              [ws.id],
            );
            const exports = await db.query(
              'SELECT blob_key FROM app.fs_export WHERE workspace_id=$1 AND blob_key IS NOT NULL',
              [ws.id],
            );
            legacyFiles.push(
              ...attachments.rows.map((f) => ({ kind: 'attachment', id: f.blob_key })),
              ...exports.rows.map((f) => ({ kind: 'export', id: f.blob_key })),
            );
            await db.query('DELETE FROM app.item_work_version WHERE workspace_id=$1', [ws.id]);
            await db.query('UPDATE app.fs_workspace SET assistant_reset_at=now() WHERE id=$1', [
              ws.id,
            ]);
          }
          await db.query('SELECT app.reset_legacy_assistant_content($1,$2,$3)', args);
          await db.query(
            'DELETE FROM app.fsd_agent_revision WHERE conversation_id=ANY($1::uuid[])',
            [ids],
          );
          await db.query(
            'DELETE FROM app.fsd_agent_attachment WHERE conversation_id=ANY($1::uuid[])',
            [ids],
          );
          await db.query('DELETE FROM app.fsd_agent_run WHERE conversation_id=ANY($1::uuid[])', [
            ids,
          ]);
          await db.query('DELETE FROM app.fsd_agent_session WHERE id=ANY($1::uuid[])', [ids]);
          return {
            subjectId: req.params.itemId,
            data: {
              reset: true,
              files: files.map((f) => ({ kind: 'agent', id: f.id })).concat(legacyFiles),
            },
          };
        });
        let cleanupPending = 0;
        const folders = {
          agent: fileURLToPath(new URL('../../../../../.runtime/fsd-agent-files/', import.meta.url)),
          attachment:
            process.env.FS_ATTACHMENTS_DIR ??
            fileURLToPath(new URL('../../../../../.runtime/fs-attachments/', import.meta.url)),
          export: exportFolder(),
        };
        for (const file of result.files) {
          if (!uuid.test(file.id)) {
            cleanupPending++;
            continue;
          }
          await unlink(join(folders[file.kind], file.id)).catch((e) => {
            if (e.code !== 'ENOENT') {
              cleanupPending++;
              app.log.error({ err: e }, 'Reset attachment cleanup failed');
            }
          });
        }
        return { reset: true, cleanupPending };
      });
    });
  app.post(prefix + '/conversations', async (req) => {
    const current = await c.authorize(req),
      inputSelection = c.selection
        ? c.selection(req, req.body?.selection)
        : (req.body?.selection ?? {});
    let selection = inputSelection;
    if (!options.context && selection.workspaceStage)
      throw failure(400, '阶段会话请使用开发项入口。');
    if (
      !validRun({
        modelId: '00000000-0000-4000-8000-000000000000',
        requestId: '00000000-0000-4000-8000-000000000000',
        rowVersion: '1',
        prompt: 'create',
        selection,
      })
    )
      throw failure(400, '目标格式无效');
    selection = await resolveTargetSelection(pool, organizationId, current, selection, delivery);
    return c.write(req, 'abap_fsd_agent.session.create', 'fsd_agent_session', async (db) => {
      await pinAssociation(db, organizationId, current, selection, delivery);
      const id = await createConversation(db, organizationId, current.user.id, selection);
      if (options.conversationContext) {
        const context = await options.conversationContext(db, req);
        await db.query('UPDATE app.fsd_agent_session SET context=$2 WHERE id=$1', [id, context]);
      }
      return { subjectId: id, data: { conversationId: id } };
    });
  });
  app.get(prefix + '/artifacts/:id', async (req, reply) => {
    const current = await c.authorize(req);
    if (!uuid.test(req.params.id)) throw failure(400, '版本ID无效');
    const {
      rows: [r],
    } = await pool.query(
      'SELECT * FROM app.fsd_agent_revision WHERE organization_id=$1 AND actor_id=$2 AND id=$3',
      [organizationId, current.user.id, req.params.id],
    );
    if (!r) throw failure(404, '版本不存在');
    const session = await conversation(pool, organizationId, current.user.id, r.conversation_id);
    c.assertConversation?.(req, session);
    if (session.selection.projectId)
      await delivery.access(pool, current, session.selection.projectId);
    if (req.query.format === 'markdown') {
      reply.type('text/markdown; charset=utf-8');
      reply.header(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" +
          encodeURIComponent('报表功能说明书-版本' + r.revision + '.md'),
      );
      return r.markdown;
    }
    return {
      id: r.id,
      spec: r.spec,
      markdown: r.markdown,
      contentHash: r.content_hash,
      evidence: r.evidence,
      manifest: r.manifest,
      revision: r.revision,
    };
  });
  async function ownedRun(req, id) {
    const current = await c.authorize(req);
    if (!uuid.test(id)) throw failure(400, '运行ID无效');
    const {
      rows: [r],
    } = await pool.query(
      'SELECT * FROM app.fsd_agent_run WHERE organization_id=$1 AND actor_id=$2 AND id=$3',
      [organizationId, current.user.id, id],
    );
    if (!r) throw failure(404, '运行不存在');
    const session = await conversation(pool, organizationId, current.user.id, r.conversation_id);
    c.assertConversation?.(req, session);
    if (session.selection.projectId)
      await delivery.access(pool, current, session.selection.projectId);
    return r;
  }
  app.get(base + '/:id', async (req) => {
    const r = await ownedRun(req, req.params.id);
    await recoverInterruptedRuns(pool, r.conversation_id);
    const freshRun = await pool.query('SELECT state,snapshot FROM app.fsd_agent_run WHERE id=$1', [
      r.id,
    ]);
    Object.assign(r, freshRun.rows[0]);
    const state = await readSessionState(pool, organizationId, r.actor_id, r.conversation_id);
    const { rows } = await pool.query(
      'SELECT id,spec,markdown,content_hash,revision FROM app.fsd_agent_revision WHERE run_id=$1 AND actor_id=$2',
      [r.id, r.actor_id],
    );
    return {
      runId: r.id,
      createdAt: r.created_at,
      serverTime: new Date().toISOString(),
      conversationId: r.conversation_id,
      state: r.state,
      snapshot: r.snapshot,
      artifact: rows[0] ? { ...rows[0], contentHash: rows[0].content_hash } : null,
      history: state.history,
      artifacts: state.artifacts,
      latestArtifact: state.latestArtifact,
      latestRunId: state.latestRunId,
    };
  });
  app.get(base + '/:id/diagnostics', async (req) => {
    const r = await ownedRun(req, req.params.id);
    const s = r.snapshot;
    return {
      runId: r.id,
      conversationId: r.conversation_id,
      state: r.state,
      analysis: analyzeRun(
        { runId: r.id, state: r.state, createdAt: r.created_at, snapshot: s },
        readTrace({ runId: r.id }),
      ),
      repair: s.repair,
      designCalls: s.designCalls,
      createdAt: r.created_at,
      model: s.input?.model,
      plan: s.plan,
      failure: s.failure,
      generation: s.generation,
      generationProgress: s.generationProgress,
      rendering: s.rendering,
      prompt: s.prompt,
      context: {
        included: s.manifest?.included,
        excluded: s.manifest?.excluded,
        bytes: s.manifest?.bytes,
        budgetBytes: s.manifest?.budgetBytes,
        rules: s.manifest?.rules,
        outputProtocolVersion: s.manifest?.outputProtocolVersion,
        runtimeInstructionsHash: s.manifest?.runtimeInstructionsHash,
        decisions: s.decisions,
      },
      technicalOutput: s.rawOutput || s.text || s.preflightFailure?.text || '',
      preflight: s.preflight
        ? { generation: s.preflight.generation, text: s.preflight.text }
        : null,
      validation: s.validation,
      rendered: s.rendered,
      artifactId: s.artifactId,
    };
  });
  app.get(base + '/:id/trace', async (req) => {
    const r = await ownedRun(req, req.params.id);
    return { version: 1, runId: r.id, events: readTrace({ runId: r.id }) };
  });
  app.get(base + '/by-request/:requestId', async (req) => {
    const current = await c.authorize(req);
    if (!uuid.test(req.params.requestId)) throw failure(400, '请求编号无效');
    const { rows } = await pool.query(
      'SELECT id FROM app.fsd_agent_run WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3',
      [organizationId, current.user.id, req.params.requestId],
    );
    if (!rows[0]) return { runId: null };
    const r = await ownedRun(req, rows[0].id);
    return { runId: r.id, conversationId: r.conversation_id, state: r.state };
  });
  app.get(base + '/:id/markdown', async (req, reply) => {
    const r = await ownedRun(req, req.params.id);
    const rendered = readingForRun(r);
    if (!rendered?.markdown || r.state !== 'completed')
      throw failure(404, '当前运行没有完整可下载的阅读稿。');
    reply.type('text/markdown; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="' + r.id + '.md"');
    return rendered.markdown;
  });
  app.post(base, { bodyLimit: 500000 }, async (req, reply) => {
    const requestItemId = req.params.itemId ?? req.body?.selection?.itemId;
    const requestEpoch = coordinator.epochs.get(requestItemId) ?? 0;
    const current = await c.authorize(req);
    let body = req.body,
      resumed = null,
      retried = null,
      submittedAnswers = [],
      decisions = [];
    if (body?.retryRunId) {
      if (body.resumeRunId) throw failure(400, '不能同时确认与重试');
      const previous = await ownedRun(req, body.retryRunId);
      retried = previous;
      if (!['failed', 'cancelled', 'completed'].includes(previous.state))
        throw failure(409, '此任务尚未结束，请先处理当前任务');
      const input = previous.snapshot.input;
      if (!input) throw failure(409, '旧任务缺少恢复参数，请开始新对话');
      decisions = previous.snapshot.decisions ?? [];
      body = {
        modelId: input.modelId,
        rowVersion: input.modelRowVersion,
        prompt: previous.snapshot.prompt,
        messages: previous.snapshot.messages ?? [],
        selection: input.selection,
        action: input.action,
        riceType: input.riceType,
        attachmentIds: input.attachmentIds,
        conversationId: previous.conversation_id,
        requestId: body.requestId,
        retryRunId: previous.id,
      };
    }
    if (body?.resumeRunId) {
      if (!uuid.test(body.requestId ?? '')) throw failure(400, '请求ID无效');
      resumed = await ownedRun(req, body.resumeRunId);
      const answered = answerDecision(resumed.snapshot.decision, body.decisionAnswer);
      submittedAnswers = answered;
      const answerHash = createHash('sha256').update(JSON.stringify(answered)).digest('hex');
      const {
        rows: [prior],
      } = await pool.query(
        'SELECT * FROM app.fsd_agent_run WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3',
        [organizationId, current.user.id, body.requestId],
      );
      if (prior) {
        if (prior.snapshot.resumeRunId !== resumed.id || prior.snapshot.answerHash !== answerHash)
          throw failure(409, '请求标识已用于其他操作');
        return reply.code(202).send({
          runId: prior.id,
          conversationId: prior.conversation_id,
          plan: prior.snapshot.plan,
          action: prior.snapshot.input?.action,
        });
      }
      if (resumed.state !== 'waiting_user' || resumed.snapshot.resolvedRunId)
        throw failure(409, '问题已处理，请刷新查看后续任务。');
      const input = resumed.snapshot.input;
      if (!input) throw failure(409, '旧运行缺少恢复参数，请在新对话中继续。');
      decisions = [...(resumed.snapshot.decisions ?? []), ...answered];
      if (decisions.length > 30) throw failure(409, '本次澄清轮次过多，请整理需求后新建任务。');
      const choice = resumed.snapshot.decision.kind === 'type' ? answered[0].value : null;
      body = {
        modelId: input.modelId,
        rowVersion: input.modelRowVersion,
        prompt: resumed.snapshot.prompt,
        messages: resumed.snapshot.messages ?? [],
        selection: input.selection,
        action: choice === 'dialogue' ? 'dialogue' : input.action,
        riceType: choice === 'R' ? 'R' : input.riceType,
        attachmentIds: input.attachmentIds,
        conversationId: resumed.conversation_id,
        requestId: body.requestId,
        resumeRunId: resumed.id,
        decisionAnswer: body.decisionAnswer,
      };
      resumed.answerHash = answerHash;
    }
    if (!validRun(body) || !body.prompt.trim())
      throw failure(400, '运行输入格式无效，请检查消息与目标选择。');
    const submittedBody = structuredClone(body);
    if (!options.context && body.selection?.workspaceStage)
      throw failure(400, '阶段会话请使用开发项入口。');
    const selection = await resolveTargetSelection(
      pool,
      organizationId,
      current,
      c.selection ? c.selection(req, body.selection) : (body.selection ?? {}),
      delivery,
    );
    let sessionState = null;
    if (body.conversationId) {
      const selectedSession = await conversation(
        pool,
        organizationId,
        current.user.id,
        body.conversationId,
        selection,
      );
      c.assertConversation?.(req, selectedSession);
      req.conversationContext = selectedSession.context;
      sessionState = await readSessionState(
        pool,
        organizationId,
        current.user.id,
        body.conversationId,
      );
      const submitted = submittedAnswers;
      const merged = new Map(sessionState.decisions.map((a) => [a.question, a]));
      for (const answer of submitted) merged.set(answer.question, answer);
      decisions = [...merged.values()];
      for (const answer of extractConfirmedAnswers(
        sessionState.contextHistory ?? sessionState.history,
        body.prompt,
      )) {
        const prior = decisions.findIndex((d) => d.question === answer.question);
        if (prior >= 0) decisions.splice(prior, 1);
        decisions.push(answer);
      }
      const attached = await pool.query(
        "SELECT id FROM app.fsd_agent_attachment WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 AND state='ready' ORDER BY created_at,id",
        [organizationId, current.user.id, body.conversationId],
      );
      body.attachmentIds = [
        ...new Set([...(body.attachmentIds ?? []), ...attached.rows.map((a) => a.id)]),
      ];
      // Visible history is complete; only completed text is sent as model context.
      body.messages = (sessionState.contextHistory ?? sessionState.history)
        .filter((m) => m.status === 'completed')
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.artifact
            ? renderPrompt('context-history-artifact', { revision: m.artifact.revision })
            : m.decision
              ? JSON.stringify({ decision: m.decision, answers: m.answers })
              : m.content,
          status: m.status,
        }));
    }
    const reviewContinuation =
      selection.workspaceStage === 'development' &&
      !body.resumeRunId &&
      !body.retryRunId &&
      isReviewContinuation(body.prompt, sessionState ?? {});
    const rowVersion = version(body.rowVersion),
      owner = ownerOf(current);
    const requestHash = createHash('sha256')
      .update(JSON.stringify([submittedBody, selection]))
      .digest('hex');
    const existing = store.reuse(owner, body.requestId, requestHash);
    if (existing) {
      if (existing.metadata.association?.projectId)
        await delivery.access(pool, current, existing.metadata.association.projectId);
      return reply.code(202).send({
        runId: existing.id,
        eventsUrl: base + '/' + existing.id + '/events',
        modelId: existing.modelId,
        ...existing.metadata,
      });
    }
    const pinned = await c.write(req, 'abap_fsd_agent.run.start', 'llm_model', async (db) => {
      const target = await pinAssociation(db, organizationId, current, selection, delivery);
      const model = await getModel(db, organizationId, body.modelId);
      if (model.rowVersion !== rowVersion)
        throw failure(409, '模型配置已变化，请重新打开页面后发送。');
      const {
        rows: [credential],
      } = await db.query(
        'SELECT secret_cipher FROM app.llm_credential WHERE organization_id=$1 AND id=$2',
        [organizationId, model.credentialId],
      );
      if (!credential) throw failure(503, '模型凭据不可用。');
      return {
        subjectId: model.id,
        data: {
          ...target,
          model,
          key: openKey(credential.secret_cipher, organizationId, model.credentialId),
        },
      };
    });
    const renderOnly = isRenderRequest(body.prompt);
    const systemProfile = renderOnly
      ? unknownProfile(selection.systemId, '格式转换无需SAP查询')
      : await resolveProfile(pinned.project, current, selection);
    const qasProfile = renderOnly
      ? unknownProfile(selection.qasSystemId, '格式转换无需SAP查询')
      : await resolveProfile(pinned.project, current, {
          ...selection,
          systemId: selection.qasSystemId,
          environment: 'QAS',
          consultantVersion: undefined,
        });
    const systemTargets = {
      DEV: {
        systemId: selection.systemId ?? null,
        environment: 'DEV',
        purpose: 'metadata',
        profile: systemProfile,
      },
      QAS: {
        systemId: selection.qasSystemId ?? null,
        environment: 'QAS',
        purpose: 'test_cases',
        profile: qasProfile,
      },
    };
    await c.authorize(req);
    await pinAssociation(pool, organizationId, current, selection, delivery);
    const attachments = await readyAttachments(
      pool,
      organizationId,
      current.user.id,
      body.conversationId,
      body.attachmentIds,
    );
    const action = reviewContinuation
      ? 'dialogue'
      : body.action === 'auto'
        ? (options.resolveAction?.(req, body.prompt) ?? 'dialogue')
        : (body.action ?? 'dialogue');
    const plan = planRun({
      request: body.prompt + ' ' + JSON.stringify(pinned.association?.requirement ?? {}),
      riceType: body.riceType ?? options.riceType?.(req),
      action,
    });
    options.decoratePlan?.(req, plan);
    const workContext = options.loadWork ? await options.loadWork(req) : null;
    const context = buildContext({
      attachments,
      existingSources: sessionState?.latestArtifact?.spec?.sources ?? [],
      activeSpecification: sessionState?.latestArtifact?.spec ?? null,
      consultantDecisions: decisions,
      task: action === 'draft' && plan.type.riceType === 'R' ? 'draft' : 'dialogue',
      outputMode: action === 'draft' ? 'draft' : 'dialogue',
      riceType: plan.type.riceType,
      budget: workContext ? 700000 : action === 'draft' ? 180000 : 48000,
      extraInstructions: [
        workContext ? renderPrompt('context-work') : '',
        renderPrompt('context-decisions', { decisions: JSON.stringify(decisions) }),
        sessionState?.latestArtifact && !reviewContinuation
          ? renderPrompt('context-latest', {
              spec: JSON.stringify(sessionState.latestArtifact.spec),
            })
          : '',
      ].join('\n'),
      messages: body.messages ?? [],
      currentMessage: body.prompt,
      systemProfile,
      systemTargets,
      association: workContext ? { ...pinned.association, workContext } : pinned.association,
    });
    options.decorateContext?.(req, context, workContext, action);
    if (isRenderRequest(body.prompt)) {
      const source = selectRenderSource(sessionState);
      if (!source) throw failure(422, '当前会话没有可转换的完整JSON，请先生成结构化内容。');
      try {
        context.rendered = renderTechnicalOutput(source);
      } catch {
        throw failure(422, '原始JSON不完整，无法转换；已保留原始对话。');
      }
      plan.steps = plan.steps.slice(0, 2);
      plan.steps[0].label = '读取已有结构化内容';
      plan.steps[1].label = '转换Markdown阅读稿';
    }
    if (workContext) context.manifest.workContext = workContext;
    const metadata = {
      createdAt: new Date().toISOString(),
      action,
      plan,
      systemProfile,
      systemTargets,
      association: pinned.association,
      manifest: context.manifest,
      warnings: context.warnings,
      ...(reviewContinuation ? { reviewContinuation: true } : {}),
    };
    return coordinator.withAdmission(async () => {
      if ((coordinator.epochs.get(requestItemId) ?? 0) !== requestEpoch)
        throw failure(409, '开发项已重置，请刷新后重新发送。');
      // Recheck receipt after asynchronous pinning; no provider request holds the admin transaction.
      const duplicate = store.reuse(owner, body.requestId, requestHash);
      if (duplicate) return reply.code(202).send({ runId: duplicate.id, ...duplicate.metadata });
      store.assertAvailable(pinned.model.id);
      const runId = randomUUID();
      const conversationId = await c.write(
        req,
        'abap_fsd_agent.run.persist',
        'fsd_agent_run',
        async (db) => {
          const prior = await db.query(
            'SELECT id FROM app.fsd_agent_run WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3',
            [organizationId, current.user.id, body.requestId],
          );
          if (prior.rows.length)
            throw failure(
              409,
              '此请求已持久化，内存运行已过期；请使用新的请求标识，已保存规格保留。',
            );
          const id =
            body.conversationId ??
            (await createConversation(db, organizationId, current.user.id, selection));
          await lockSession(db, organizationId, current.user.id, id);
          await conversation(db, organizationId, current.user.id, id, selection);
          if (workContext && options.loadWork) {
            const fresh = await options.loadWork(req);
            if (fresh.draftVersionId !== workContext.draftVersionId)
              throw failure(409, '工作稿已重置或更新，请刷新后重试。');
          }
          if (resumed) {
            const claimed = await db.query(
              "UPDATE app.fsd_agent_run SET snapshot=snapshot || $4::jsonb WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND state='waiting_user' AND NOT (snapshot ? 'resolvedRunId') RETURNING id",
              [
                organizationId,
                current.user.id,
                resumed.id,
                JSON.stringify({
                  resolvedRunId: runId,
                  answer: submittedAnswers,
                  answeredAt: new Date().toISOString(),
                }),
              ],
            );
            if (!claimed.rows.length) throw failure(409, '问题已处理，请刷新查看后续任务。');
          }
          await db.query(
            'INSERT INTO app.fsd_agent_run(id,organization_id,actor_id,conversation_id,request_id,request_hash,state,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              runId,
              organizationId,
              current.user.id,
              id,
              body.requestId,
              requestHash,
              'queued',
              {
                plan,
                author: {
                  id: current.user.id,
                  name:
                    current.user.displayName ?? current.user.name ?? current.user.username ?? null,
                },
                decisions,
                naturalAnswers: extractConfirmedAnswers(
                  sessionState?.contextHistory ?? sessionState?.history ?? [],
                  body.prompt,
                ),
                retryRunId: body.retryRunId ?? null,
                resumeRunId: resumed?.id ?? null,
                answerHash: resumed?.answerHash ?? null,
                manifest: context.manifest,
                messages: body.messages ?? [],
                prompt: body.prompt,
                input: {
                  selection,
                  action,
                  riceType: body.riceType,
                  attachmentIds: body.attachmentIds ?? [],
                  modelId: body.modelId,
                  modelRowVersion: rowVersion,
                  model: {
                    provider: pinned.model.config.provider,
                    modelId: pinned.model.config.modelId,
                    protocol: pinned.model.config.protocol,
                  },
                },
              },
            ],
          );
          await db.query(
            "UPDATE app.fsd_agent_run SET lease_owner=$2,lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1",
            [runId, leaseOwner],
          );
          return { subjectId: runId, data: id };
        },
      );
      metadata.conversationId = conversationId;
      const persist = (id, snapshot, state) =>
        pool.query(
          "UPDATE app.fsd_agent_run SET snapshot=snapshot || $4::jsonb,state=$5 WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND state IN ('queued','running') AND lease_until>clock_timestamp()",
          [
            organizationId,
            current.user.id,
            id,
            JSON.stringify({
              ...snapshot,
              ...(['completed', 'failed', 'cancelled', 'waiting_user'].includes(state)
                ? { finishedAt: new Date().toISOString() }
                : {}),
            }),
            state,
          ],
        );
      const run = store.start({
        recorder: createRecorder({ runId }),
        owner,
        runId,
        persistTerminal: persist,
        execute: options.executor(req, {
          plan,
          action,
          persist,
          profile: systemProfile,
          context,
          association: pinned.association,
          reviewArtifact: reviewContinuation ? sessionState.latestArtifact : null,
          verify: {
            systemId: selection.systemId,
            environment: selection.environment ?? 'DEV',
            connect: () =>
              connectSelected({
                pool,
                org: organizationId,
                project: pinned.project,
                current,
                selection,
                connect: agentConnect,
              }),
          },
          save: (args) =>
            c.write(
              req,
              'abap_fsd_agent.spec.save',
              'fsd_agent_session',
              async (db) => {
                await pinAssociation(db, organizationId, current, selection, delivery);
                args.onCommitStart?.();
                const data = await saveRevision(db, {
                  org: organizationId,
                  actor: current.user.id,
                  conversationId,
                  ...args,
                  ...(options.saveOptions?.(req) ?? {}),
                });
                return { subjectId: conversationId, data };
              },
              { boundedSave: true },
            ),
        }),
        ...pinned,
        context,
        metadata,
        prompt: body.prompt.trim(),
        requestId: body.requestId,
        requestHash,
      });
      return reply.code(202).send({
        runId: run.id,
        serverTime: new Date().toISOString(),
        eventsUrl: base + '/' + run.id + '/events',
        modelId: run.modelId,
        ...run.metadata,
      });
    });
  });
  app.post(base + '/:id/cancel', async (req) => {
    if (options.context) await ownedRun(req, req.params.id);
    const owner = ownerOf(await c.authorize(req));
    const run = store.get(req.params.id, owner);
    store.cancel(run);
    await run.task;
    return { runId: run.id, status: run.status };
  });
  app.get(base + '/:id/events', async (req, reply) => {
    if (options.context) await ownedRun(req, req.params.id);
    const current = await c.authorize(req);
    const owner = ownerOf(current),
      run = store.get(req.params.id, owner);
    if (run.metadata.association?.projectId)
      await delivery.access(pool, current, run.metadata.association.projectId);
    if (
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw failure(403, '不允许跨站读取。');
    const after = req.query.afterSeq ?? '0';
    if (!/^\d{1,9}$/.test(String(after)) || Number(after) > run.events.length)
      throw failure(400, '事件游标无效。');
    if (run.listeners.size) throw failure(409, '此运行已有活动订阅。');
    let wake,
      closed = false,
      pendingBytes = 0,
      checking = false;
    const queue = [];
    const enqueue = (event) => {
      const text = `id: ${run.id}:${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      pendingBytes += Buffer.byteLength(text);
      if (pendingBytes > 2097152) {
        closed = true;
        wake?.();
        return;
      }
      queue.push(text);
      wake?.();
    };
    run.listeners.add(enqueue);
    for (const event of run.events) if (event.seq > Number(after)) enqueue(event);
    const heartbeat = setInterval(async () => {
      if (checking || closed) return;
      checking = true;
      try {
        const current = await c.authorize(req);
        if (run.metadata.association?.projectId)
          await delivery.access(pool, current, run.metadata.association.projectId);
        if (!closed) {
          queue.push(': heartbeat\n\n');
          wake?.();
        }
      } catch {
        closed = true;
        store.cancel(run);
        wake?.();
      } finally {
        checking = false;
      }
    }, 10000);
    heartbeat.unref();
    async function* output() {
      try {
        while (!closed) {
          if (queue.length) {
            const text = queue.shift();
            pendingBytes = Math.max(0, pendingBytes - Buffer.byteLength(text));
            yield text;
            continue;
          }
          if (run.status !== 'running') break;
          await new Promise((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      } finally {
        dispose();
      }
    }
    function dispose() {
      if (closed && !run.listeners.has(enqueue)) return;
      closed = true;
      clearInterval(heartbeat);
      run.listeners.delete(enqueue);
      wake?.();
      if (run.status === 'running') store.cancel(run);
    }
    reply.raw.on('close', dispose);
    reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('X-Accel-Buffering', 'no');
    return reply.send(Readable.from(output()));
  });
}
