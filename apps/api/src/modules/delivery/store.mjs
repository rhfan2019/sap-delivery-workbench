import { randomUUID } from 'node:crypto';
import {
  PHASE_KEYS,
  FIELD_MAP,
  fieldValue,
  richText,
} from '@sap-delivery-workbench/contracts/delivery/fields';
import { failure } from '../../platform/auth.mjs';
import { itemColumns, phaseColumns, settlePhase } from './validation.mjs';

export function dateText(value) {
  if (!(value instanceof Date)) return value ?? null;
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

const emptyPhase = {
  assigneeId: null,
  effortDays: null,
  plannedStart: null,
  plannedEnd: null,
  actualEnd: null,
  progress: 0,
  status: 'not_started',
  notes: '',
};
function presentPhase(row) {
  if (!row) return { ...emptyPhase };
  return {
    assigneeId: row.assignee_id,
    effortDays: row.effort_days === null ? null : Number(row.effort_days),
    plannedStart: dateText(row.planned_start),
    plannedEnd: dateText(row.planned_end),
    actualEnd: dateText(row.actual_end),
    progress: row.progress,
    status: row.status,
    notes: row.notes,
  };
}
export function present(row, phaseRows = [], objectRows = [], tagIds = []) {
  const item = {
    id: row.id,
    code: row.code,
    itemNo: row.item_no,
    rowVersion: String(row.row_version),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const [key, column] of Object.entries(itemColumns)) item[key] = dateText(row[column]);
  item.phases = Object.fromEntries(
    PHASE_KEYS.map((k) => [k, presentPhase(phaseRows.find((p) => p.phase === k))]),
  );
  item.objects = objectRows.map((o) => ({
    pgmid: o.pgmid,
    objectType: o.object_type,
    objectName: o.object_name,
  }));
  item.tags = tagIds;
  item.custom = row.custom_values ?? {};
  return item;
}

export async function customFields(db, org, project) {
  const { rows } = await db.query(
    `SELECT id,label,field_type AS "fieldType",options,group_key AS "groupKey",sort_order AS "sortOrder",
      required,archived_at AS "archivedAt",row_version::text AS "rowVersion"
     FROM app.development_field WHERE organization_id=$1 AND project_id=$2 ORDER BY sort_order,created_at`,
    [org, project],
  );
  return rows;
}

// Items with their phases, objects and tags; `ids` limits the result, otherwise all live items.
export async function loadItems(db, org, project, ids = null, { lock = false } = {}) {
  const filter = ids ? ' AND id=ANY($3::uuid[])' : '';
  const params = ids ? [org, project, ids] : [org, project];
  const items = await db.query(
    `SELECT * FROM app.development_item WHERE organization_id=$1 AND project_id=$2 AND deleted_at IS NULL${filter}
     ORDER BY item_no DESC${lock ? ' FOR UPDATE' : ''}`,
    params,
  );
  if (!items.rows.length) return [];
  const itemIds = items.rows.map((r) => r.id);
  const scope = [org, project, itemIds];
  // Sequential: inside a transaction `db` is a single client.
  const phases = await db.query(
    'SELECT * FROM app.development_item_phase WHERE organization_id=$1 AND project_id=$2 AND item_id=ANY($3::uuid[])',
    scope,
  );
  const objects = await db.query(
    'SELECT * FROM app.development_item_object WHERE organization_id=$1 AND project_id=$2 AND item_id=ANY($3::uuid[]) ORDER BY sort_order,created_at,id',
    scope,
  );
  const tags = await db.query(
    'SELECT item_id,tag_id FROM app.development_item_tag WHERE organization_id=$1 AND project_id=$2 AND item_id=ANY($3::uuid[]) ORDER BY created_at',
    scope,
  );
  const group = (rows) => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.item_id)) map.set(r.item_id, []);
      map.get(r.item_id).push(r);
    }
    return map;
  };
  const p = group(phases.rows),
    o = group(objects.rows),
    t = group(tags.rows);
  return items.rows.map((row) =>
    present(
      row,
      p.get(row.id) ?? [],
      o.get(row.id) ?? [],
      (t.get(row.id) ?? []).map((x) => x.tag_id),
    ),
  );
}

export async function loadItem(db, org, project, id, options) {
  const [item] = await loadItems(db, org, project, [id], options);
  if (!item) throw failure(404, '开发项不存在或无权访问。');
  return item;
}

// Numbers are per project, never reused; the caller holds the project lock.
export async function reserveNumbers(db, org, project, count = 1) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [project]);
  const { rows } = await db.query(
    'SELECT coalesce(max(item_no),0)::int AS n FROM app.development_item WHERE organization_id=$1 AND project_id=$2',
    [org, project],
  );
  const first = rows[0].n + 1;
  if (first + count - 1 > 99999) throw failure(409, '本项目开发项编号已用尽（最多 99999）。');
  return first;
}

async function activeMember(db, org, project, userId) {
  const r = await db.query(
    `SELECT 1 FROM app.project_member pm JOIN app.organization_member om USING(organization_id,user_id)
     JOIN app.app_user u ON u.id=pm.user_id WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.user_id=$3
     AND pm.status='active' AND om.status='active' AND u.status='active'`,
    [org, project, userId],
  );
  return r.rowCount > 0;
}

// Checks references a change set introduces: people must be active members, tags must exist here.
export async function validateReferences(db, org, project, normalized, fields) {
  const people = [
    ...Object.values(normalized.phases).map((p) => p.assigneeId),
    ...Object.entries(normalized.custom)
      .filter(([id]) => fields.find((f) => f.id === id)?.fieldType === 'member')
      .map(([, v]) => v),
  ].filter(Boolean);
  for (const id of new Set(people))
    if (!(await activeMember(db, org, project, id)))
      throw failure(400, '负责人必须是当前项目的有效成员。');
  if (normalized.tags?.length) {
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM app.development_tag WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3::uuid[])',
      [org, project, normalized.tags],
    );
    if (rows[0].n !== normalized.tags.length) throw failure(400, '标签不存在或不属于当前项目。');
  }
}

async function writeObjects(db, ctx, itemId, objects) {
  await db.query('DELETE FROM app.development_item_object WHERE item_id=$1', [itemId]);
  for (const [index, o] of objects.entries())
    await db.query(
      `INSERT INTO app.development_item_object(organization_id,project_id,item_id,pgmid,object_type,object_name,sort_order,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.org, ctx.project, itemId, o.pgmid, o.objectType, o.objectName, index, ctx.actor],
    );
}
async function writeTags(db, ctx, itemId, tags) {
  await db.query(
    'DELETE FROM app.development_item_tag WHERE item_id=$1 AND NOT (tag_id=ANY($2::uuid[]))',
    [itemId, tags],
  );
  for (const tag of tags)
    await db.query(
      `INSERT INTO app.development_item_tag(organization_id,project_id,item_id,tag_id,created_by)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [ctx.org, ctx.project, itemId, tag, ctx.actor],
    );
}
async function writePhase(db, ctx, itemId, phase, changes) {
  const keys = Object.keys(changes);
  if (!keys.length) return;
  const values = keys.map((k) => changes[k]);
  await db.query(
    `UPDATE app.development_item_phase SET ${keys.map((k, i) => phaseColumns[k] + '=$' + (i + 3)).join(',')},
      updated_by=$${keys.length + 3},updated_at=now() WHERE item_id=$1 AND phase=$2`,
    [itemId, phase, ...values, ctx.actor],
  );
}

// Short, readable before/after values for the change history.
function historyValue(key, value) {
  const type = FIELD_MAP[key]?.type;
  if (type === 'rich') return richText(value).slice(0, 200);
  if (type === 'objects')
    return (value ?? []).map((o) => `${o.pgmid} ${o.objectType} ${o.objectName}`);
  return value ?? null;
}

// Applies a validated change set to one item (row already locked); returns the history entry.
export async function applyChanges(db, ctx, before, normalized) {
  const history = {};
  const record = (key, after) =>
    (history[key] = {
      before: historyValue(key, fieldValue(before, key)),
      after: historyValue(key, after),
    });
  for (const [phase, changes] of Object.entries(normalized.phases)) {
    settlePhase(phase, before.phases[phase], changes);
    await writePhase(db, ctx, before.id, phase, changes);
    for (const [name, value] of Object.entries(changes)) record(phase + '.' + name, value);
  }
  if (normalized.objects) {
    await writeObjects(db, ctx, before.id, normalized.objects);
    record('objects', normalized.objects);
  }
  if (normalized.tags) {
    await writeTags(db, ctx, before.id, normalized.tags);
    record('tags', normalized.tags);
  }
  const keys = Object.keys(normalized.item);
  const set = keys.map((k, i) => itemColumns[k] + '=$' + (i + 2));
  const values = keys.map((k) => normalized.item[k]);
  for (const k of keys) record(k, normalized.item[k]);
  const custom = Object.entries(normalized.custom);
  const assign = Object.fromEntries(custom.filter(([, v]) => v !== null));
  const remove = custom.filter(([, v]) => v === null).map(([id]) => id);
  for (const [id, value] of custom) record('custom.' + id, value);
  set.push(
    `custom_values=(custom_values || $${values.length + 2}::jsonb) - $${values.length + 3}::text[]`,
  );
  values.push(JSON.stringify(assign), remove);
  await db.query(
    `UPDATE app.development_item SET ${set.join(',')},updated_by=$${values.length + 2},updated_at=now(),
      row_version=row_version+1 WHERE id=$1`,
    [before.id, ...values, ctx.actor],
  );
  return history;
}

// Creates one item with its four phases, then applies the remaining changes.
export async function insertItem(db, ctx, itemNo, normalized) {
  const base = { ...normalized.item };
  for (const key of ['module', 'kind', 'name'])
    if (!base[key]) throw failure(400, '请填写开发名称、模块和类型。');
  const id = randomUUID();
  const keys = Object.keys(base);
  await db.query(
    `INSERT INTO app.development_item(id,organization_id,project_id,item_no,created_by,updated_by,${keys.map((k) => itemColumns[k]).join(',')})
     VALUES($1,$2,$3,$4,$5,$5${keys.map((_, i) => ',$' + (i + 6)).join('')})`,
    [id, ctx.org, ctx.project, itemNo, ctx.actor, ...keys.map((k) => base[k])],
  );
  for (const phase of PHASE_KEYS)
    await db.query(
      'INSERT INTO app.development_item_phase(organization_id,project_id,item_id,phase,updated_by) VALUES($1,$2,$3,$4,$5)',
      [ctx.org, ctx.project, id, phase, ctx.actor],
    );
  const created = await loadItem(db, ctx.org, ctx.project, id);
  await applyChanges(db, ctx, created, { ...normalized, item: {} });
  return id;
}

export async function addEvent(db, ctx, itemId, action, changes = {}) {
  await db.query(
    'INSERT INTO app.development_event(organization_id,project_id,item_id,actor_id,action,changes) VALUES($1,$2,$3,$4,$5,$6)',
    [ctx.org, ctx.project, itemId, ctx.actor, action, JSON.stringify(changes)],
  );
}

export async function members(db, org, project) {
  const { rows } = await db.query(
    `SELECT u.id,u.display_name AS "displayName",(pm.status='active' AND om.status='active' AND u.status='active') AS active
     FROM app.project_member pm JOIN app.app_user u ON u.id=pm.user_id JOIN app.organization_member om USING(organization_id,user_id)
     WHERE pm.organization_id=$1 AND pm.project_id=$2 ORDER BY u.display_name`,
    [org, project],
  );
  return rows;
}

export async function tags(db, org, project) {
  const { rows } = await db.query(
    `SELECT t.id,t.name,t.color,count(it.item_id) FILTER (WHERE i.deleted_at IS NULL)::int AS "usage"
     FROM app.development_tag t LEFT JOIN app.development_item_tag it ON it.tag_id=t.id
     LEFT JOIN app.development_item i ON i.id=it.item_id
     WHERE t.organization_id=$1 AND t.project_id=$2 GROUP BY t.id ORDER BY lower(t.name)`,
    [org, project],
  );
  return rows;
}

// For the development overview (contract 3.6): when each item last changed, and planned ends
// pushed later in the recent days, from the change history.
export async function itemActivity(db, org, project) {
  return (
    await db.query(
      `SELECT item_id AS "itemId",max(created_at) AS at FROM app.development_event
       WHERE organization_id=$1 AND project_id=$2 GROUP BY item_id`,
      [org, project],
    )
  ).rows;
}
export async function plannedEndPushes(db, org, project, days) {
  return (
    await db.query(
      `SELECT e.item_id AS "itemId",k.phase,e.changes->(k.phase||'.plannedEnd')->>'before' AS before,
              e.changes->(k.phase||'.plannedEnd')->>'after' AS after
       FROM app.development_event e CROSS JOIN unnest($3::text[]) AS k(phase)
       WHERE e.organization_id=$1 AND e.project_id=$2 AND e.created_at>=now()-make_interval(days=>$4)
         AND e.changes->(k.phase||'.plannedEnd')->>'before' IS NOT NULL
         AND e.changes->(k.phase||'.plannedEnd')->>'after'>e.changes->(k.phase||'.plannedEnd')->>'before'
       ORDER BY e.created_at`,
      [org, project, PHASE_KEYS, days],
    )
  ).rows;
}
