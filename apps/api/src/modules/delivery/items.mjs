import { failure } from '../../platform/auth.mjs';
import { version, uuid } from '../admin/validation.mjs';
import { normalizeChanges } from './validation.mjs';
import {
  loadItems,
  loadItem,
  customFields,
  reserveNumbers,
  validateReferences,
  insertItem,
  applyChanges,
  addEvent,
  members,
  tags,
} from './store.mjs';
import { registerCloneRoute } from './clone-route.mjs';
export const base = '/api/projects/:projectId/development-items';

const scopeOf = (c, req, current) => ({
  org: c.organizationId,
  project: req.params.projectId,
  actor: current.user.id,
});

export function itemRoutes(app, c) {
  registerCloneRoute(app, c, base);
  app.get(base, async (req) => {
    const { project, current } = await c.read(req);
    const [items, people, tagList, fields] = await Promise.all([
      loadItems(c.pool, c.organizationId, project.id),
      members(c.pool, c.organizationId, project.id),
      tags(c.pool, c.organizationId, project.id),
      customFields(c.pool, c.organizationId, project.id),
    ]);
    return {
      items,
      members: people,
      tags: tagList,
      fields,
      readOnly: project.status === 'archived',
      isAdmin: project.access_level === 'admin',
      userId: current.user.id,
    };
  });
  app.get(base + '/:id', async (req) => {
    const { project } = await c.read(req);
    uuid(req.params.id);
    return loadItem(c.pool, c.organizationId, project.id, req.params.id);
  });
  app.post(base, { bodyLimit: 1000000 }, async (req, reply) =>
    c.write(req, async (db, current) => {
      const ctx = scopeOf(c, req, current);
      const fields = await customFields(db, ctx.org, ctx.project);
      const normalized = normalizeChanges(req.body, fields);
      for (const f of fields.filter((f) => f.required && !f.archivedAt))
        if (normalized.custom[f.id] == null) throw failure(400, `${f.label}为必填项。`);
      await validateReferences(db, ctx.org, ctx.project, normalized, fields);
      const id = await insertItem(
        db,
        ctx,
        await reserveNumbers(db, ctx.org, ctx.project),
        normalized,
      );
      await addEvent(db, ctx, id, 'created');
      reply.code(201);
      return loadItem(db, ctx.org, ctx.project, id);
    }),
  );
  app.patch(base + '/:id', { bodyLimit: 1000000 }, async (req) =>
    c.write(req, async (db, current) => {
      const ctx = scopeOf(c, req, current);
      uuid(req.params.id);
      const expected = version(req.body?.rowVersion);
      const before = await loadItem(db, ctx.org, ctx.project, req.params.id, { lock: true });
      const fields = await customFields(db, ctx.org, ctx.project);
      const normalized = normalizeChanges(req.body?.changes, fields);
      if (before.rowVersion !== expected)
        throw failure(409, '此开发项已被他人更新。你的输入已保留，请读取最新内容后重试。');
      await validateReferences(db, ctx.org, ctx.project, normalized, fields);
      const history = await applyChanges(db, ctx, before, normalized);
      await addEvent(db, ctx, before.id, 'updated', history);
      return loadItem(db, ctx.org, ctx.project, before.id);
    }),
  );
  app.delete(base + '/:id', async (req) =>
    c.write(req, async (db, current) => {
      const ctx = scopeOf(c, req, current);
      const old = await c.item(db, req, true);
      if (String(old.row_version) !== version(req.body?.rowVersion))
        throw failure(409, '此开发项已更新，请刷新后重试。');
      await db.query(
        'UPDATE app.development_item SET deleted_at=now(),updated_by=$2,row_version=row_version+1,updated_at=now() WHERE id=$1',
        [old.id, ctx.actor],
      );
      await addEvent(db, ctx, old.id, 'deleted');
      return { ok: true };
    }),
  );
  app.get(base + '/:id/events', async (req) => {
    await c.read(req);
    await c.item(c.pool, req);
    return (
      await c.pool.query(
        `SELECT e.id,e.action,e.changes,e.created_at AS "createdAt",u.display_name AS "actorName" FROM app.development_event e
         JOIN app.app_user u ON u.id=e.actor_id WHERE e.organization_id=$1 AND e.project_id=$2 AND e.item_id=$3
         ORDER BY e.created_at DESC LIMIT 30`,
        [c.organizationId, req.params.projectId, req.params.id],
      )
    ).rows;
  });
}
