import { failure } from '../../../platform/auth.mjs';
import { readContext, executeCommand, envelope, uuidPattern } from '../workspace/commands.mjs';
import { runDto } from './service.mjs';
import { cancelRun } from './queue.mjs';
import { appendRunEvent } from './events.mjs';
import { runCapability } from './authorization.mjs';
const base = '/api/projects/:projectId/development-items/:id/fs-workspace';
async function loadRun(db, scope, id) {
  if (!uuidPattern.test(id)) throw failure(404, '任务不存在或无权访问。');
  const {
    rows: [row],
  } = await db.query(
    'SELECT r.*,(SELECT coalesce(max(sequence),0)::text FROM app.fs_run_event WHERE run_id=r.id) AS last_sequence FROM app.fs_run r WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!row) throw failure(404, '任务不存在或无权访问。');
  return row;
}
export function registerRunRoutes(app, c) {
  const capabilityFor = async (req) => {
    const { scope } = await readContext(c, req);
    return runCapability(await loadRun(c.pool, scope, req.params.runId));
  };
  app.get(base + '/runs/:runId', async (req) => {
    const { scope } = await readContext(c, req);
    return envelope(req, runDto(await loadRun(c.pool, scope, req.params.runId)));
  });
  app.post(base + '/runs/:runId/cancel', async (req) =>
    executeCommand(
      c,
      req,
      'cancelFsRun',
      async (db, scope) => {
        const prior = await loadRun(db, scope, req.params.runId);
        if (prior.intent === 'export' && prior.principal_user_id !== scope.actorId)
          throw failure(403, '只能取消自己发起的导出。');
        const row = await cancelRun(db, scope, req.params.runId);
        if (prior.status !== row.status)
          await appendRunEvent(db, row, 'run.cancelled', '任务已取消。');
        return { data: runDto(row), result_ids: [row.id] };
      },
      { head: false, capability: await capabilityFor(req) },
    ),
  );
  app.post(base + '/runs/:runId/resume', async (req, reply) => {
    const result = await executeCommand(
      c,
      req,
      'resumeFsRun',
      async (db, scope) => {
        const row = await loadRun(db, scope, req.params.runId);
        if (!['waiting_evidence', 'waiting_user', 'failed'].includes(row.status))
          throw failure(409, '任务当前状态不可恢复。');
        if (row.principal_user_id !== scope.actorId) throw failure(403, '只能恢复自己发起的任务。');
        if (row.attempt >= (row.budget_json.max_attempts ?? 3))
          throw failure(422, '任务重试预算已耗尽。');
        if (req.body.checkpoint_id) {
          const found = await db.query(
            'SELECT id FROM app.fs_run_checkpoint WHERE run_id=$1 AND id=$2',
            [row.id, req.body.checkpoint_id],
          );
          if (!found.rowCount) throw failure(404, '断点不存在或不属于此任务。');
        }
        const {
          rows: [updated],
        } = await db.query(
          "UPDATE app.fs_run SET status='queued',principal_session_id=$2,next_attempt_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [row.id, scope.sessionId],
        );
        await appendRunEvent(db, updated, 'run.queued', '任务已重新排队。');
        return { data: runDto(updated), result_ids: [row.id] };
      },
      { head: false, capability: await capabilityFor(req) },
    );
    reply.code(202);
    return result;
  });
}
