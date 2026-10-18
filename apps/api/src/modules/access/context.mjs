import { randomUUID } from 'node:crypto';
import { failure, transaction } from '../../platform/auth.mjs';
import { createAccess } from './kernel.mjs';

// Request helpers on top of the kernel: read and write handlers that authorize a permission,
// re-validate the session inside the transaction, lock, and write the audit event.
export function accessContext(pool, organizationId, requireSession) {
  const access = createAccess(pool, organizationId);

  // A write must still come from a valid session of an active account when it commits.
  async function liveSession(db, current) {
    const { rows } = await db.query(
      `SELECT 1 FROM app.organization_member m JOIN app.app_user u ON u.id=m.user_id
      JOIN app.user_password p ON p.user_id=u.id JOIN app.auth_session s ON s.user_id=u.id AND s.organization_id=m.organization_id
      JOIN app.organization o ON o.id=m.organization_id
      WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active'
      AND u.status='active' AND o.status='active' AND NOT p.must_change_password
      AND s.id=$3 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()`,
      [organizationId, current.user.id, current.sessionId],
    );
    if (!rows[0]) throw failure(403, '登录状态已变化，请刷新页面。');
  }
  const record = (db, current, action, subjectType, subjectId, details) =>
    db.query(
      `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details)
      VALUES($1,$2,$3,'success',$4,$5,$6,$7)`,
      [
        organizationId,
        current.user.id,
        action,
        subjectType,
        subjectId ?? null,
        randomUUID(),
        JSON.stringify(details ?? {}),
      ],
    );

  // Organization-level: `code` is an organization permission.
  async function authorize(req, code) {
    const current = await requireSession(req, true);
    if (code) await access.requireOrganization(pool, current, code);
    return current;
  }
  // `operation(db, current)` returns { subjectId, data, details? }. All organization writes
  // share one exclusive lock, so assignment and last-administrator checks stay atomic.
  async function write(req, code, action, subjectType, operation, transactionOptions) {
    const current = await authorize(req, code);
    return transaction(
      pool,
      async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [organizationId]);
        await liveSession(db, current);
        if (code) await access.requireOrganization(db, current, code);
        const result = await operation(db, current);
        await record(db, current, action, subjectType, result.subjectId, result.details);
        return result.data;
      },
      transactionOptions,
    );
  }
  // Project-level: 404 outside the user's projects, 403 without `code`.
  async function readProject(req, code, context) {
    const current = await requireSession(req, true);
    const grant = await access.requireProject(pool, current, req.params.projectId, code, context);
    return { current, grant, project: grant.project };
  }
  // Writes inside one project; archived projects are read-only. Organization writes take the
  // exclusive lock, so a project write never interleaves with a membership or archive change.
  async function writeProject(req, code, action, subjectType, operation, options = {}) {
    const current = await requireSession(req, true);
    await access.requireProject(pool, current, req.params.projectId, code);
    return transaction(
      pool,
      async (db) => {
        await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
          organizationId,
        ]);
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [
          'project:' + req.params.projectId,
        ]);
        await liveSession(db, current);
        const grant = await access.requireProject(db, current, req.params.projectId, code);
        if (grant.project.status === 'archived' && !options.archived)
          throw failure(409, '项目已归档，只能查看。');
        const result = await operation(db, current, grant);
        if (action)
          await record(db, current, action, subjectType, result.subjectId, {
            projectId: grant.project.id,
            ...result.details,
          });
        return result.data;
      },
      options.transactionOptions,
    );
  }
  return {
    ...access,
    pool,
    organizationId,
    requireSession,
    authorize,
    write,
    readProject,
    writeProject,
    record,
    liveSession,
  };
}
