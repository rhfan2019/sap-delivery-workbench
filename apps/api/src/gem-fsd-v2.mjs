// Deliberately one backend file for the Gem FSD v2 pilot. No legacy FSD executor/MCP.
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createWorkContext, workBase } from './item-workspace/routes.mjs';
import { failure } from './auth.mjs';
import { getModel, listModels } from './models/store.mjs';
import { openKey } from './models/crypto.mjs';
import { streamAssistant } from './abap-fsd-agent/generation.mjs';
import { abortable } from './abap-fsd-agent/cancellation.mjs';
import { createRecorder, readTrace, traceRoot } from '../../../tools/fsd-batch/lib/recorder.mjs';
const v2TraceRoot = join(traceRoot, 'gem-fsd-v2');

export const V2_ENGINE = 'gem-fsd-v2';
export const V2_TIMEOUT_MS = 360000;
const promptText = readFileSync(
  new URL('../../../packages/agents/gem-fsd-v2.md', import.meta.url),
  'utf8',
);
const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const uuid = (value) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value ?? '');
const error = (code, message) => Object.assign(new Error(message), { code });
export function buildV2Context({ item, prompt = '生成完整FSD', answers = '', questions = [] }) {
  const input = {
    requirement: {
      code: item.code,
      name: item.name,
      module: item.module,
      kind: item.kind,
      summary: item.summary,
      acceptance: item.acceptance,
    },
    request: prompt,
    businessAnswers: answers,
    pendingQuestions: questions,
    capabilities: { mcp: false, ddicImport: false, codeGeneration: false },
  };
  const messages = [
    { role: 'system', content: promptText },
    { role: 'user', content: '以下 JSON 是本次业务资料：\n' + JSON.stringify(input) },
  ];
  if (Buffer.byteLength(JSON.stringify(messages)) > 80000)
    throw failure(413, 'v2 输入过大，请精简业务补充；未截断或发送。');
  return {
    messages,
    manifest: {
      task: V2_ENGINE,
      promptHash: hash(promptText),
      inputHash: hash(input),
      engine: V2_ENGINE,
    },
  };
}
export function parseV2(text) {
  const source = text.trim();
  if (source.startsWith('{')) {
    let q;
    try {
      q = JSON.parse(source);
    } catch {
      throw error('V2_FORMAT', '澄清格式不完整，输出已保留。');
    }
    if (
      q.kind !== 'clarification' ||
      Object.keys(q).some((k) => !['kind', 'questions'].includes(k)) ||
      !Array.isArray(q.questions) ||
      !q.questions.length ||
      q.questions.length > 3
    )
      throw error('V2_FORMAT', '澄清问题格式无效。');
    const ids = new Set();
    for (const v of q.questions) {
      if (
        !/^[a-z0-9_-]{1,40}$/i.test(v.id ?? '') ||
        ids.has(v.id) ||
        ['question', 'impact'].some(
          (k) => typeof v[k] !== 'string' || !v[k].trim() || v[k].length > 1000,
        )
      )
        throw error('V2_FORMAT', '澄清问题内容无效。');
      ids.add(v.id);
    }
    return q;
  }
  if (!source.endsWith('<!-- FSD_V2_END -->'))
    throw error('V2_INCOMPLETE', '文档未完整结束，未保存完整版本。');
  const markdown = source.slice(0, -'<!-- FSD_V2_END -->'.length).trim();
  const headings = [
    ...markdown.matchAll(
      /^##\s+(?:第)?([1-9一二三四五六七八九])(?:章[：:]|[.、．：:])\s*([^\n]+)\r?$/gm,
    ),
  ];
  if (
    headings.length !== 9 ||
    headings.some(
      (h, i) =>
        Number(
          h[1].replace(/[一二三四五六七八九]/g, (c) => String('一二三四五六七八九'.indexOf(c) + 1)),
        ) !==
        i + 1,
    )
  )
    throw error('V2_FORMAT', '文档章节缺失、重复或顺序不正确。');
  for (let i = 0; i < 9; i++) {
    const content = markdown
      .slice(headings[i].index + headings[i][0].length, headings[i + 1]?.index ?? markdown.length)
      .trim();
    if (content.length < 20) throw error('V2_FORMAT', `第${i + 1}章节内容不足。`);
  }
  if (/```\s*abap\b/i.test(markdown)) throw error('V2_FORMAT', '本版仅生成FSD，不能交付ABAP代码。');
  return {
    kind: 'document',
    markdown,
    contentHash: hash(markdown),
    validation: {
      valid: true,
      assurance: 'markdown-structure-only',
      businessQuality: 'not_evaluated',
      sapVerified: false,
    },
  };
}
export async function executeV2({
  model,
  key,
  context,
  generate = streamAssistant,
  record = () => {},
  signal,
  timeoutMs = V2_TIMEOUT_MS,
  onProgress = () => {},
}) {
  const controller = new AbortController();
  const relay = () => controller.abort(signal.reason ?? error('CANCELLED', '已停止。'));
  if (signal.aborted) relay();
  else signal.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(
    () => controller.abort(error('V2_TIMEOUT', '达到360秒运行上限，已停止；不会自动重试。')),
    timeoutMs,
  );
  const started = Date.now();
  let text = '';
  try {
    record('model.started', {
      callId: 1,
      stage: 'generate',
      task: V2_ENGINE,
      modelId: model.modelId,
      messages: context.messages,
      manifest: context.manifest,
    });
    const result = await abortable(
      () =>
        generate(model, key, '生成FSD', {
          context,
          signal: controller.signal,
          onAttempt: (type, data) => {
            controller.signal.throwIfAborted();
            record('provider.' + type, { callId: 1, stage: 'generate', task: V2_ENGINE, ...data });
          },
          onProgress: (data) => onProgress({ ...data, elapsedMs: Date.now() - started }),
          onDelta: (delta) => {
            controller.signal.throwIfAborted();
            if (text.length + delta.length > 120000)
              throw error('V2_OUTPUT_LIMIT', '输出过大，已停止。');
            text += delta;
            record('model.delta', { callId: 1, text: delta });
            onProgress({
              phase: 'text',
              textCharacters: text.length,
              elapsedMs: Date.now() - started,
            });
          },
        }),
      controller.signal,
    );
    controller.signal.throwIfAborted();
    record('model.completed', {
      callId: 1,
      stage: 'generate',
      task: V2_ENGINE,
      durationMs: Date.now() - started,
      result,
      output: text,
    });
    const checkStarted = performance.now();
    let parsed;
    try {
      parsed = parseV2(text);
    } catch (e) {
      record('validation.completed', {
        valid: false,
        code: e.code,
        durationMs: performance.now() - checkStarted,
      });
      throw e;
    }
    record('validation.completed', {
      valid: true,
      kind: parsed.kind,
      durationMs: performance.now() - checkStarted,
    });
    return {
      ...parsed,
      usage: result.usage ?? null,
      generation: result,
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    // Preserve partial text for every failure, including timeout and malformed output.
    record('generation.failed', {
      code: e.code ?? 'MODEL_FAILED',
      message: e.message,
      output: text,
      durationMs: Date.now() - started,
    });
    throw e;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', relay);
  }
}

export function registerGemFsdV2(app, pool, org, requireSession, generate) {
  const c = createWorkContext(pool, org, requireSession),
    base = workBase + '/gem-fsd-v2',
    active = new Map();
  async function authorize(req, writing = false) {
    if (req.params.stage !== 'design') throw failure(404, 'v2 仅用于设计阶段。');
    return c.authorize(req, pool, writing);
  }
  async function recover(itemId) {
    await pool.query(
      "UPDATE app.gem_fsd_v2_run SET state='interrupted',finished_at=clock_timestamp(),snapshot=snapshot||$3::jsonb WHERE organization_id=$1 AND item_id=$2 AND state='running' AND lease_until<clock_timestamp()",
      [
        org,
        itemId,
        JSON.stringify({
          failure: {
            code: 'INTERRUPTED',
            message: '进程或租约中断，部分输出保留；不会自动重新生成。',
          },
        }),
      ],
    );
  }
  async function owned(req, id, writing = false) {
    const current = await authorize(req, writing);
    if (!uuid(id)) throw failure(400, '运行编号无效。');
    await recover(req.params.itemId);
    const row = (
      await pool.query(
        'SELECT * FROM app.gem_fsd_v2_run WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND item_id=$4 AND actor_id=$5',
        [id, org, req.params.projectId, req.params.itemId, current.user.id],
      )
    ).rows[0];
    if (!row) throw failure(404, 'v2 运行不存在或无权访问。');
    return row;
  }
  const present = (r) => ({
    runId: r.id,
    engine: V2_ENGINE,
    conversationId: r.conversation_id,
    parentId: r.parent_id,
    state: r.state,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    input: r.input,
    snapshot: r.snapshot,
    markdown: r.markdown,
    contentHash: r.content_hash,
  });
  app.get(base + '/runs', async (req) => {
    const current = await authorize(req);
    await recover(req.params.itemId);
    const rows = (
      await pool.query(
        'SELECT id,state,created_at,finished_at,snapshot,content_hash FROM app.gem_fsd_v2_run WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND actor_id=$4 ORDER BY created_at DESC LIMIT 50',
        [org, req.params.projectId, req.params.itemId, current.user.id],
      )
    ).rows;
    return {
      items: rows.map((r) => ({
        runId: r.id,
        state: r.state,
        createdAt: r.created_at,
        finishedAt: r.finished_at,
        model: r.snapshot.model,
        contentHash: r.content_hash,
      })),
    };
  });
  app.get(base + '/runs/:runId', async (req) => present(await owned(req, req.params.runId)));
  app.get(base + '/runs/:runId/trace', async (req) => {
    await owned(req, req.params.runId);
    return { events: readTrace({ runId: req.params.runId, root: v2TraceRoot }) };
  });
  app.post(base + '/runs/:runId/cancel', async (req) => {
    const row = await owned(req, req.params.runId, true);
    const running = active.get(row.id);
    if (row.state === 'running' && !running)
      throw failure(409, '运行正由其他进程处理或等待租约恢复，请稍后刷新。');
    if (running) {
      running.controller.abort(error('CANCELLED', '用户已停止，候选及日志保留。'));
      await running.task;
    }
    return present(await owned(req, row.id));
  });
  app.post(base + '/runs', { bodyLimit: 90000 }, async (req, reply) => {
    await authorize(req, true);
    const body = req.body ?? {};
    if (
      !uuid(body.requestId) ||
      Object.keys(body).some((k) => !['requestId', 'prompt', 'answers', 'parentId'].includes(k)) ||
      ['prompt', 'answers'].some(
        (k) => body[k] !== undefined && (typeof body[k] !== 'string' || body[k].length > 16000),
      ) ||
      (body.parentId && !uuid(body.parentId))
    )
      throw failure(400, 'v2 请求格式无效。');
    const requestHash = hash({
      prompt: body.prompt ?? '',
      answers: body.answers ?? '',
      parentId: body.parentId ?? null,
    });
    let launch;
    const receipt = await c.write(
      req,
      'gem_fsd_v2.start',
      'development_item',
      async (db, current) => {
        const prior = (
          await db.query('SELECT * FROM app.gem_fsd_v2_run WHERE id=$1', [body.requestId])
        ).rows[0];
        if (prior) {
          if (
            prior.organization_id !== org ||
            prior.project_id !== req.params.projectId ||
            prior.item_id !== req.params.itemId ||
            prior.actor_id !== current.user.id
          )
            throw failure(409, '请求编号已使用。');
          if (prior.request_hash !== requestHash)
            throw failure(409, '同一请求编号不能使用不同内容。');
          return { subjectId: req.params.itemId, data: present(prior) };
        }
        await db.query(
          "UPDATE app.gem_fsd_v2_run SET state='interrupted',finished_at=clock_timestamp() WHERE organization_id=$1 AND item_id=$2 AND state='running' AND lease_until<clock_timestamp()",
          [org, req.params.itemId],
        );
        const running = (
          await db.query(
            "SELECT id FROM app.gem_fsd_v2_run WHERE organization_id=$1 AND item_id=$2 AND state='running' UNION ALL SELECT id FROM app.fsd_agent_run WHERE organization_id=$1 AND snapshot->'input'->'selection'->>'itemId'=$2::text AND state IN ('queued','running') AND lease_until>clock_timestamp()",
            [org, req.params.itemId],
          )
        ).rows;
        if (running.length) throw failure(409, '本开发项已有运行，请先完成或停止。');
        let parent;
        if (body.parentId) {
          parent = (
            await db.query(
              'SELECT * FROM app.gem_fsd_v2_run WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND item_id=$4 AND actor_id=$5',
              [body.parentId, org, req.params.projectId, req.params.itemId, current.user.id],
            )
          ).rows[0];
          if (!parent || parent.state !== 'waiting_user')
            throw failure(409, '只能继续本项自己的待回答运行；不能接入旧版或其他会话。');
          if (!body.answers?.trim()) throw failure(400, '请填写业务回答。');
        }
        if (req.work.item.kind !== 'report') throw failure(422, 'v2 试用仅支持报表类需求。');
        const models = await listModels(db, org);
        if (!models.defaultModel) throw failure(409, '尚未设置默认模型。');
        const model = await getModel(db, org, models.defaultModel.id);
        if (model.versionId !== models.defaultModel.versionId)
          throw failure(409, '默认模型版本已变化，请重新确认默认配置。');
        const cred = (
          await db.query(
            'SELECT secret_cipher FROM app.llm_credential WHERE organization_id=$1 AND id=$2',
            [org, model.credentialId],
          )
        ).rows[0];
        if (!cred) throw failure(503, '模型凭据不可用。');
        const input = {
          item: {
            code: req.work.item.code,
            name: req.work.item.name,
            module: req.work.item.module,
            kind: req.work.item.kind,
            summary: req.work.item.summary,
            acceptance: req.work.item.acceptance,
          },
          prompt: parent?.input.prompt ?? body.prompt ?? '生成完整FSD',
          answers: [
            parent?.input.answers,
            parent
              ? JSON.stringify({ questions: parent.snapshot.questions, answer: body.answers })
              : body.answers,
          ]
            .filter(Boolean)
            .join('\n'),
          questions: parent?.snapshot.questions ?? [],
        };
        const context = buildV2Context(input),
          snapshot = {
            engine: V2_ENGINE,
            model: {
              id: model.id,
              versionId: model.versionId,
              modelId: model.config.modelId,
              name: model.config.name,
            },
            manifest: context.manifest,
            timeoutMs: V2_TIMEOUT_MS,
          };
        const r = (
          await db.query(
            "INSERT INTO app.gem_fsd_v2_run(id,organization_id,project_id,item_id,actor_id,conversation_id,parent_id,request_hash,state,input,snapshot,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running',$9,$10,clock_timestamp()+interval '90 seconds') RETURNING *",
            [
              body.requestId,
              org,
              req.params.projectId,
              req.params.itemId,
              current.user.id,
              parent?.conversation_id ?? randomUUID(),
              parent?.id ?? null,
              requestHash,
              input,
              snapshot,
            ],
          )
        ).rows[0];
        launch = {
          row: r,
          context,
          model: model.config,
          key: openKey(cred.secret_cipher, org, model.credentialId),
        };
        return { subjectId: req.params.itemId, data: present(r) };
      },
    );
    if (launch) {
      const controller = new AbortController();
      const entry = { controller, task: null };
      active.set(launch.row.id, entry);
      entry.task = run(req, launch, controller).finally(() => active.delete(launch.row.id));
    }
    return reply.code(launch ? 202 : 200).send(receipt);
  });
  async function run(req, { row, context, model, key }, controller) {
    let recorder,
      progress = {},
      checking = false;
    const record = (type, data) => {
      try {
        recorder.write(type, data);
      } catch {
        throw error('TRACE_WRITE_FAILED', '日志写入失败，已停止。');
      }
    };
    const timer = setInterval(async () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        await authorize(req, true);
        const q = await pool.query(
          "UPDATE app.gem_fsd_v2_run SET lease_until=clock_timestamp()+interval '90 seconds',snapshot=snapshot||$2::jsonb WHERE id=$1 AND state='running' AND lease_until>clock_timestamp()",
          [row.id, JSON.stringify({ progress })],
        );
        if (q.rowCount !== 1) controller.abort(error('INTERRUPTED', '运行租约失效。'));
      } catch (e) {
        controller.abort(e);
      } finally {
        checking = false;
      }
    }, 2000);
    timer.unref();
    try {
      recorder = createRecorder({ runId: row.id, root: v2TraceRoot });
      record('run.started', {
        engine: V2_ENGINE,
        conversationId: row.conversation_id,
        itemId: row.item_id,
      });
      const result = await executeV2({
        context,
        model,
        key,
        generate,
        record,
        signal: controller.signal,
        onProgress: (p) => {
          progress = { ...progress, ...p };
        },
      });
      controller.signal.throwIfAborted();
      await authorize(req, true);
      record('run.result', { kind: result.kind, validation: result.validation });
      const state = result.kind === 'document' ? 'completed' : 'waiting_user';
      // One atomic database operation publishes both the complete document and terminal state.
      const saved = await pool.query(
        "UPDATE app.gem_fsd_v2_run SET state=$2,markdown=$3,content_hash=$4,snapshot=snapshot||$5::jsonb,finished_at=clock_timestamp(),lease_until=NULL WHERE id=$1 AND state='running' AND lease_until>clock_timestamp() RETURNING id",
        [
          row.id,
          state,
          result.markdown ?? null,
          result.contentHash ?? null,
          JSON.stringify({
            usage: result.usage,
            generation: result.generation,
            elapsedMs: result.elapsedMs,
            validation: result.validation ?? null,
            questions: result.questions ?? null,
            progress,
          }),
        ],
      );
      if (saved.rowCount !== 1) throw error('SAVE_CONFLICT', '运行状态已改变，没有保存新版本。');
      try {
        record('run.' + state, { contentHash: result.contentHash });
      } catch {
        await pool.query('UPDATE app.gem_fsd_v2_run SET snapshot=snapshot||$2::jsonb WHERE id=$1', [
          row.id,
          JSON.stringify({
            telemetryWarning: '终态日志写入失败，文档已在数据库保存；请勿重复生成。',
          }),
        ]);
      }
    } catch (e) {
      const state =
        e.code === 'CANCELLED' ? 'cancelled' : e.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
      const info = { code: e.code ?? 'MODEL_FAILED', message: e.message ?? '运行失败' };
      try {
        record('run.' + state, { failure: info });
      } catch {}
      try {
        await pool.query(
          "UPDATE app.gem_fsd_v2_run SET state=$2,snapshot=snapshot||$3::jsonb,finished_at=clock_timestamp(),lease_until=NULL WHERE id=$1 AND state='running'",
          [row.id, state, JSON.stringify({ failure: info, progress })],
        );
      } catch (e2) {
        app.log.error({ err: e2 }, 'v2 terminal persistence failed');
      }
    } finally {
      clearInterval(timer);
    }
  }
  app.addHook('preClose', async () => {
    const jobs = [...active.values()];
    jobs.forEach((e) => e.controller.abort(error('INTERRUPTED', '服务停止，部分输出保留。')));
    await Promise.allSettled(jobs.map((e) => e.task));
  });
}
