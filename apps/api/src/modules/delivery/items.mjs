import { randomUUID } from 'node:crypto';
import { failure } from '../../platform/auth.mjs';
import { version } from '../admin/validation.mjs';
import { columns, fields, validatePeople } from './validation.mjs';
import { registerCloneRoute } from './clone-route.mjs';
export const base = '/api/projects/:projectId/development-items';
export function present(row) {
  const result = {
    id: row.id,
    code: row.code,
    stage: row.stage,
    rowVersion: String(row.row_version),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const [key, column] of Object.entries(columns)) {
    const value = row[column];
    result[key] =
      value instanceof Date
        ? [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0'),
          ].join('-')
        : value;
  }
  return result;
}
export function itemRoutes(app, c) {
  registerCloneRoute(app, c, base, present);
  app.get(base, async (req) => {
    const { project, current } = await c.read(req);
    const items = await c.pool.query(
      'SELECT * FROM app.development_item WHERE organization_id=$1 AND project_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC,id',
      [c.organizationId, project.id],
    );
    const members = await c.pool.query(
      `SELECT u.id,u.display_name AS "displayName",(pm.status='active' AND om.status='active' AND u.status='active') AS active
      FROM app.project_member pm JOIN app.app_user u ON u.id=pm.user_id JOIN app.organization_member om USING(organization_id,user_id)
      WHERE pm.organization_id=$1 AND pm.project_id=$2 ORDER BY u.display_name`,
      [c.organizationId, project.id],
    );
    return {
      items: items.rows.map(present),
      members: members.rows,
      readOnly: project.status === 'archived',
      isAdmin: project.access_level === 'admin',
      userId: current.user.id,
    };
  });
  app.get(base + '/:id', async (req) => {
    await c.read(req);
    return present(await c.item(c.pool, req));
  });
  app.post(base, { bodyLimit: 160000 }, async (req, reply) =>
    c.write(req, async (db, current) => {
      const input = fields({
        changeType: 'new',
        priority: 'low',
        businessOwnerId: current.user.id,
        ...req.body,
      });
      if (!input.name || !input.module || !input.kind)
        throw failure(400, '请填写名称、模块和类型。');
      await validatePeople(db, c.organizationId, req.params.projectId, input);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [
        req.params.projectId,
      ]);
      const count = await db.query(
        'SELECT count(*)::int AS n FROM app.development_item WHERE organization_id=$1 AND project_id=$2',
        [c.organizationId, req.params.projectId],
      );
      const id = randomUUID(),
        code = 'DEV-' + String(count.rows[0].n + 1).padStart(4, '0');
      const keys = Object.keys(input),
        values = [
          id,
          c.organizationId,
          req.params.projectId,
          code,
          current.user.id,
          ...Object.values(input),
        ];
      const result = await db.query(
        `INSERT INTO app.development_item(id,organization_id,project_id,code,created_by,${keys.map((k) => columns[k]).join(',')}) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        values,
      );
      await db.query(
        'INSERT INTO app.fs_draft(item_id,organization_id,project_id,updated_by) VALUES($1,$2,$3,$4)',
        [id, c.organizationId, req.params.projectId, current.user.id],
      );
      await c.event(db, { params: { ...req.params, id } }, current, 'created');
      reply.code(201);
      return present(result.rows[0]);
    }),
  );
  app.delete(base + '/:id', async (req) =>
    c.write(req, async (db, current) => {
      const old = await c.item(db, req, true);
      if (String(old.row_version) !== version(req.body?.rowVersion))
        throw failure(409, '此开发项已更新，请刷新后重试。');
      await db.query(
        'UPDATE app.development_item SET deleted_at=now(),row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND id=$3',
        [c.organizationId, req.params.projectId, old.id],
      );
      await c.event(db, req, current, 'deleted');
      return { ok: true };
    }),
  );
  app.patch(base + '/:id', { bodyLimit: 160000 }, async (req) =>
    c.write(req, async (db, current) => {
      const expected = version(req.body?.rowVersion);
      const old = await c.item(db, req, true);
      const changesInput = req.body?.changes;
      const input = fields(
        changesInput && Object.hasOwn(changesInput, 'summary')
          ? { ...changesInput, summaryFormat: changesInput.summaryFormat ?? old.summary_format }
          : changesInput,
      );
      if (String(old.row_version) !== expected)
        throw failure(409, '此开发项已更新。你的输入已保留，请读取最新内容后重试。');
      await validatePeople(db, c.organizationId, req.params.projectId, input);
      const changes = {};
      for (const [key, value] of Object.entries(input))
        changes[key] = { before: present(old)[key], after: value };
      const values = [...Object.values(input), old.id];
      const result = await db.query(
        `UPDATE app.development_item SET ${Object.keys(input)
          .map((k, i) => columns[k] + '=$' + (i + 1))
          .join(
            ',',
          )},row_version=row_version+1,updated_at=now() WHERE id=$${values.length} RETURNING *`,
        values,
      );
      await c.event(db, req, current, 'updated', changes);
      return present(result.rows[0]);
    }),
  );
  app.get(base + '/:id/events', async (req) => {
    await c.read(req);
    await c.item(c.pool, req);
    return (
      await c.pool.query(
        `SELECT e.id,e.action,e.changes,e.created_at AS "createdAt",u.display_name AS "actorName" FROM app.development_event e JOIN app.app_user u ON u.id=e.actor_id WHERE e.organization_id=$1 AND e.project_id=$2 AND e.item_id=$3 ORDER BY e.created_at DESC LIMIT 30`,
        [c.organizationId, req.params.projectId, req.params.id],
      )
    ).rows;
  });
}
