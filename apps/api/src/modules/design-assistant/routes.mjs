import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { createWorkContext } from '../item-workspace/public.mjs';
import { getModel, listModels } from '../models/public.mjs';
import { parseFile } from '../agent-runtime/public.mjs';
import { createTask, command, loadTask, event, saveTask } from './repository.mjs';
import { assetManifest } from './assets.mjs';
import { fault, hash, safeError } from './policy.mjs';
import { createTelemetry } from './telemetry.mjs';
import { registeredTarget } from './sap.mjs';
import { audit } from '../../platform/auth.mjs';
import { registerChatRoutes } from './chat-routes.mjs';
import { chatArtifact } from './chat-workflow.mjs';

export const designBase = '/api/projects/:projectId/development-items/:itemId/work/design/fsd/v1';
const uuid = (v) => {
  if (!/^[0-9a-f-]{36}$/i.test(v ?? '')) throw fault('INVALID_ID');
  return v;
};
function fields(body, allowed) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw fault('INVALID_INPUT');
}
export function registerDesignRoutes(
  app,
  pool,
  org,
  requireSession,
  { telemetry = createTelemetry(), onBoundary } = {},
) {
  const c = createWorkContext(pool, org, requireSession);
  registerChatRoutes(app, pool, org, requireSession, designBase + '/chat');
  let activeParsers = 0;
  async function authorize(req, db = pool, write = false) {
    req.params.stage = 'design';
    await c.authorize(req, db, write);
    return req.work.scope;
  }
  async function write(req, fn) {
    req.params.stage = 'design';
    return c.write(req, 'fsd.v1.command', 'development_item', async (db) => ({
      subjectId: req.params.itemId,
      data: await telemetry.span('api.command', {}, async (span) => {
        const data = await fn(db, req.work.scope);
        span.setAttributes({
          task_id: req.params.taskId ?? data.id,
          logical_run_id: data.active_run_id,
        });
        return data;
      }),
    }));
  }
  const task = async (req, db = pool, lock = false) =>
    loadTask(db, req.work.scope, uuid(req.params.taskId), lock);
  app.get(designBase + '/models', async (req) => {
    await authorize(req);
    return listModels(pool, org);
  });
  app.get(designBase + '/tasks', async (req) => {
    await authorize(req);
    return {
      items: (
        await pool.query(
          "SELECT id,revision,state->>'status' AS status,state->>'phase' AS phase,created_at FROM app.fsd_v1_task WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND (NOT(state ? 'chat') OR actor_id=$4) ORDER BY created_at DESC LIMIT 100",
          [org, req.params.projectId, req.params.itemId, req.work.scope.actorId],
        )
      ).rows,
    };
  });
  app.post(designBase + '/tasks', { bodyLimit: 150000 }, async (req) =>
    write(req, async (db, scope) => {
      fields(req.body, ['request_id', 'text', 'mode', 'model_id', 'target']);
      let model;
      if (req.body.mode === 'REAL') {
        if (process.env.FSD_REAL_INPUT_APPROVED !== 'true')
          throw fault('REAL_INPUT_NOT_APPROVED', 'INPUT', 409);
        const selected = await getModel(db, org, uuid(req.body.model_id));
        model = {
          mode: 'REAL',
          version_id: selected.versionId,
          id: selected.config.modelId,
          protocol: selected.config.protocol,
          config_hash: hash(selected.config),
        };
      } else if (req.body.mode !== 'SYNTHETIC') throw fault('INVALID_INPUT');
      // Target context is server-controlled. Real target registration is an explicit deployment prerequisite.
      const target =
        req.body.mode === 'SYNTHETIC'
          ? { target_ref: 'synthetic', client: '000', allowed_urls: [] }
          : await registeredTarget(scope, req.body.target?.target_ref);
      return createTask(db, scope, { ...req.body, target }, await assetManifest(model));
    }),
  );
  app.get(designBase + '/tasks/:taskId', async (req) => {
    await authorize(req);
    return task(req);
  });
  app.post(designBase + '/tasks/:taskId/commands', { bodyLimit: 150000 }, async (req) => {
    const allowed = [
      'request_id',
      'command',
      'revision',
      'question_id',
      'option_id',
      'text',
      'attachment_ids',
      'artifact_id',
      'artifact_version',
      'scope',
      'confirmed',
      'condition',
      'reason',
      'increments',
    ];
    fields(req.body, allowed);
    const result = await write(req, (db, scope) =>
      command(db, scope, uuid(req.params.taskId), req.body),
    );
    await onBoundary?.('after_decision_commit_before_dispatch', { run_id: result.active_run_id });
    return result;
  });
  const events = async (req) => {
    await authorize(req);
    const t = await task(req);
    const raw = req.query.after ?? req.headers['last-event-id'] ?? '0';
    if (!/^\d{1,18}$/.test(String(raw))) throw fault('INVALID_CURSOR');
    return (
      await pool.query(
        'SELECT sequence::text AS cursor,id,event_type,data,created_at FROM app.fsd_v1_event WHERE task_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 200',
        [t.id, raw],
      )
    ).rows;
  };
  app.get(designBase + '/tasks/:taskId/events', async (req) => ({ items: await events(req) }));
  app.get(designBase + '/tasks/:taskId/stream', async (req, reply) => {
    const rows = await events(req);
    reply.header('Content-Type', 'text/event-stream').header('Cache-Control', 'no-store');
    // Finite batches deliberately reconnect and reauthorize. IDs derive from committed facts.
    return (
      'retry: 1000\n\n' +
      rows.map((e) => `id: ${e.cursor}\nevent: progress\ndata: ${JSON.stringify(e)}\n\n`).join('') +
      ': durable progress; not model tokens\n\n'
    );
  });
  app.post(designBase + '/tasks/:taskId/attachments', { bodyLimit: 29000000 }, async (req) =>
    write(req, async (db) => {
      const t = await task(req, db, true);
      fields(req.body, ['name', 'media_type', 'base64', 'revision']);
      const { name, media_type, base64, revision } = req.body;
      if (revision !== t.revision) throw fault('VERSION_CONFLICT', 'BUSINESS_COMMIT', 409);
      if (
        typeof name !== 'string' ||
        name.length > 180 ||
        /[\\/\x00-\x1f]|\.\./.test(name) ||
        !/\.(txt|md|csv|json|xml|abap|pdf|docx|xlsx|png|jpg|jpeg)$/i.test(name) ||
        typeof base64 !== 'string' ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
      )
        throw fault('INVALID_ATTACHMENT');
      const bytes = Buffer.from(base64, 'base64');
      if (!bytes.length || bytes.length > 20 * 1024 * 1024)
        throw fault('PAYLOAD_TOO_LARGE', 'INPUT', 413);
      const quota = (
        await db.query(
          'SELECT count(*)::int AS n,COALESCE(sum(octet_length(bytes)),0)::bigint AS size FROM app.fsd_v1_attachment WHERE task_id=$1',
          [t.id],
        )
      ).rows[0];
      if (quota.n >= 10 || Number(quota.size) + bytes.length > 52428800)
        throw fault('PAYLOAD_TOO_LARGE', 'INPUT', 413);
      if (activeParsers >= 2) throw fault('RATE_LIMIT', 'INPUT', 429);
      const id = randomUUID(),
        directory = resolve('.runtime/cache/fsd-materials'),
        file = resolve(directory, id);
      let extraction;
      activeParsers++;
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(file, bytes, { flag: 'wx' });
        extraction = await parseFile(file, name);
      } finally {
        activeParsers--;
        await unlink(file).catch(() => {});
      }
      await db.query(
        'INSERT INTO app.fsd_v1_attachment(id,task_id,name,media_type,bytes,content_hash,extraction) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          t.id,
          name,
          String(media_type ?? 'application/octet-stream').slice(0, 100),
          bytes,
          createHash('sha256').update(bytes).digest('hex'),
          extraction,
        ],
      );
      t.attachment_ids.push(id);
      t.revision++;
      await saveTask(db, t);
      await db.query('UPDATE app.fsd_v1_run SET expected_revision=$2 WHERE id=$1', [
        t.active_run_id,
        t.revision,
      ]);
      await event(
        db,
        t.id,
        t.active_run_id,
        'attachment.stored',
        { attachment_id: id, state: extraction.state },
        req.work.scope.actorId,
      );
      return {
        id,
        name,
        state: extraction.state,
        warnings: extraction.warnings,
        revision: t.revision,
      };
    }),
  );
  app.get(designBase + '/tasks/:taskId/attachments/:attachmentId', async (req, reply) => {
    await authorize(req);
    const t = await task(req);
    const row = (
      await pool.query('SELECT * FROM app.fsd_v1_attachment WHERE id=$1 AND task_id=$2', [
        uuid(req.params.attachmentId),
        t.id,
      ])
    ).rows[0];
    if (!row) throw fault('NOT_FOUND', 'INPUT', 404);
    await event(
      pool,
      t.id,
      null,
      'attachment.downloaded',
      { attachment_id: row.id },
      req.work.scope.actorId,
    );
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .send(row.bytes);
  });
  app.get(designBase + '/tasks/:taskId/diagnostics', async (req) => {
    let t;
    try {
      await authorize(req);
      t = await task(req);
    } catch (error) {
      if ([401, 403, 404].includes(error.statusCode)) {
        const identity = await requireSession(req).catch(() => null);
        await audit(pool, 'fsd.v1.diagnostic.denied', 'failure', org, identity?.user?.id ?? null);
      }
      throw error;
    }
    await event(pool, t.id, t.active_run_id, 'diagnostic.downloaded', {}, req.work.scope.actorId);
    return diagnostics(pool, t, telemetry.metrics());
  });
  app.get(designBase + '/tasks/:taskId/runs/:runId/context', async (req) => {
    await authorize(req);
    const t = await task(req);
    const run = (
      await pool.query(
        'SELECT id,input_snapshot_id,snapshot,assets FROM app.fsd_v1_run WHERE id=$1 AND task_id=$2',
        [uuid(req.params.runId), t.id],
      )
    ).rows[0];
    if (!run) throw fault('NOT_FOUND', 'INPUT', 404);
    await event(
      pool,
      t.id,
      run.id,
      'context.downloaded',
      { input_snapshot_id: run.input_snapshot_id },
      req.work.scope.actorId,
    );
    return {
      run_id: run.id,
      input_snapshot_id: run.input_snapshot_id,
      snapshot: run.snapshot,
      assets: run.assets,
      source_content_included: true,
      sha256: hash(run.snapshot),
    };
  });
  app.post(designBase + '/tasks/:taskId/replay', async (req) =>
    write(req, async (db, scope) => {
      const original = await task(req, db);
      fields(req.body, ['request_id']);
      const source = (
        await db.query('SELECT * FROM app.fsd_v1_run WHERE id=$1', [original.active_run_id])
      ).rows[0];
      const replay = await createTask(
        db,
        scope,
        {
          request_id: req.body.request_id,
          text: source.snapshot.text,
          mode: 'SYNTHETIC',
          target: source.snapshot.target,
          replay_of_task_id: original.id,
        },
        source.assets,
      );
      const existing = await loadTask(db, scope, replay.id);
      if (existing.publication_disabled) return existing;
      replay.replay_of_task_id = original.id;
      replay.replay_of_run_id = original.active_run_id;
      replay.publication_disabled = true;
      await saveTask(db, replay);
      replay.input = { text: source.snapshot.text };
      replay.answers = source.snapshot.answers;
      replay.document = source.snapshot.base_document ?? null;
      replay.artifact_version = source.snapshot.artifact_version;
      replay.evidence = structuredClone(source.snapshot.base_evidence ?? []);
      await saveTask(db, replay);
      await db.query('UPDATE app.fsd_v1_run SET snapshot=$2,state=state || $3::jsonb WHERE id=$1', [
        replay.active_run_id,
        source.snapshot,
        {
          processing_kind: 'FIXED_REPLAY',
          replay_of_run_id: source.id,
          replay_at: source.updated_at,
        },
      ]);
      await event(
        db,
        replay.id,
        replay.active_run_id,
        'replay.created',
        { replay_of_run_id: original.active_run_id },
        scope.actorId,
      );
      return replay;
    }),
  );
  app.get(designBase + '/tasks/:taskId/artifacts/:artifactId', async (req, reply) => {
    await authorize(req);
    const t = await task(req);
    const a = t.artifacts.find((x) => x.id === uuid(req.params.artifactId));
    if (!a) throw fault('NOT_FOUND', 'INPUT', 404);
    return telemetry.span(
      'artifact.export',
      { task_id: t.id, logical_run_id: t.active_run_id },
      async () => {
        const format = req.query.format ?? 'json';
        if (!['json', 'docx'].includes(format)) throw fault('INVALID_FORMAT');
        await event(
          pool,
          t.id,
          t.active_run_id,
          'artifact.downloaded',
          { artifact_id: a.id, version: a.version, format },
          req.work.scope.actorId,
        );
        const label =
          t.mode === 'SYNTHETIC'
            ? '合成测试成果（非真实 SAP 开发依据）'
            : t.delivered_artifact_id === a.id
              ? '已确认 FSD'
              : '工作稿（未交付）';
        if (format === 'json') return { label, ...a };
        // Interim Word export: the rendered Markdown line by line, headings mapped. The
        // template-based Word rendering of the document is a separate step.
        const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
        const children = [
          new Paragraph({ text: label, heading: HeadingLevel.TITLE }),
          ...chatArtifact(a)
            .markdown.split('\n')
            .filter((line) => line.trim() && !/^\|(\s*-+\s*\|)+$/.test(line.trim()))
            .map((line) => {
              const h = /^(#{1,3})\s+(.*)$/.exec(line);
              return h
                ? new Paragraph({ text: h[2], heading: headings[h[1].length - 1] })
                : new Paragraph(line);
            }),
          new Paragraph('证据引用：' + a.evidence_refs.join(', ')),
        ];
        const bytes = await Packer.toBuffer(new Document({ sections: [{ children }] }));
        return reply
          .header(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          )
          .header('Content-Disposition', `attachment; filename="FSD-v${a.version}.docx"`)
          .send(bytes);
      },
    );
  });
}
export async function diagnostics(db, t, observation = { degraded: true }) {
  const runs = (
    await db.query(
      'SELECT id,thread_id,input_snapshot_id,snapshot,status,generation,state,assets FROM app.fsd_v1_run WHERE task_id=$1 ORDER BY created_at',
      [t.id],
    )
  ).rows;
  const timeline = (
    await db.query(
      'SELECT sequence::text,id,run_id,event_type,data,created_at FROM app.fsd_v1_event WHERE task_id=$1 ORDER BY sequence',
      [t.id],
    )
  ).rows;
  const attempts = (
    await db.query(
      'SELECT a.* FROM app.fsd_v1_attempt a JOIN app.fsd_v1_run r ON r.id=a.run_id WHERE r.task_id=$1',
      [t.id],
    )
  ).rows;
  const operations = (
    await db.query(
      'SELECT o.id,o.kind,o.status,o.reservation,o.result_hash,o.error,o.created_at,o.settled_at FROM app.fsd_v1_operation o JOIN app.fsd_v1_run r ON r.id=o.run_id WHERE r.task_id=$1 ORDER BY o.created_at',
      [t.id],
    )
  ).rows;
  const checkpointTable = (
    await db.query("SELECT to_regclass('fsd_checkpoint.checkpoints') AS name")
  ).rows[0].name;
  const checkpoints = checkpointTable
    ? (
        await db.query(
          'SELECT thread_id,max(checkpoint_id) AS id FROM fsd_checkpoint.checkpoints WHERE thread_id=ANY($1::text[]) GROUP BY thread_id',
          [runs.map((r) => r.thread_id)],
        )
      ).rows
    : [];
  const safeRuns = runs.map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    input_snapshot_id: r.input_snapshot_id,
    input_hash: hash(r.snapshot),
    status: r.status,
    generation: r.generation,
    error: r.state.error ? safeError(r.state.error) : null,
    checkpoint_id:
      checkpoints.find((c) => c.thread_id === r.thread_id)?.id ?? r.state.checkpoint_id ?? null,
    worker_ack_checkpoint_id: r.state.checkpoint_id ?? null,
    budget: r.state.budget,
    assets: {
      graph: r.assets.graph,
      prompt_hash: r.assets.prompt_hash,
      schema: r.assets.schema,
      dependencies: r.assets.dependencies,
    },
    next_actions: r.status === 'WAITING' ? ['inspect', 'recover', 'replay'] : ['inspect'],
  }));
  const safeTimeline = timeline.map((e) => ({
    id: e.id,
    cursor: e.sequence,
    run_id: e.run_id,
    event_type: e.event_type,
    trace_id: /^[a-f0-9]{32}$/.test(e.data.trace_context?.trace_id ?? '')
      ? e.data.trace_context.trace_id
      : null,
    at: e.created_at,
    refs: Object.fromEntries(
      Object.entries({
        ...e.data,
        ...(e.data.error_code ? { error_code: safeError({ code: e.data.error_code }).code } : {}),
        ...(e.data.error_origin
          ? { error_origin: safeError({ error_origin: e.data.error_origin }).error_origin }
          : {}),
      }).filter(
        ([k, v]) =>
          /^(attempt_id|checkpoint_id|checkpoint_from|thread_id|commit_key|decision_id|artifact_id|artifact_version|node_id|operation_id|error_code|error_origin|result|before_revision|after_revision)$/.test(
            k,
          ) && ['string', 'number', 'boolean'].includes(typeof v),
      ),
    ),
  }));
  const payload = {
    diagnostic_schema_version: 1,
    task_id: t.id,
    status: t.status,
    phase: t.phase,
    revision: t.revision,
    mode: t.mode,
    runs: safeRuns,
    attempts: attempts.map((a) => ({
      id: a.id,
      run_id: a.run_id,
      trace_id: a.trace_id,
      span_id: a.state.span_id ?? null,
      recovery_of_trace_id: a.state.recovery_of_trace_id ?? null,
      generation: a.generation,
      started_at: a.started_at,
      ended_at: a.ended_at,
      error: a.state.error ? safeError(a.state.error) : null,
    })),
    timeline: safeTimeline,
    observation,
    missing_spans: observation.degraded
      ? 'Trace completeness unverified; persisted audit retained'
      : null,
    sap_internal_coverage: false,
    evidence: t.evidence.map((e) => ({
      id: e.id,
      hash: hash(e),
      validity: e.validity,
      read_generation: e.read_generation,
      limitations: e.limitations,
    })),
    source_content_included: false,
  };
  payload.operations = operations.map((o) => ({
    id: o.id,
    kind: o.kind,
    status: o.status,
    result_hash: o.result_hash,
    error: o.error ? safeError(o.error) : null,
    reserved_tokens: o.reservation.tokens,
    actual_tokens: o.reservation.actual_tokens ?? null,
    usage_known: o.reservation.usage_known ?? false,
    cost: null,
    duration_ms: o.settled_at ? new Date(o.settled_at) - new Date(o.created_at) : null,
  }));
  payload.task_metrics = {
    queued_runs: runs.filter((r) => r.status === 'QUEUED').length,
    failed_operations: operations.filter((o) => o.status === 'UNKNOWN').length,
    total_operations: operations.length,
    tokens: t.budget.tokens,
    active_ms: t.budget.active_ms,
    recovery_attempts: Math.max(0, attempts.length - runs.length),
    budget_exhaustions: safeTimeline.filter((e) => e.refs.error_code === 'BUDGET_EXHAUSTED').length,
    state_conflicts: safeTimeline.filter((e) => e.refs.error_code === 'VERSION_CONFLICT').length,
  };
  return { ...payload, sha256: hash(payload) };
}
