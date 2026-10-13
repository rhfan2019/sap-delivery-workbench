import ExcelJS from 'exceljs';
import {
  FIELDS,
  OPTIONS,
  CUSTOM_TYPES,
  customField,
  fieldValue,
  richText,
} from '@sap-delivery-workbench/contracts/delivery/fields';
import { failure } from '../../platform/auth.mjs';
import { normalizeChanges } from './validation.mjs';
import {
  loadItems,
  customFields,
  members,
  tags,
  reserveNumbers,
  validateReferences,
  insertItem,
  applyChanges,
  addEvent,
} from './store.mjs';
import { base } from './items.mjs';

const MAX_ROWS = 2000;
const groupFill = {
  basic: 'FFDDEBF7',
  fsd: 'FFFCE4D6',
  development: 'FFE2EFDA',
  consultant_test: 'FFF2F2F2',
  user_test: 'FFFFF2CC',
  custom: 'FFEDE7F6',
};
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plainToHtml = (s) =>
  s
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

function catalog(fields, { includeArchived = false } = {}) {
  return [
    ...FIELDS,
    ...fields
      .filter((f) => includeArchived || !f.archivedAt)
      .map((f) => ({ ...customField(f), definition: f })),
  ];
}

// --- export -----------------------------------------------------------------------------

function exportValue(item, field, lookup) {
  const value = fieldValue(item, field.key);
  if (value === null || value === undefined || value === '') return null;
  switch (field.type) {
    case 'rich':
      return richText(value) || null;
    case 'select':
      return field.options[value] ?? value;
    case 'member':
      return lookup.member(value);
    case 'date':
      return toExcelDate(value);
    case 'tags':
      return (
        value
          .map((id) => lookup.tag(id))
          .filter(Boolean)
          .join('，') || null
      );
    case 'objects':
      return value.map((o) => `${o.pgmid} ${o.objectType} ${o.objectName}`).join('\n') || null;
    case 'custom': {
      const d = field.definition;
      if (d.fieldType === 'select') return d.options.find((o) => o.id === value)?.label ?? null;
      if (d.fieldType === 'multi_select')
        return value
          .map((id) => d.options.find((o) => o.id === id)?.label)
          .filter(Boolean)
          .join('，');
      if (d.fieldType === 'member') return lookup.member(value);
      if (d.fieldType === 'checkbox') return value ? '是' : '否';
      if (d.fieldType === 'date') return toExcelDate(value);
      return value;
    }
    default:
      return value;
  }
}
function toExcelDate(text) {
  const [y, m, d] = String(text).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function writeSheet(workbook, columns, rows) {
  const sheet = workbook.addWorksheet('开发清单', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = columns.map((f) => ({
    header: f.excel,
    key: f.key,
    width:
      f.type === 'rich' || f.type === 'objects' || f.customType === 'long_text'
        ? 40
        : f.key === 'name'
          ? 32
          : Math.max(10, f.excel.length * 2 + 2),
    style:
      f.type === 'date' || f.customType === 'date'
        ? { numFmt: 'yyyy-mm-dd' }
        : f.type === 'rich' || f.type === 'objects'
          ? { alignment: { wrapText: true, vertical: 'top' } }
          : {},
  }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  columns.forEach((f, i) => {
    header.getCell(i + 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: groupFill[f.group] ?? groupFill.custom },
    };
  });
  for (const row of rows) sheet.addRow(row);
  return sheet;
}

function addDropdowns(sheet, columns, lookup) {
  columns.forEach((f, i) => {
    let list = null;
    if (f.type === 'select') list = Object.values(f.options);
    else if (f.type === 'member' || f.customType === 'member') list = lookup.activeNames;
    else if (f.customType === 'select') list = f.options.map((o) => o.label);
    else if (f.customType === 'checkbox') list = ['是', '否'];
    if (!list?.length || list.join(',').length > 250) return;
    const letter = sheet.getColumn(i + 1).letter;
    sheet.dataValidations.add(`${letter}2:${letter}${MAX_ROWS + 1}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`"${list.map((v) => v.replace(/[",]/g, ' ')).join(',')}"`],
    });
  });
}

function lookups(people, tagList) {
  return {
    member: (id) => people.find((m) => m.id === id)?.displayName ?? null,
    tag: (id) => tagList.find((t) => t.id === id)?.name ?? null,
    activeNames: people.filter((m) => m.active).map((m) => m.displayName),
  };
}

// --- import -----------------------------------------------------------------------------

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
    return '';
  }
  return typeof value === 'string' ? value.trim() : value;
}
function parseDate(value, label) {
  if (value instanceof Date)
    return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()]
      .map((n, i) => (i ? String(n).padStart(2, '0') : n))
      .join('-');
  if (typeof value === 'number')
    return parseDate(new Date(Math.round((value - 25569) * 86400000)), label);
  const m = String(value).match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) throw new Error(`${label}不是有效日期：${value}`);
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}
function byLabel(options, value, label) {
  const text = String(value).trim().toLowerCase();
  const hit = Object.entries(options).find(
    ([key, name]) => key.toLowerCase() === text || name.toLowerCase() === text,
  );
  if (!hit)
    throw new Error(`${label}取值无效：${value}（可选：${Object.values(options).join('、')}）`);
  return hit[0];
}
const splitList = (value) =>
  String(value)
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function memberId(name, people, label) {
  const hits = people.filter((m) => m.displayName === String(name).trim());
  if (!hits.length) throw new Error(`${label}“${name}”不是本项目成员`);
  if (hits.length > 1) throw new Error(`${label}“${name}”有重名成员，请在系统中直接选择`);
  if (!hits[0].active) throw new Error(`${label}“${name}”已停用`);
  return hits[0].id;
}

// One cell → change value, or `undefined` to leave the field unchanged.
function importValue(field, raw, ctx) {
  const empty = raw === '' || raw === null || raw === undefined;
  const label = field.excel;
  switch (field.type) {
    case 'text':
      return empty ? '' : String(raw);
    case 'rich': {
      if (empty) return '';
      const text = String(raw);
      // Unchanged plain text keeps the stored formatting.
      if (ctx.existing && richText(fieldValue(ctx.existing, field.key)) === text.trim())
        return undefined;
      return plainToHtml(text);
    }
    case 'date':
      if (empty) return field.key === 'registeredOn' ? undefined : null;
      return parseDate(raw, label);
    case 'select':
      return empty ? undefined : byLabel(field.options, raw, label);
    case 'member':
      return empty ? null : memberId(raw, ctx.people, label);
    case 'effort':
      return empty ? null : raw;
    case 'percent': {
      if (empty) return undefined;
      if (typeof raw === 'number' && raw <= 1 && ctx.percentFormat) return Math.round(raw * 100);
      return raw;
    }
    case 'tags':
      return empty ? [] : splitList(raw).map((name) => ctx.tagId(name));
    case 'objects':
      return empty
        ? []
        : String(raw)
            .split(/\r?\n/)
            .map((line) => line.trim().split(/\s+/))
            .filter((parts) => parts[0])
            .map((parts) => {
              if (parts.length === 2)
                return { pgmid: 'R3TR', objectType: parts[0], objectName: parts[1] };
              if (parts.length === 3)
                return { pgmid: parts[0], objectType: parts[1], objectName: parts[2] };
              throw new Error(`开发对象格式应为“对象标识 对象类型 对象名称”：${parts.join(' ')}`);
            });
    case 'custom': {
      const d = field.definition;
      if (empty) return null;
      if (d.fieldType === 'date') return parseDate(raw, label);
      if (d.fieldType === 'number')
        return typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (d.fieldType === 'select')
        return byLabel(Object.fromEntries(d.options.map((o) => [o.id, o.label])), raw, label);
      if (d.fieldType === 'multi_select') {
        const options = Object.fromEntries(d.options.map((o) => [o.id, o.label]));
        return splitList(raw).map((v) => byLabel(options, v, label));
      }
      if (d.fieldType === 'member') return memberId(raw, ctx.people, label);
      if (d.fieldType === 'checkbox') {
        const t = String(raw).trim().toLowerCase();
        if (['是', 'y', 'yes', 'true', '1', '√', '✓'].includes(t)) return true;
        if (['否', 'n', 'no', 'false', '0', '×'].includes(t)) return false;
        throw new Error(`${label}请填写“是”或“否”`);
      }
      return String(raw);
    }
    default:
      return undefined;
  }
}

async function parseWorkbook(content, { db, org, project }) {
  if (typeof content !== 'string' || !content || content.length > 7000000)
    throw failure(400, '文件为空或超过 5 MiB。');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(content, 'base64'));
  } catch {
    throw failure(400, '无法读取文件，请上传 .xlsx 格式的 Excel 文件。');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw failure(400, 'Excel 中没有工作表。');
  const fields = await customFields(db, org, project);
  const people = await members(db, org, project);
  const tagList = await tags(db, org, project);
  const items = await loadItems(db, org, project);
  const all = catalog(fields);
  const headers = [],
    ignored = [];
  sheet.getRow(1).eachCell((cell, col) => {
    const name = String(cellText(cell.value)).trim();
    const field = all.find((f) => f.excel === name || f.label === name);
    if (field && !headers.some((h) => h.field.key === field.key)) headers.push({ col, field });
    else if (name) ignored.push(name);
  });
  if (!headers.length) throw failure(400, '第 1 行没有识别到列名，请使用导出的清单或导入模板。');
  const codeColumn = headers.find((h) => h.field.key === 'code');
  const newTags = new Set();
  const tagId = (name) => {
    const hit = tagList.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    if (name.length > 30) throw new Error(`标签“${name}”超过 30 个字符`);
    newTags.add(name);
    return 'new:' + name;
  };
  const rows = [],
    seenCodes = new Set();
  if (sheet.rowCount - 1 > MAX_ROWS) throw failure(400, `一次最多导入 ${MAX_ROWS} 行。`);
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const values = headers.map((h) => ({ h, raw: cellText(row.getCell(h.col).value) }));
    if (values.every((v) => v.raw === '')) continue;
    const errors = [];
    const rawCode = codeColumn ? String(cellText(row.getCell(codeColumn.col).value)).trim() : '';
    let existing = null;
    if (rawCode) {
      const code = /^\d+$/.test(rawCode) ? rawCode.padStart(5, '0') : rawCode;
      existing = items.find((i) => i.code === code) ?? null;
      if (!existing) errors.push(`编号 ${rawCode} 不存在`);
      else if (seenCodes.has(code)) errors.push(`编号 ${code} 在表中重复`);
      seenCodes.add(code);
    }
    const changes = {},
      failedKeys = new Set();
    for (const { h, raw } of values) {
      if (h.field.key === 'code') continue;
      try {
        const value = importValue(h.field, raw, {
          existing,
          people,
          tagId,
          percentFormat: String(row.getCell(h.col).numFmt ?? '').includes('%'),
        });
        if (value !== undefined) changes[h.field.key] = value;
      } catch (e) {
        errors.push(e.message);
        failedKeys.add(h.field.key);
      }
    }
    if (!existing)
      for (const key of ['name', 'module', 'kind'])
        if (!changes[key] && !failedKeys.has(key))
          errors.push(`新建行缺少${FIELDS.find((f) => f.key === key).label}`);
    // Validate shape now (tags are checked after creation of new ones).
    const probe = { ...changes };
    if (probe.tags) probe.tags = probe.tags.filter((t) => !String(t).startsWith('new:'));
    if (!errors.length && Object.keys(probe).length)
      try {
        normalizeChanges(probe, fields);
      } catch (e) {
        errors.push(e.message);
      }
    rows.push({
      rowNumber: r,
      code: existing?.code ?? null,
      action: existing ? 'update' : 'create',
      changes,
      errors,
    });
  }
  return {
    rows,
    ignored,
    recognized: headers.map((h) => h.field.excel),
    newTags: [...newTags],
    fields,
    items,
  };
}

export function excelRoutes(app, c) {
  app.post(base + '/export', { bodyLimit: 1000000 }, async (req, reply) => {
    const { project } = await c.read(req);
    const [items, fields, people, tagList] = await Promise.all([
      loadItems(c.pool, c.organizationId, project.id),
      customFields(c.pool, c.organizationId, project.id),
      members(c.pool, c.organizationId, project.id),
      tags(c.pool, c.organizationId, project.id),
    ]);
    const all = catalog(fields);
    const keys =
      Array.isArray(req.body?.keys) && req.body.keys.length ? req.body.keys : all.map((f) => f.key);
    const columns = [
      all.find((f) => f.key === 'code'),
      ...keys.filter((k) => k !== 'code').map((k) => all.find((f) => f.key === k)),
    ].filter(Boolean);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const selected = ids ? ids.map((id) => items.find((i) => i.id === id)).filter(Boolean) : items;
    const lookup = lookups(people, tagList);
    const workbook = new ExcelJS.Workbook();
    writeSheet(
      workbook,
      columns,
      selected.map((item) => columns.map((f) => exportValue(item, f, lookup))),
    );
    const buffer = await workbook.xlsx.writeBuffer();
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" + encodeURIComponent('开发清单.xlsx'),
      );
    return reply.send(Buffer.from(buffer));
  });
  app.get(base + '/import-template', async (req, reply) => {
    const { project } = await c.read(req);
    const [fields, people] = await Promise.all([
      customFields(c.pool, c.organizationId, project.id),
      members(c.pool, c.organizationId, project.id),
    ]);
    const columns = catalog(fields);
    const workbook = new ExcelJS.Workbook();
    const sheet = writeSheet(workbook, columns, []);
    addDropdowns(sheet, columns, lookups(people, []));
    const help = workbook.addWorksheet('填写说明');
    help.columns = [
      { header: '列', key: 'col', width: 24 },
      { header: '说明', key: 'note', width: 90 },
    ];
    help.getRow(1).font = { bold: true };
    help.addRows([
      { col: '编号', note: '留空表示新建；填写已有编号表示更新该开发项。' },
      {
        col: '空白单元格',
        note: '更新时，表中出现的列以表中内容为准：可清空的字段被清空，不能为空的字段（模块、类型、状态等）保持不变。不想修改的列请整列删除。',
      },
      { col: '人员', note: '填写项目成员的显示名称。' },
      { col: '标签', note: '多个标签用逗号分隔；不存在的标签会自动新建。' },
      {
        col: '开发对象',
        note: '每行一个对象：对象标识 对象类型 对象名称，例如“R3TR PROG ZMM_PR_APPROVE”；对象标识可省略（默认 R3TR）。',
      },
      {
        col: '状态',
        note: Object.values(OPTIONS.status).join('、') + '；状态为“已完成”时完成百分比自动为 100。',
      },
      ...fields
        .filter((f) => !f.archivedAt)
        .map((f) => ({
          col: f.label,
          note:
            CUSTOM_TYPES[f.fieldType] +
            (f.options?.length ? '：' + f.options.map((o) => o.label).join('、') : '') +
            (f.required ? '（必填）' : ''),
        })),
    ]);
    const buffer = await workbook.xlsx.writeBuffer();
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" + encodeURIComponent('开发清单导入模板.xlsx'),
      );
    return reply.send(Buffer.from(buffer));
  });
  app.post(base + '/import/preview', { bodyLimit: 7100000 }, async (req) => {
    const { project } = await c.read(req);
    const parsed = await parseWorkbook(req.body?.content, {
      db: c.pool,
      org: c.organizationId,
      project: project.id,
    });
    return {
      rows: parsed.rows.map(({ rowNumber, code, action, changes, errors }) => ({
        rowNumber,
        code,
        action,
        name: changes.name ?? parsed.items.find((i) => i.code === code)?.name ?? '',
        fields: Object.keys(changes).length,
        errors,
      })),
      recognized: parsed.recognized,
      ignored: parsed.ignored,
      newTags: parsed.newTags,
    };
  });
  app.post(base + '/import', { bodyLimit: 7100000 }, async (req) =>
    c.write(req, async (db, current) => {
      const ctx = { org: c.organizationId, project: req.params.projectId, actor: current.user.id };
      const parsed = await parseWorkbook(req.body?.content, { db, ...ctx });
      const failed = parsed.rows.filter((r) => r.errors.length);
      if (failed.length)
        throw failure(
          400,
          `有 ${failed.length} 行存在错误，请修正后重新导入（第 ${failed
            .map((r) => r.rowNumber)
            .slice(0, 10)
            .join('、')} 行）。`,
        );
      if (!parsed.rows.length) throw failure(400, '表中没有可导入的数据行。');
      const created = new Map();
      for (const name of parsed.newTags) {
        const { rows } = await db.query(
          'INSERT INTO app.development_tag(organization_id,project_id,name,created_by) VALUES($1,$2,$3,$4) RETURNING id',
          [ctx.org, ctx.project, name, ctx.actor],
        );
        created.set('new:' + name, rows[0].id);
      }
      const creates = parsed.rows.filter((r) => r.action === 'create');
      let next = creates.length
        ? await reserveNumbers(db, ctx.org, ctx.project, creates.length)
        : 0;
      let updated = 0;
      for (const row of parsed.rows) {
        if (row.changes.tags) row.changes.tags = row.changes.tags.map((t) => created.get(t) ?? t);
        if (!Object.keys(row.changes).length) continue;
        const normalized = normalizeChanges(row.changes, parsed.fields);
        await validateReferences(db, ctx.org, ctx.project, normalized, parsed.fields);
        if (row.action === 'create') {
          const id = await insertItem(db, ctx, next++, normalized);
          await addEvent(db, ctx, id, 'imported', { rowNumber: row.rowNumber });
        } else {
          const [before] = await loadItems(
            db,
            ctx.org,
            ctx.project,
            [parsed.items.find((i) => i.code === row.code).id],
            { lock: true },
          );
          const history = await applyChanges(db, ctx, before, normalized);
          await addEvent(db, ctx, before.id, 'updated', { ...history, import: true });
          updated++;
        }
      }
      return { created: creates.length, updated, newTags: parsed.newTags.length };
    }),
  );
}
