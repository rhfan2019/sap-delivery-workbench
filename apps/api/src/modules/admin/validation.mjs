import { failure } from '../../platform/auth.mjs';

export function text(value, label, max, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw failure(400, `${label}不能为空且最多 ${max} 个字符。`);
  return value.trim();
}
export function choice(value, options, label, fallback) {
  const result = value ?? fallback;
  if (!options.includes(result)) throw failure(400, `${label}无效。`);
  return result;
}
export function uuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw failure(400, '记录标识无效。');
  return value;
}
export function version(value) {
  if (!/^[1-9]\d{0,15}$/.test(String(value)))
    throw failure(400, '缺少有效的数据版本，请刷新后重试。');
  return String(value);
}
export function code(value) {
  const result = text(value, '编码', 32).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(result))
    throw failure(400, '编码只能包含英文字母、数字、下划线或连字符。');
  return result;
}
export function email(value) {
  const result = text(value, '邮箱', 254, { optional: true });
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw failure(400, '请输入有效的邮箱地址。');
  return result || null;
}
export function date(value) {
  if (value === null || value === undefined || value === '') return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw failure(400, '请输入有效日期。');
  return value;
}
export function customerInput(body = {}) {
  return {
    name: text(body.name, '客户名称', 200),
    code: code(body.code),
    customerKind: choice(body.customerKind, ['external', 'self'], '客户类型', 'external'),
    status: choice(body.status, ['active', 'inactive'], '客户状态', 'active'),
    description: text(body.description, '说明', 4000, { optional: true }),
  };
}
export function projectInput(body = {}) {
  const start = date(body.plannedStartDate),
    end = date(body.plannedEndDate);
  if (start && end && start > end) throw failure(400, '结束日期不能早于开始日期。');
  return {
    customerId: uuid(body.customerId),
    code: code(body.code),
    name: text(body.name, '项目名称', 200),
    projectType: choice(
      body.projectType,
      ['implementation', 'rollout', 'enhancement', 'support', 'migration', 'other'],
      '项目类型',
      'implementation',
    ),
    status: choice(
      body.status,
      ['preparing', 'active', 'completed', 'archived'],
      '项目状态',
      'preparing',
    ),
    description: text(body.description, '说明', 4000, { optional: true }),
    plannedStartDate: start,
    plannedEndDate: end,
  };
}
