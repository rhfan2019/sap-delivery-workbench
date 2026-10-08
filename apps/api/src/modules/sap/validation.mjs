import { failure } from '../../platform/auth.mjs';
import { text, uuid, choice } from '../admin/validation.mjs';
export function sapUrl(value) {
  const input = text(value, 'ADT URL', 2048);
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
    throw failure(400, 'ADT URL 必须是 HTTPS 主机地址及端口，不含路径或凭据。');
  }
}
export function configInput(row, personal = false, temporary = false) {
  if (!row || typeof row !== 'object') throw failure(400, 'SAP 参数格式无效。');
  const systemId = row.systemId ? uuid(row.systemId) : null;
  const client = text(row.client, 'Client', 3, { optional: true }) || null;
  if (client && !/^\d{3}$/.test(client)) throw failure(400, 'Client 必须是三位数字。');
  const language = text(row.language, 'SAP 语言', 2, { optional: true }).toUpperCase() || null;
  if (language && !/^[A-Z]{2}$/.test(language))
    throw failure(400, 'SAP 语言使用两位字母，例如 EN、ZH。');
  const username = text(row.username, 'SAP 用户名', 128, { optional: true }) || null;
  const passwordAction = choice(
    row.passwordAction,
    personal || temporary ? ['keep', 'replace', 'clear', 'inherit'] : ['keep', 'replace', 'clear'],
    '密码操作',
    'keep',
  );
  let password;
  if (passwordAction === 'replace') {
    if (typeof row.password !== 'string' || !row.password.length || row.password.length > 256)
      throw failure(400, '请输入 1–256 位 SAP 密码。');
    password = row.password;
  }
  return { systemId, client, language, username, passwordAction, password };
}
export function revision(value) {
  if (!/^(0|[1-9]\d{0,15})$/.test(String(value)))
    throw failure(400, '缺少 SAP 配置版本，请重新加载。');
  return String(value);
}
