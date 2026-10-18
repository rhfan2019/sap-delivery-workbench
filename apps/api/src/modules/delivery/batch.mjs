import { failure } from '../../platform/auth.mjs';
import { deniedError } from '../access/public.mjs';
import { uuid } from '../admin/validation.mjs';
import { normalizeChanges } from './validation.mjs';
import {
  loadItems,
  customFields,
  reserveNumbers,
  validateReferences,
  insertItem,
  applyChanges,
  addEvent,
} from './store.mjs';
import { base } from './items.mjs';

const MAX_BATCH = 500;

function idList(value) {
  if (!Array.isArray(value) || !value.length) throw failure(400, '请先选择开发项。');
  if (value.length > MAX_BATCH) throw failure(400, `一次最多处理 ${MAX_BATCH} 项。`);
  return [...new Set(value.map((id) => uuid(id)))];
}

// Copies everything except identity, registration date and phase progress.
export function copyChanges(item) {
  const changes = {
    module: item.module,
    kind: item.kind,
    name: item.name,
    businessFunction: item.businessFunction,
    priority: item.priority,
    difficulty: item.difficulty,
    changeType: item.changeType,
    businessOwner: item.businessOwner,
    notes: item.notes,
    transactionCode: item.transactionCode,
    objects: item.objects,
    tags: item.tags,
  };
  for (const [phase, p] of Object.entries(item.phases))
    for (const key of ['assigneeId', 'effortDays', 'plannedStart', 'plannedEnd', 'notes'])
      if (key !== 'effortDays' || ['fsd', 'development'].includes(phase))
        changes[phase + '.' + key] = p[key];
  for (const [id, value] of Object.entries(item.custom)) changes['custom.' + id] = value;
  return changes;
}

// All-or-nothing operations on the selected items; one transaction each.
export function batchRoutes(app, c) {
  app.post(base + '/batch', { bodyLimit: 1000000 }, async (req) =>
    c.write(req, 'delivery.item:view', async (db, current, project) => {
      const ctx = { org: c.organizationId, project: req.params.projectId, actor: current.user.id };
      const action = req.body?.action;
      const ids = idList(req.body?.ids);
      const items = await loadItems(db, ctx.org, ctx.project, ids, { lock: true });
      if (items.length !== ids.length) throw failure(409, '部分开发项已被删除，请刷新后重试。');
      items.sort((a, b) => a.itemNo - b.itemNo);
      // Each action needs its own permission, for every selected item.
      const permission = {
        delete: 'delivery.item:delete',
        copy: 'delivery.item:create',
        update: 'delivery.item:edit',
      }[action];
      if (!permission) throw failure(400, '不支持的批量操作。');
      if (!project.grant.has(permission)) throw deniedError(permission);
      if (action === 'copy') for (const item of items) c.allowCreate(project, item.module);
      else for (const item of items) await c.allow(db, project, item, permission);
      if (action === 'delete') {
        await db.query(
          'UPDATE app.development_item SET deleted_at=now(),updated_by=$2,row_version=row_version+1,updated_at=now() WHERE id=ANY($1::uuid[])',
          [ids, ctx.actor],
        );
        for (const item of items) await addEvent(db, ctx, item.id, 'deleted', { batch: true });
        return { count: items.length, ids };
      }
      const fields = await customFields(db, ctx.org, ctx.project);
      if (action === 'copy') {
        let next = await reserveNumbers(db, ctx.org, ctx.project, items.length);
        const created = [];
        for (const item of items) {
          const changes = copyChanges(item);
          for (const f of fields) if (f.archivedAt) delete changes['custom.' + f.id];
          const id = await insertItem(db, ctx, next++, normalizeChanges(changes, fields));
          await addEvent(db, ctx, id, 'copied', { sourceId: item.id, sourceCode: item.code });
          created.push(id);
        }
        return { count: created.length, ids: created };
      }
      if (action === 'update') {
        const { changes = {}, addTags = [], removeTags = [] } = req.body;
        if (!Array.isArray(addTags) || !Array.isArray(removeTags))
          throw failure(400, '标签操作格式无效。');
        const hasChanges = changes && Object.keys(changes).length;
        if (!hasChanges && !addTags.length && !removeTags.length)
          throw failure(400, '请至少勾选一个要修改的字段。');
        if ('tags' in (changes ?? {}) || 'objects' in (changes ?? {}))
          throw failure(400, '标签请用“添加 / 移除”方式批量修改；开发对象不支持批量修改。');
        const normalized = hasChanges ? normalizeChanges(changes, fields) : null;
        const tagCheck = normalizeChanges({ tags: [...addTags, ...removeTags] }, fields);
        await validateReferences(
          db,
          ctx.org,
          ctx.project,
          { ...tagCheck, phases: normalized?.phases ?? {}, custom: normalized?.custom ?? {} },
          fields,
        );
        for (const item of items) {
          const next = normalized
            ? structuredClone(normalized)
            : { item: {}, phases: {}, custom: {}, keys: [] };
          if (addTags.length || removeTags.length)
            next.tags = normalizeChanges(
              { tags: [...item.tags.filter((t) => !removeTags.includes(t)), ...addTags] },
              fields,
            ).tags;
          const history = await applyChanges(db, ctx, item, next);
          await addEvent(db, ctx, item.id, 'updated', { ...history, batch: true });
        }
        return { count: items.length, ids };
      }
      throw failure(400, '不支持的批量操作。');
    }),
  );
}
