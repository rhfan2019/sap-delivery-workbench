import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import {
  FIELD_MAP,
  PHASE_KEYS,
  CUSTOM_TYPES,
  GROUPS,
  TAG_COLORS,
  RESERVED_LABELS,
  MAX_TAGS_PER_ITEM,
  MAX_OBJECTS_PER_ITEM,
} from '@sap-delivery-workbench/contracts/delivery/fields';
import { failure } from '../../platform/auth.mjs';
import { text, choice, date, uuid } from '../admin/validation.mjs';

export const itemColumns = {
  module: 'module',
  kind: 'kind',
  name: 'name',
  businessFunction: 'business_function',
  priority: 'priority',
  difficulty: 'difficulty',
  changeType: 'change_type',
  registeredOn: 'registered_on',
  businessOwner: 'business_owner',
  notes: 'notes',
  transactionCode: 'transaction_code',
};
export const phaseColumns = {
  assigneeId: 'assignee_id',
  effortDays: 'effort_days',
  plannedStart: 'planned_start',
  plannedEnd: 'planned_end',
  actualEnd: 'actual_end',
  progress: 'progress',
  status: 'status',
  notes: 'notes',
};

const RICH_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  's',
  'u',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
];
export function richHtml(value, label = '内容') {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw failure(400, `${label}格式无效。`);
  if (value.length > 100000) throw failure(400, `${label}最多 100000 个字符。`);
  const html = sanitizeHtml(value, {
    allowedTags: RICH_TAGS,
    allowedAttributes: { ol: ['start'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: [],
  });
  // An editor's empty paragraph is no content.
  return /^(<p>(<br \/>|<br>)?<\/p>)?$/.test(html.trim()) ? '' : html;
}

function effort(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0 || n > 9999.9 || Math.round(n * 10) !== n * 10)
    throw failure(400, `${label}须为 0～9999.9 之间、最多一位小数的数字。`);
  return n;
}
function percent(value, label) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(/%$/, ''));
  if (!Number.isInteger(n) || n < 0 || n > 100) throw failure(400, `${label}须为 0～100 的整数。`);
  return n;
}

export function objectList(value) {
  if (!Array.isArray(value)) throw failure(400, '开发对象格式无效。');
  if (value.length > MAX_OBJECTS_PER_ITEM)
    throw failure(400, `开发对象最多 ${MAX_OBJECTS_PER_ITEM} 个。`);
  const seen = new Set();
  return value.map((o) => {
    const pgmid = String(o?.pgmid || 'R3TR')
      .trim()
      .toUpperCase();
    const objectType = String(o?.objectType ?? '')
      .trim()
      .toUpperCase();
    const objectName = String(o?.objectName ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(pgmid)) throw failure(400, `对象标识无效：${pgmid}`);
    if (!/^[A-Z0-9]{4}$/.test(objectType))
      throw failure(400, `对象类型须为 4 位字母或数字：${objectType || '空'}`);
    if (!objectName || objectName.length > 120)
      throw failure(400, '对象名称不能为空且最多 120 个字符。');
    const key = `${pgmid} ${objectType} ${objectName}`;
    if (seen.has(key)) throw failure(400, `开发对象重复：${key}`);
    seen.add(key);
    return { pgmid, objectType, objectName };
  });
}

function tagList(value) {
  if (!Array.isArray(value)) throw failure(400, '标签格式无效。');
  const ids = [...new Set(value.map((id) => uuid(id)))];
  if (ids.length > MAX_TAGS_PER_ITEM)
    throw failure(400, `每个开发项最多 ${MAX_TAGS_PER_ITEM} 个标签。`);
  return ids;
}

export function customValue(def, value) {
  const label = def.label;
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  ) {
    if (def.required) throw failure(400, `${label}为必填项。`);
    return null;
  }
  const optionIds = (def.options ?? []).map((o) => o.id);
  switch (def.fieldType) {
    case 'text':
      return text(String(value), label, 500);
    case 'long_text':
      return text(String(value), label, 10000);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw failure(400, `${label}须为数字。`);
      return n;
    }
    case 'date':
      return date(value);
    case 'select':
      return choice(value, optionIds, label);
    case 'multi_select': {
      if (!Array.isArray(value)) throw failure(400, `${label}格式无效。`);
      return [...new Set(value.map((v) => choice(v, optionIds, label)))];
    }
    case 'member':
      return uuid(value);
    case 'checkbox':
      if (typeof value !== 'boolean') throw failure(400, `${label}须为是或否。`);
      return value;
    case 'url': {
      const url = text(String(value), label, 500);
      if (!/^https?:\/\/\S+$/i.test(url)) throw failure(400, `${label}须为 http 或 https 链接。`);
      return url;
    }
    default:
      throw failure(400, `${label}类型无效。`);
  }
}

// Validates one change set. Keys follow the shared catalog: `name`, `fsd.status`, `custom.<id>`,
// `tags`, `objects`. Returns column-level changes grouped by table; DB checks (members, tags) follow.
export function normalizeChanges(changes, customFields = []) {
  if (
    !changes ||
    typeof changes !== 'object' ||
    Array.isArray(changes) ||
    !Object.keys(changes).length
  )
    throw failure(400, '请提供要修改的字段。');
  const result = {
    item: {},
    phases: {},
    custom: {},
    objects: undefined,
    tags: undefined,
    keys: [],
  };
  for (const [key, raw] of Object.entries(changes)) {
    if (key.startsWith('custom.')) {
      const def = customFields.find((f) => f.id === key.slice(7));
      if (!def) throw failure(400, '自定义列不存在：' + key);
      if (def.archivedAt) throw failure(400, `“${def.label}”已归档，不能修改。`);
      result.custom[def.id] = customValue(def, raw);
      result.keys.push(key);
      continue;
    }
    const field = FIELD_MAP[key];
    if (!field || field.type === 'readonly') throw failure(400, '不允许修改该字段：' + key);
    let value;
    if (field.type === 'text')
      value = text(raw ?? '', field.label, field.max, { optional: !field.required });
    else if (field.type === 'rich') value = richHtml(raw, field.label);
    else if (field.type === 'date') value = date(raw);
    else if (field.type === 'select') {
      if (raw === '' || raw === null || raw === undefined)
        throw failure(400, `请选择${field.label}。`);
      value = choice(raw, Object.keys(field.options), field.label);
    } else if (field.type === 'member') value = raw ? uuid(raw) : null;
    else if (field.type === 'effort') value = effort(raw, field.label);
    else if (field.type === 'percent') value = percent(raw, field.label);
    else if (field.type === 'tags') value = tagList(raw);
    else if (field.type === 'objects') value = objectList(raw);
    if (key === 'registeredOn' && !value) throw failure(400, '开发项新增日期不能为空。');
    if (field.phase) {
      (result.phases[field.phase] ??= {})[field.name] = value;
    } else if (key === 'tags') result.tags = value;
    else if (key === 'objects') result.objects = value;
    else result.item[key] = value;
    result.keys.push(key);
  }
  return result;
}

// Applies phase rules on the merged state: completed means 100%, end not before start.
export function settlePhase(phaseKey, before, changes) {
  const merged = { ...before, ...changes };
  const label = {
    fsd: 'FSD',
    development: '开发',
    consultant_test: '顾问测试',
    user_test: 'IT/用户测试',
  }[phaseKey];
  if (merged.status === 'completed') {
    if ('progress' in changes && changes.progress !== 100 && !('status' in changes))
      throw failure(400, `${label}阶段已完成，完成百分比固定为 100%。`);
    changes.progress = 100;
  }
  if (merged.plannedStart && merged.plannedEnd && merged.plannedEnd < merged.plannedStart)
    throw failure(400, `${label}阶段的计划完成日期不能早于计划开始日期。`);
  return changes;
}

export function customFieldInput(body, { creating }) {
  const result = {};
  if (creating || 'label' in body) {
    const label = text(body.label, '列名称', 50);
    if (RESERVED_LABELS.has(label)) throw failure(400, `“${label}”与内置列重名，请换一个名称。`);
    result.label = label;
  }
  if (creating) result.fieldType = choice(body.fieldType, Object.keys(CUSTOM_TYPES), '列类型');
  if (creating || 'groupKey' in body)
    result.groupKey = choice(
      body.groupKey ?? 'custom',
      GROUPS.map((g) => g.key),
      '所在分组',
    );
  if ('required' in body) {
    if (typeof body.required !== 'boolean') throw failure(400, '必填设置无效。');
    result.required = body.required;
  }
  if ('sortOrder' in body) {
    if (!Number.isInteger(body.sortOrder)) throw failure(400, '排序无效。');
    result.sortOrder = body.sortOrder;
  }
  if ('options' in body) {
    if (!Array.isArray(body.options) || body.options.length > 100)
      throw failure(400, '选项格式无效或超过 100 个。');
    const labels = new Set();
    result.options = body.options.map((o) => {
      const label = text(o?.label, '选项', 50);
      if (labels.has(label)) throw failure(400, `选项重复：${label}`);
      labels.add(label);
      return {
        id: o?.id ? uuid(o.id) : randomUUID(),
        label,
        color: TAG_COLORS.includes(o?.color) ? o.color : 'gray',
      };
    });
  }
  return result;
}

export function tagInput(body, { creating }) {
  const result = {};
  if (creating || 'name' in body) result.name = text(body.name, '标签名称', 30);
  if (creating || 'color' in body)
    result.color = choice(body.color ?? 'gray', TAG_COLORS, '标签颜色');
  return result;
}

export const isPhase = (key) => PHASE_KEYS.includes(key);
