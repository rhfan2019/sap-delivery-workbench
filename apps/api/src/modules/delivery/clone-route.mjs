import { randomUUID } from 'node:crypto';
import { cloneFields } from './clone-policy.mjs';
import { failure } from '../../platform/auth.mjs';
import { columns } from './validation.mjs';
export function registerCloneRoute(app, c, base, present) {
  app.post(base + '/:id/test-copy', async (req, reply) =>
    c.write(req, async (db, current) => {
      const source = await c.item(db, req);
      const { prefix, requestId } = req.body ?? {};
      if (!/^\d{6}-\d{6}-$/.test(prefix ?? '') || !/^[a-f0-9-]{36}$/i.test(requestId ?? ''))
        throw failure(400, '测试前缀或请求编号无效');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [
        req.params.projectId,
      ]);
      const prior = await db.query(
        "SELECT i.* FROM app.development_event e JOIN app.development_item i ON i.id=e.item_id WHERE e.organization_id=$1 AND e.project_id=$2 AND e.action='test_copied' AND e.changes->>'requestId'=$3",
        [c.organizationId, req.params.projectId, requestId],
      );
      if (prior.rows[0]) {
        const event = await db.query(
          "SELECT changes FROM app.development_event WHERE item_id=$1 AND action='test_copied'",
          [prior.rows[0].id],
        );
        if (event.rows[0].changes.sourceId !== source.id || event.rows[0].changes.prefix !== prefix)
          throw failure(409, '复制请求标识已用于其他参数');
        if (prior.rows[0].deleted_at) throw failure(409, '测试副本已删除，不自动重建');
        return present(prior.rows[0]);
      }
      const code = prefix + source.code;
      const input = { ...cloneFields(present(source)), businessOwnerId: current.user.id };
      const keys = Object.keys(input),
        id = randomUUID(),
        values = [
          id,
          c.organizationId,
          req.params.projectId,
          code,
          current.user.id,
          ...Object.values(input),
        ];
      const { rows } = await db.query(
        `INSERT INTO app.development_item(id,organization_id,project_id,code,created_by,${keys.map((k) => columns[k]).join(',')}) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        values,
      );
      await db.query(
        'INSERT INTO app.fs_draft(item_id,organization_id,project_id,updated_by) VALUES($1,$2,$3,$4)',
        [id, c.organizationId, req.params.projectId, current.user.id],
      );
      await c.event(db, { params: { ...req.params, id } }, current, 'test_copied', {
        requestId,
        sourceId: source.id,
        prefix,
        basicFields: keys,
      });
      reply.code(201);
      return present(rows[0]);
    }),
  );
}
