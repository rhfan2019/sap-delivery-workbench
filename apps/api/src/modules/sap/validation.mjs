import { failure } from '../../platform/auth.mjs';
import { text, choice } from '../admin/validation.mjs';

export function sapUrl(value) {
  const input = text(value, 'ADT 地址', 2048);
  try {
    const url = new URL(input);
    if (
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && process.env.SAP_ALLOW_HTTP === '1')) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw failure(400, 'ADT 地址必须是 HTTPS 主机地址及端口，不含路径或凭据。');
  }
}
// A project SAP system (docs/specs/project-access-admin.md 3.2): no user, no password.
export function systemInput(body = {}) {
  const sid = text(body.sid, '系统标识 SID', 3).toUpperCase();
  if (!/^[A-Z][A-Z0-9]{2}$/.test(sid)) throw failure(400, 'SID 为 3 位字母或数字，以字母开头。');
  const client = text(body.client, 'Client', 3);
  if (!/^\d{3}$/.test(client)) throw failure(400, 'Client 必须是三位数字。');
  const language = text(body.language ?? 'ZH', '登录语言', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(language)) throw failure(400, '登录语言使用两位字母，例如 ZH、EN。');
  return {
    name: text(body.name, '系统名称', 60),
    purpose: choice(body.purpose, ['development', 'test'], '系统用途'),
    sid,
    sapUrl: sapUrl(body.sapUrl),
    client,
    language,
    description: text(body.description, '说明', 300, { optional: true }),
    status: choice(body.status, ['active', 'inactive'], '系统状态', 'active'),
  };
}
// The person's own SAP user for one system and how long to keep it (section 3.3).
export function credentialInput(body = {}) {
  const username = text(body.username, 'SAP 用户', 128);
  if (typeof body.password !== 'string' || !body.password || body.password.length > 256)
    throw failure(400, '请输入 SAP 密码。');
  return {
    username,
    password: body.password,
    mode: choice(body.mode, ['session', 'saved'], '保存方式', 'saved'),
  };
}
export function policyInput(body = {}) {
  const days = (value, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw failure(400, `${label}须为 1–365 天。`);
    return n;
  };
  return {
    allowSave: body.allowSave === true,
    maxDays: days(body.maxDays, '最长保存天数'),
    idleDays: days(body.idleDays, '闲置失效天数'),
    subcontractorSave: body.subcontractorSave === true,
  };
}
