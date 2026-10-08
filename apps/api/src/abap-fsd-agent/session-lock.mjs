// Shared session locking and interrupted development-run recovery.
import { failure } from '../auth.mjs';
export async function lockSession(db, org, actor, id) {
  const {
    rows: [session],
  } = await db.query(
    'SELECT * FROM app.fsd_agent_session WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND cleared_at IS NULL FOR UPDATE',
    [org, actor, id],
  );
  if (!session) throw failure(404, '会话不存在或无权访问。');
  return session;
}
export async function recoverInterruptedRuns(db, id) {
  await db.query(
    `UPDATE app.fsd_agent_run SET state='failed',snapshot=snapshot || jsonb_build_object('failure',jsonb_build_object('code','INTERRUPTED','message','服务重启或运行租约失效，请重新发送。'),'finishedAt',clock_timestamp()) WHERE conversation_id=$1 AND state IN ('queued','running') AND (lease_until IS NULL OR lease_until<clock_timestamp())`,
    [id],
  );
}
export async function assertIdle(db, id) {
  await recoverInterruptedRuns(db, id);
  const { rows } = await db.query(
    "SELECT id FROM app.fsd_agent_run WHERE conversation_id=$1 AND state IN ('queued','running') LIMIT 1",
    [id],
  );
  if (rows.length) throw failure(409, '生成正在进行，请先等待完成或取消运行。');
}
