import { failure } from '../../platform/auth.mjs';
import { uuid, version } from '../admin/validation.mjs';
import { MAX_CUSTOM_FIELDS } from '@sap-delivery-workbench/contracts/delivery/fields';
import { tagInput, customFieldInput } from './validation.mjs';
import { customFields, tags } from './store.mjs';

const tagBase = '/api/projects/:projectId/development-tags';
const fieldBase = '/api/projects/:projectId/development-fields';
const duplicate = (error, message) => {
  if (error?.code === '23505') throw failure(409, message);
  throw error;
};

// Project-level vocabularies of the development list: tags and custom columns.
export function catalogRoutes(app, c) {
  app.get(tagBase, async (req) => {
    const { project } = await c.read(req);
    return tags(c.pool, c.organizationId, project.id);
  });
  app.post(tagBase, async (req, reply) =>
    c.write(req, 'delivery.item:edit', async (db, current) => {
      const input = tagInput(req.body ?? {}, { creating: true });
      const { rows } = await db
        .query(
          `INSERT INTO app.development_tag(organization_id,project_id,name,color,created_by) VALUES($1,$2,$3,$4,$5)
           RETURNING id,name,color,0 AS usage`,
          [c.organizationId, req.params.projectId, input.name, input.color, current.user.id],
        )
        .catch((e) => duplicate(e, `标签“${input.name}”已存在。`));
      reply.code(201);
      return rows[0];
    }),
  );
  app.patch(tagBase + '/:tagId', async (req) =>
    c.write(req, 'delivery.config:manage', async (db) => {
      uuid(req.params.tagId);
      const input = tagInput(req.body ?? {}, { creating: false });
      const keys = Object.keys(input);
      if (!keys.length) throw failure(400, '请提供要修改的内容。');
      const { rows } = await db
        .query(
          `UPDATE app.development_tag SET ${keys.map((k, i) => k + '=$' + (i + 4)).join(',')}
           WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING id,name,color`,
          [c.organizationId, req.params.projectId, req.params.tagId, ...keys.map((k) => input[k])],
        )
        .catch((e) => duplicate(e, `标签“${input.name}”已存在。`));
      if (!rows[0]) throw failure(404, '标签不存在。');
      return rows[0];
    }),
  );
  app.delete(tagBase + '/:tagId', async (req) =>
    c.write(req, 'delivery.config:manage', async (db) => {
      uuid(req.params.tagId);
      const { rowCount } = await db.query(
        'DELETE FROM app.development_tag WHERE organization_id=$1 AND project_id=$2 AND id=$3',
        [c.organizationId, req.params.projectId, req.params.tagId],
      );
      if (!rowCount) throw failure(404, '标签不存在。');
      return { ok: true };
    }),
  );

  app.get(fieldBase, async (req) => {
    const { project } = await c.read(req);
    return customFields(c.pool, c.organizationId, project.id);
  });
  const configWrite = (req, operation) =>
    c.write(req, 'delivery.config:manage', (db, current) => operation(db, current));
  app.post(fieldBase, async (req, reply) =>
    configWrite(req, async (db, current) => {
      const input = customFieldInput(req.body ?? {}, { creating: true });
      const { rows } = await db.query(
        'SELECT count(*)::int AS n, coalesce(max(sort_order),0)::int AS last FROM app.development_field WHERE organization_id=$1 AND project_id=$2 AND archived_at IS NULL',
        [c.organizationId, req.params.projectId],
      );
      if (rows[0].n >= MAX_CUSTOM_FIELDS)
        throw failure(409, `每个项目最多 ${MAX_CUSTOM_FIELDS} 个自定义列。`);
      if (['select', 'multi_select'].includes(input.fieldType) && !input.options?.length)
        throw failure(400, '单选或多选列至少需要一个选项。');
      const created = await db
        .query(
          `INSERT INTO app.development_field(organization_id,project_id,label,field_type,options,group_key,sort_order,required,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            c.organizationId,
            req.params.projectId,
            input.label,
            input.fieldType,
            JSON.stringify(input.options ?? []),
            input.groupKey,
            input.sortOrder ?? rows[0].last + 10,
            input.required ?? false,
            current.user.id,
          ],
        )
        .catch((e) => duplicate(e, `列“${input.label}”已存在。`));
      reply.code(201);
      return (await customFields(db, c.organizationId, req.params.projectId)).find(
        (f) => f.id === created.rows[0].id,
      );
    }),
  );
  app.patch(fieldBase + '/:fieldId', async (req) =>
    configWrite(req, async (db) => {
      uuid(req.params.fieldId);
      const expected = version(req.body?.rowVersion);
      const old = (await customFields(db, c.organizationId, req.params.projectId)).find(
        (f) => f.id === req.params.fieldId,
      );
      if (!old) throw failure(404, '自定义列不存在。');
      if (old.rowVersion !== expected) throw failure(409, '该列已被他人修改，请刷新后重试。');
      const input = customFieldInput(req.body ?? {}, { creating: false });
      if (input.options) {
        // Removing an option would orphan stored values; options can be renamed or added.
        const kept = new Set(input.options.map((o) => o.id));
        if (old.options.some((o) => !kept.has(o.id)))
          throw failure(400, '已有选项不能删除，可以改名。');
      }
      const sets = [],
        values = [];
      const put = (column, value) => {
        values.push(value);
        sets.push(`${column}=$${values.length + 3}`);
      };
      if (input.label) put('label', input.label);
      if (input.groupKey) put('group_key', input.groupKey);
      if ('required' in input) put('required', input.required);
      if ('sortOrder' in input) put('sort_order', input.sortOrder);
      if (input.options) put('options', JSON.stringify(input.options));
      if ('archived' in (req.body ?? {})) {
        if (typeof req.body.archived !== 'boolean') throw failure(400, '归档设置无效。');
        sets.push(
          req.body.archived ? 'archived_at=coalesce(archived_at,now())' : 'archived_at=NULL',
        );
      }
      if (!sets.length) throw failure(400, '请提供要修改的内容。');
      await db
        .query(
          `UPDATE app.development_field SET ${sets.join(',')},updated_at=now(),row_version=row_version+1
           WHERE organization_id=$1 AND project_id=$2 AND id=$3`,
          [c.organizationId, req.params.projectId, req.params.fieldId, ...values],
        )
        .catch((e) => duplicate(e, `列“${input.label ?? old.label}”已存在。`));
      return (await customFields(db, c.organizationId, req.params.projectId)).find(
        (f) => f.id === req.params.fieldId,
      );
    }),
  );
}
