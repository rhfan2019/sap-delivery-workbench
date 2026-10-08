import { randomUUID } from 'node:crypto';
import { failure } from '../../../platform/auth.mjs';
import { validateDomain } from '@sap-delivery-workbench/contracts/fs-workspace';
import { readContext, uuidPattern, commandError } from '../workspace/commands.mjs';

export async function appendRunEvent(db, run, type, message, extra = {}) {
  await db.query('SELECT id FROM app.fs_run WHERE id=$1 FOR UPDATE', [run.id]);
  const {
    rows: [counter],
  } = await db.query(
    'SELECT coalesce(max(sequence),0)::text AS n FROM app.fs_run_event WHERE run_id=$1',
    [run.id],
  );
  const sequence = BigInt(counter.n) + 1n;
  if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw failure(409, '事件序列超出范围。');
  const {
    rows: [doc],
  } = await db.query(
    `SELECT d.ast FROM app.fs_document_revision d WHERE d.workspace_id=$1
    ORDER BY (d.id::text=(SELECT entry->>'id' FROM app.fs_context_snapshot s,jsonb_array_elements(s.version_manifest) entry WHERE s.id=$2 AND entry->>'kind'='document' LIMIT 1)) DESC NULLS LAST,d.seq LIMIT 1`,
    [run.workspace_id, run.input_snapshot_id],
  );
  const event = {
    schema_version: '1.0.0',
    context: {
      ...doc.ast.context,
      run_id: run.id,
      session_id: run.session_id ?? doc.ast.context.session_id,
      context_snapshot_id: run.input_snapshot_id,
    },
    event_id: randomUUID(),
    sequence: Number(sequence),
    occurred_at: new Date().toISOString(),
    event_type: type,
    run_status: run.status,
    node_id: run.node_id,
    data: {
      message,
      progress: null,
      entity_ids: [],
      error_code: null,
      retryable: false,
      result_version_id: null,
      checkpoint_id: null,
      ...extra,
    },
  };
  if (!validateDomain('RunEvent', event).ok) throw new Error('Invalid server event');
  await db.query(
    'INSERT INTO app.fs_run_event(organization_id,project_id,workspace_id,run_id,sequence,event_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      run.organization_id,
      run.project_id,
      run.workspace_id,
      run.id,
      sequence.toString(),
      event.event_id,
      event,
    ],
  );
  return event;
}
export async function readRunEvents(db, scope, id, after) {
  if (!uuidPattern.test(id)) throw failure(404, '任务不存在或无权访问。');
  if (
    typeof after !== 'string' ||
    !/^\d{1,16}$/.test(after) ||
    BigInt(after) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw failure(400, '事件游标无效。');
  const {
    rows: [run],
  } = await db.query(
    'SELECT id FROM app.fs_run WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!run) throw failure(404, '任务不存在或无权访问。');
  const {
    rows: [range],
  } = await db.query(
    'SELECT coalesce(min(sequence),1)::text AS first,coalesce(max(sequence),0)::text AS last FROM app.fs_run_event WHERE run_id=$1',
    [id],
  );
  if (
    BigInt(after) > BigInt(range.last) ||
    (BigInt(after) > 0n && BigInt(after) < BigInt(range.first) - 1n)
  )
    throw commandError(409, 'EVENT_CURSOR_EXPIRED', '事件游标不在可恢复范围，请刷新快照。');
  return (
    await db.query(
      'SELECT payload FROM app.fs_run_event WHERE run_id=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT 100',
      [id, after],
    )
  ).rows.map((r) => r.payload);
}
export function registerEventRoutes(app, c) {
  const streams = new Set();
  app.addHook('onClose', async () => {
    for (const close of streams) close();
  });
  app.get(
    '/api/projects/:projectId/development-items/:id/fs-workspace/runs/:runId/events',
    async (req, reply) => {
      let { scope } = await readContext(c, req),
        cursor = String(req.headers['last-event-id'] ?? req.query.after ?? '0');
      let pending = await readRunEvents(c.pool, scope, req.params.runId, cursor),
        closed = false,
        timer,
        inFlight = false,
        lastHeartbeat = Date.now();
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        streams.delete(close);
        reply.raw.end();
      };
      const flush = (events) => {
        for (const event of events) {
          if (
            !reply.raw.write(
              `id: ${event.sequence}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
          ) {
            close();
            return;
          }
          cursor = String(event.sequence);
        }
      };
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      streams.add(close);
      reply.raw.on('close', close);
      flush(pending);
      const poll = async () => {
        if (closed || inFlight) return;
        inFlight = true;
        try {
          ({ scope } = await readContext(c, req));
          pending = await readRunEvents(c.pool, scope, req.params.runId, cursor);
          flush(pending);
          const {
            rows: [run],
          } = await c.pool.query('SELECT status FROM app.fs_run WHERE id=$1', [req.params.runId]);
          if (!pending.length && ['completed', 'cancelled', 'failed'].includes(run.status)) {
            close();
            return;
          }
          if (Date.now() - lastHeartbeat >= 15000) {
            reply.raw.write(': heartbeat\n\n');
            lastHeartbeat = Date.now();
          }
        } catch {
          close();
        } finally {
          inFlight = false;
        }
      };
      await poll();
      if (!closed) timer = setInterval(poll, 1000);
    },
  );
}
