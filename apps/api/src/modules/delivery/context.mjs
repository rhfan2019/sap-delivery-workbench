import { fileURLToPath } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { failure, transaction } from '../../platform/auth.mjs';
import { uuid } from '../admin/validation.mjs';
import { createAccess, deniedError } from '../access/public.mjs';
import { itemActivity, loadItems, members, plannedEndPushes } from './store.mjs';

// Where uploaded item files are stored; the file id is the file name.
export function deliveryFilesFolder() {
  const folder =
    process.env.DELIVERY_FILES_DIR ??
    fileURLToPath(new URL('../../../../../.runtime/delivery-files/', import.meta.url));
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.DELIVERY_FILES_DIR || !isAbsolute(folder))
  )
    throw new Error('Production requires an absolute DELIVERY_FILES_DIR.');
  return folder;
}

export function deliveryContext(pool, organizationId, requireSession) {
  const access = createAccess(pool, organizationId);
  // The project with the user's grant in it (`project.grant`). Contract 3.5: 404 outside the
  // user's projects, 403 without `permission`; writes also need a live session.
  async function project(db, current, projectId, { write = false, permission } = {}) {
    uuid(projectId);
    const { rows } = await db.query(
      `SELECT 1 FROM app.app_user u JOIN app.organization_member om ON om.user_id=u.id AND om.organization_id=$1
      JOIN app.organization o ON o.id=om.organization_id
      JOIN app.auth_session s ON s.id=$3 AND s.user_id=u.id AND s.organization_id=om.organization_id
      JOIN app.user_password pw ON pw.user_id=u.id
      WHERE u.id=$2 AND om.status='active' AND u.status='active' AND o.status='active' AND NOT pw.must_change_password
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()`,
      [organizationId, current.user.id, current.sessionId],
    );
    if (!rows[0]) throw failure(401, '登录已失效，请重新登录。');
    const grant = await access.requireProject(db, current, projectId, permission);
    if (write && grant.project.status === 'archived') throw failure(409, '项目已归档，只能查看。');
    return { ...grant.project, grant };
  }
  async function read(req, permission = 'delivery.item:view') {
    const current = await requireSession(req, true);
    return { current, project: await project(pool, current, req.params.projectId, { permission }) };
  }
  async function write(req, permission, operation, transactionOptions) {
    const current = await requireSession(req, true);
    return transaction(
      pool,
      async (db) => {
        // Coordinate membership changes and archive mutations with existing administration.
        await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
          organizationId,
        ]);
        const p = await project(db, current, req.params.projectId, { write: true, permission });
        return operation(db, current, p);
      },
      transactionOptions,
    );
  }
  // The people responsible for an item (creator and phase assignees), for "own items only".
  async function owners(db, itemId) {
    const { rows } = await db.query(
      `SELECT created_by AS id FROM app.development_item WHERE id=$1
      UNION SELECT assignee_id FROM app.development_item_phase WHERE item_id=$1 AND assignee_id IS NOT NULL`,
      [itemId],
    );
    return rows.map((r) => r.id);
  }
  // 403 unless the grant allows `permission` on this item (module scope, own items).
  async function allow(db, p, item, permission) {
    const context = { module: item.module, owners: await owners(db, item.id) };
    if (!p.grant.has(permission, context)) throw deniedError(permission);
  }
  // New items (created, copied) may only land in a module the grant to create covers.
  function allowCreate(p, module) {
    if (!p.grant.has('delivery.item:create', { module })) throw deniedError('delivery.item:create');
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
  // Read-only views other modules use through item-workspace.
  async function objects(db, itemId) {
    return (
      await db.query(
        `SELECT pgmid,object_type AS "objectType",object_name AS "objectName" FROM app.development_item_object
         WHERE organization_id=$1 AND item_id=$2 ORDER BY sort_order`,
        [organizationId, itemId],
      )
    ).rows;
  }
  async function files(db, itemId) {
    const folder = deliveryFilesFolder();
    return (
      await db.query(
        `SELECT id,name,size,checksum,created_at AS "createdAt" FROM app.development_file
         WHERE organization_id=$1 AND item_id=$2 ORDER BY created_at`,
        [organizationId, itemId],
      )
    ).rows.map((f) => ({ ...f, path: join(folder, f.id) }));
  }
  // Read-only views for the development overview (contract 3.6).
  const overview = {
    items: (db, projectId) => loadItems(db, organizationId, projectId),
    members: (db, projectId) => members(db, organizationId, projectId),
    activity: (db, projectId) => itemActivity(db, organizationId, projectId),
    plannedEndPushes: (db, projectId, days) =>
      plannedEndPushes(db, organizationId, projectId, days),
  };
  return {
    pool,
    organizationId,
    requireSession,
    access: project,
    read,
    write,
    owners,
    allow,
    allowCreate,
    item,
    event,
    objects,
    files,
    overview,
  };
}
