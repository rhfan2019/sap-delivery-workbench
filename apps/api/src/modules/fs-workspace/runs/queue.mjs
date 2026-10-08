import { failure } from '../../../platform/auth.mjs';
import { appendRunEvent } from './events.mjs';

export async function claimRun(db, workerId, organizationId) {
  if (typeof workerId !== 'string' || !workerId.length || workerId.length > 120)
    throw new Error('Invalid worker identity');
  const { rows } = await db.query(
    `WITH candidate AS (
    SELECT r.id FROM app.fs_run r JOIN app.fs_workspace w ON w.id=r.workspace_id
    WHERE r.organization_id=$1 AND w.active AND r.next_attempt_at<=clock_timestamp()
      AND r.attempt < coalesce((r.budget_json->>'max_attempts')::integer,3)
      AND (r.status='queued' OR (r.status='running' AND r.lease_until<clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM app.fs_run other WHERE other.workspace_id=r.workspace_id AND other.id<>r.id AND other.is_write AND r.is_write AND other.status IN ('running','cancel_requested'))
    ORDER BY r.created_at,r.id FOR UPDATE OF w,r SKIP LOCKED LIMIT 1
  ) UPDATE app.fs_run r SET status='running',lease_owner=$2,lease_until=clock_timestamp()+interval '30 seconds',fencing=fencing+1,attempt=attempt+1,updated_at=clock_timestamp()
    FROM candidate WHERE r.id=candidate.id RETURNING r.*`,
    [organizationId, workerId],
  );
  return rows[0] ?? null;
}

// Caller owns the transaction; workspace-before-run matches command/commit lock ordering.
export async function expireExhaustedRuns(db, organizationId) {
  const { rows } = await db.query(
    `SELECT r.* FROM app.fs_run r JOIN app.fs_workspace w ON w.id=r.workspace_id
    WHERE r.organization_id=$1 AND r.attempt>=coalesce((r.budget_json->>'max_attempts')::integer,3)
    AND (r.status='queued' OR (r.status='running' AND r.lease_until<clock_timestamp()))
    ORDER BY r.created_at,r.id FOR UPDATE OF w,r SKIP LOCKED LIMIT 20`,
    [organizationId],
  );
  for (const run of rows) {
    await db.query(
      "UPDATE app.fs_run SET status='failed',lease_owner=NULL,lease_until=NULL,fencing=fencing+1,budget_json=budget_json||jsonb_build_object('error_code','RETRY_BUDGET_EXHAUSTED'),updated_at=clock_timestamp() WHERE id=$1",
      [run.id],
    );
    await appendRunEvent(
      db,
      { ...run, status: 'failed' },
      'run.failed',
      '任务执行次数已达到上限。',
      { error_code: 'RETRY_BUDGET_EXHAUSTED', retryable: false },
    );
  }
  return rows.length;
}
export async function renewLease(db, lease) {
  const result = await db.query(
    `UPDATE app.fs_run SET lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()
    WHERE id=$1 AND lease_owner=$2 AND fencing=$3 AND cancel_epoch=$4 AND status='running' AND lease_until>clock_timestamp()`,
    [lease.id, lease.lease_owner, lease.fencing, lease.cancel_epoch],
  );
  return result.rowCount === 1;
}
// Caller must hold a transaction through all node side effects and checkpoint writes.
export async function assertLease(db, lease) {
  const { rows } = await db.query(
    `SELECT * FROM app.fs_run WHERE id=$1 AND lease_owner=$2 AND fencing=$3 AND cancel_epoch=$4 AND status='running' AND lease_until>clock_timestamp() FOR UPDATE`,
    [lease.id, lease.lease_owner, lease.fencing, lease.cancel_epoch],
  );
  if (!rows.length) throw failure(409, '任务租约失效或任务已取消。');
  return rows[0];
}
// External calls may still finish, but incrementing the epoch fences every later commit.
export async function cancelRun(db, scope, id) {
  const { rows } = await db.query(
    `UPDATE app.fs_run SET status=CASE WHEN status IN ('completed','failed','cancelled') THEN status ELSE 'cancelled' END,
    cancel_epoch=cancel_epoch+1,lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4 RETURNING *`,
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!rows.length) throw failure(404, '任务不存在或无权访问。');
  return rows[0];
}
