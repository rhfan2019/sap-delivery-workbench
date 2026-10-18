import { failure } from '../../platform/auth.mjs';

export function text(value, label, max, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw failure(400, `${label}不能为空且最多 ${max} 个字符。`);
  return value.trim();
}
export function uuid(value, label = '记录标识') {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw failure(400, `${label}无效。`);
  return value.toLowerCase();
}
export function uuids(value, label) {
  if (!Array.isArray(value) || value.length > 500) throw failure(400, `${label}无效。`);
  return [...new Set(value.map((v) => uuid(v, label)))];
}
export function version(value) {
  if (!/^[1-9]\d{0,15}$/.test(String(value)))
    throw failure(400, '缺少有效的数据版本，请刷新后重试。');
  return String(value);
}
export function choice(value, options, label, fallback) {
  const result = value ?? fallback;
  if (!options.includes(result)) throw failure(400, `${label}无效。`);
  return result;
}
export function code(value, label = '编码') {
  const result = text(value, label, 40).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(result))
    throw failure(400, `${label}以英文字母开头，只能包含大写字母、数字和下划线（2–40 位）。`);
  return result;
}
export function date(value, label, { optional = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (optional) return null;
    throw failure(400, `请填写${label}。`);
  }
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw failure(400, `${label}不是有效日期。`);
  return value;
}
export function strings(value, label, allowed) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    throw failure(400, `${label}无效。`);
  const result = [...new Set(value)];
  if (allowed && result.some((v) => !allowed.includes(v))) throw failure(400, `${label}无效。`);
  return result;
}
// The validity window of an assignment: from today when omitted; end on or after start.
export function validity(body = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const validFrom = date(body.validFrom, '开始日期') ?? today;
  const validTo = date(body.validTo, '结束日期');
  if (validTo && validTo < validFrom) throw failure(400, '结束日期不能早于开始日期。');
  return { validFrom, validTo };
}
