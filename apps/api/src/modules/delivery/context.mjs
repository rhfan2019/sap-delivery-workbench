import { failure, transaction } from '../../platform/auth.mjs';
import { uuid } from '../admin/validation.mjs';

export function deliveryContext(pool, organizationId, requireSession) {
  async function access(db, current, projectId, write = false) {
    uuid(projectId);
    const { rows } = await db.query(
      `SELECT p.*,om.access_level FROM app.project p
      JOIN app.project_member pm ON pm.organization_id=p.organization_id AND pm.project_id=p.id AND pm.user_id=$2
      JOIN app.organization_member om ON om.organization_id=p.organization_id AND om.user_id=pm.user_id
      JOIN app.app_user u ON u.id=pm.user_id JOIN app.organization o ON o.id=p.organization_id
      JOIN app.auth_session s ON s.id=$4 AND s.user_id=u.id AND s.organization_id=p.organization_id
      JOIN app.user_password pw ON pw.user_id=u.id
      WHERE p.organization_id=$1 AND p.id=$3 AND pm.status='active' AND om.status='active'
      AND u.status='active' AND o.status='active' AND NOT pw.must_change_password
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()`,
      [organizationId, current.user.id, projectId, current.sessionId],
    );
    if (!rows[0]) throw failure(404, '项目不存在或无权访问。');
    if (write && rows[0].status === 'archived') throw failure(409, '项目已归档，只能查看。');
    return rows[0];
  }
  async function read(req) {
    const current = await requireSession(req, true);
    const project = await access(pool, current, req.params.projectId);
    return { current, project };
  }
  async function write(req, operation, transactionOptions) {
    const current = await requireSession(req, true);
    return transaction(
      pool,
      async (db) => {
        // Coordinate membership changes and archive mutations with existing administration.
        await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
          organizationId,
        ]);
        const project = await access(db, current, req.params.projectId, true);
        return operation(db, current, project);
      },
      transactionOptions,
    );
  }
  async function item(db, req, lock = false) {
    uuid(req.params.id);
    const { rows } = await db.query(
      `SELECT * FROM app.development_item WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
      [organizationId, req.params.projectId, req.params.id],
    );
    if (!rows[0]) throw failure(404, '开发项不存在或无权访问。');
    return rows[0];
  }
  async function event(db, req, current, action, changes = {}) {
    await db.query(
      'INSERT INTO app.development_event(organization_id,project_id,item_id,actor_id,action,changes) VALUES($1,$2,$3,$4,$5,$6)',
      [
        organizationId,
        req.params.projectId,
        req.params.id,
        current.user.id,
        action,
        JSON.stringify(changes),
      ],
    );
  }
  return { pool, organizationId, requireSession, access, read, write, item, event };
}
