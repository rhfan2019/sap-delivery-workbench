import { randomUUID } from 'node:crypto';
import { failure, transaction } from '../auth.mjs';

// All organization administration mutations share one lock. This keeps privilege
// changes and last-administrator checks atomic without a role/permission engine.
export function adminContext(pool, organizationId, requireSession) {
  async function authorize(req, db = pool) {
    const current = await requireSession(req, true);
    const { rows } = await db.query(
      `SELECT 1 FROM app.organization_member m JOIN app.app_user u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND m.access_level='admin' AND u.status='active'`,
      [organizationId, current.user.id],
    );
    if (!rows[0]) throw failure(403, '此功能仅限企业管理员使用。');
    return current;
  }
  async function write(req, action, subjectType, operation, transactionOptions) {
    // Authenticate before taking a database lock to avoid nested pool exhaustion.
    const current = await authorize(req);
    return transaction(
      pool,
      async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [organizationId]);
        const { rows } = await db.query(
          `SELECT 1 FROM app.organization_member m JOIN app.app_user u ON u.id=m.user_id
        JOIN app.user_password p ON p.user_id=u.id JOIN app.auth_session s ON s.user_id=u.id AND s.organization_id=m.organization_id
        JOIN app.organization o ON o.id=m.organization_id
        WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND m.access_level='admin'
        AND u.status='active' AND o.status='active' AND NOT p.must_change_password
        AND s.id=$3 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()`,
          [organizationId, current.user.id, current.sessionId],
        );
        if (!rows[0]) throw failure(403, '管理权限或登录状态已变化，请刷新页面。');
        const result = await operation(db, current);
        await db.query(
          `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id)
        VALUES($1,$2,$3,'success',$4,$5,$6)`,
          [organizationId, current.user.id, action, subjectType, result.subjectId, randomUUID()],
        );
        return result.data;
      },
      transactionOptions,
    );
  }
  return { pool, organizationId, authorize, write };
}
export function changed(result) {
  if (!result.rows[0]) throw failure(409, '数据已被其他操作更新，请刷新后重试。');
  return result.rows[0];
}
export function found(result, label = '记录') {
  if (!result.rows[0]) throw failure(404, `${label}不存在或不属于当前企业。`);
  return result.rows[0];
}
