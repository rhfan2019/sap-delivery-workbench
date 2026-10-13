import { failure } from '../../platform/auth.mjs';
import { normalizeChanges } from './validation.mjs';
import { cloneFields } from './clone-policy.mjs';
import { loadItem, customFields, reserveNumbers, insertItem, addEvent } from './store.mjs';

// Test copies for batch assistant testing: same requirement, new number, prefixed name.
export function registerCloneRoute(app, c, base) {
  app.post(base + '/:id/test-copy', async (req, reply) =>
    c.write(req, async (db, current) => {
      const ctx = { org: c.organizationId, project: req.params.projectId, actor: current.user.id };
      const source = await c.item(db, req);
      const { prefix, requestId } = req.body ?? {};
      if (!/^\d{6}-\d{6}-$/.test(prefix ?? '') || !/^[a-f0-9-]{36}$/i.test(requestId ?? ''))
        throw failure(400, '测试前缀或请求编号无效');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [ctx.project]);
      const prior = await db.query(
        "SELECT i.id,i.deleted_at,e.changes FROM app.development_event e JOIN app.development_item i ON i.id=e.item_id WHERE e.organization_id=$1 AND e.project_id=$2 AND e.action='test_copied' AND e.changes->>'requestId'=$3",
        [ctx.org, ctx.project, requestId],
      );
      if (prior.rows[0]) {
        const { changes, deleted_at, id } = prior.rows[0];
        if (changes.sourceId !== source.id || changes.prefix !== prefix)
          throw failure(409, '复制请求标识已用于其他参数');
        if (deleted_at) throw failure(409, '测试副本已删除，不自动重建');
        return loadItem(db, ctx.org, ctx.project, id);
      }
      const original = await loadItem(db, ctx.org, ctx.project, source.id);
      const input = cloneFields(original);
      input.name = (prefix + input.name).slice(0, 200);
      input['fsd.assigneeId'] = current.user.id;
      const fields = await customFields(db, ctx.org, ctx.project);
      const id = await insertItem(
        db,
        ctx,
        await reserveNumbers(db, ctx.org, ctx.project),
        normalizeChanges(input, fields),
      );
      await addEvent(db, ctx, id, 'test_copied', {
        requestId,
        sourceId: source.id,
        prefix,
        basicFields: Object.keys(input),
      });
      reply.code(201);
      return loadItem(db, ctx.org, ctx.project, id);
    }),
  );
}
