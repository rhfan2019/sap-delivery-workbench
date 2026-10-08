import { assertLease } from './queue.mjs';
import { deliveryContext } from '../../delivery/context.mjs';
import { workspaceCapabilities } from '../access.mjs';
import { failure } from '../../../platform/auth.mjs';
import { appendRunEvent } from './events.mjs';
import { runCapability } from './authorization.mjs';

// Caller owns a transaction. Recheck authority before invoking any persistent side effect.
export async function commitNode(
  db,
  lease,
  { inputHash, outputRefs, configVersions, nextStatus = 'completed' },
  effect = async () => {},
) {
  if (!['completed', 'waiting_evidence', 'waiting_user', 'failed', 'queued'].includes(nextStatus))
    throw new Error('Invalid node transition');
  await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
    lease.organization_id,
  ]);
  await db.query('SELECT id FROM app.project WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
    lease.organization_id,
    lease.project_id,
  ]);
  const {
    rows: [workspace],
  } = await db.query(
    'SELECT * FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',
    [lease.organization_id, lease.project_id, lease.workspace_id],
  );
  const run = await assertLease(db, lease);
  try {
    const c = deliveryContext(db, run.organization_id, () => {
      throw new Error('Worker cannot create sessions');
    });
    const current = { user: { id: run.principal_user_id }, sessionId: run.principal_session_id };
    const project = await c.access(db, current, run.project_id, true);
    if (!workspace?.active) throw failure(409, '工作区已停用。');
    const scope = {
      organizationId: run.organization_id,
      projectId: run.project_id,
      actorId: run.principal_user_id,
    };
    const {
      rows: [item],
    } = await db.query(
      'SELECT * FROM app.development_item WHERE organization_id=$1 AND project_id=$2 AND id=$3',
      [run.organization_id, run.project_id, workspace.item_id],
    );
    if (!item || !(await workspaceCapabilities(db, scope, item, project))[runCapability(run)])
      throw failure(403, '任务主体无写权限。');
  } catch (error) {
    if (![403, 404, 409].includes(error.statusCode)) throw error;
    await db.query(
      "UPDATE app.fs_run SET status='waiting_user',lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1",
      [run.id],
    );
    await appendRunEvent(
      db,
      { ...run, status: 'waiting_user' },
      'run.waiting',
      '任务主体权限已失效。',
      { error_code: 'PRINCIPAL_UNAVAILABLE' },
    );
    return { status: 'waiting_user', code: 'PRINCIPAL_UNAVAILABLE' };
  }
  const {
    rows: [prior],
  } = await db.query(
    "SELECT * FROM app.fs_run_checkpoint WHERE run_id=$1 AND node_id=$2 AND input_hash=$3 AND config_versions=$4::jsonb AND config_versions->>'node_status' IN ('completed','queued') ORDER BY created_at LIMIT 1",
    [run.id, run.node_id, inputHash, { ...configVersions, node_status: nextStatus }],
  );
  if (!prior) {
    await effect(db, run);
    // Expiry during effect execution also rolls back the caller's transaction.
    await assertLease(db, lease);
    const event = await appendRunEvent(
      db,
      { ...run, status: nextStatus },
      nextStatus === 'completed'
        ? 'run.completed'
        : nextStatus === 'failed'
          ? 'run.failed'
          : nextStatus === 'queued'
            ? 'run.queued'
            : 'run.waiting',
      '任务状态已更新。',
      { entity_ids: outputRefs, retryable: nextStatus.startsWith('waiting') },
    );
    await db.query(
      `INSERT INTO app.fs_run_checkpoint(organization_id,project_id,workspace_id,run_id,node_id,attempt,input_hash,output_refs,fencing,idempotency_receipts,cancel_epoch,config_versions,last_event_sequence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]',$10,$11,$12)`,
      [
        run.organization_id,
        run.project_id,
        run.workspace_id,
        run.id,
        run.node_id,
        run.attempt,
        inputHash,
        JSON.stringify(outputRefs),
        run.fencing,
        run.cancel_epoch,
        { ...configVersions, node_status: nextStatus },
        event.sequence,
      ],
    );
  }
  await db.query(
    'UPDATE app.fs_run SET status=$2,lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1',
    [run.id, nextStatus],
  );
  return {
    status: nextStatus,
    reused: Boolean(prior),
    outputRefs: prior?.output_refs ?? outputRefs,
  };
}
