import { connectMcp, decodeResult } from '../technical/sap-mcp.mjs';
// SAP refused the user or password (the credential must not be tried again).
export const isAuthFailure = (error) =>
  /\b401\b|unauthori[sz]ed|authentication|logon failed/i.test(String(error?.message ?? error));
// Only fixed public messages leave this boundary; raw MCP errors may contain credentials.
function classify(error) {
  const text = String(error?.message ?? error);
  if (/\b401\b|unauthori[sz]ed|authentication|logon failed/i.test(text))
    return ['AUTH_FAILED', '认证失败，请检查 Client、用户和密码。'];
  if (/\b403\b|forbidden|not authorized|authorization/i.test(text))
    return ['FORBIDDEN', '权限不足，请检查 ADT 和 CVERS 读取权限。'];
  if (/timeout|timed.?out|ETIMEDOUT/i.test(text))
    return ['TIMEOUT', '连接超时，请检查 SAP 服务和网络。'];
  if (
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|network|fetch failed|connection failed|reachability/i.test(
      text,
    )
  )
    return ['NETWORK', '网络连接失败，请检查系统地址、端口及网络。'];
  if (/certificate|CERT_|TLS|SSL/i.test(text))
    return ['TLS', '证书验证失败，请检查服务端信任证书。'];
  return ['UNAVAILABLE', 'SAP 连接或版本读取失败，请检查 MCP、ADT 服务及读取权限。'];
}
export async function probeSystem(env, { connect = () => connectMcp(env) } = {}) {
  let connection;
  try {
    connection = await connect();
    if (!connection.tools.some((t) => t.name === 'tableContents')) throw new Error('Missing tool');
    const call = async (name, args) => {
      const envelope = await connection.call(name, args);
      if (envelope?.isError)
        throw new Error(
          (envelope.content ?? [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join(' '),
        );
      return envelope;
    };
    const value = await decodeResult(
      await call('tableContents', { ddicEntityName: 'CVERS', rowNumber: 200, decode: true }),
      call,
    );
    const rows = Array.isArray(value.result)
      ? value.result
      : (value.result?.values ?? value.result?.rows);
    const components = (Array.isArray(rows) ? rows : []).filter(
      (r) =>
        ['SAP_BASIS', 'S4CORE', 'SAP_APPL'].includes(r?.COMPONENT?.trim()) &&
        typeof r.RELEASE === 'string' &&
        /^[A-Za-z0-9._ -]{1,40}$/.test(r.RELEASE.trim()),
    );
    if (!components.length) throw new Error('No version evidence');
    const version = components.map((r) => r.COMPONENT.trim() + ' ' + r.RELEASE.trim()).join(' · ');
    return { status: 'passed', code: 'OK', message: '正常，已读取后端软件组件版本。', version };
  } catch (error) {
    const [code, message] = classify(error);
    return { status: 'failed', code, message, version: null };
  } finally {
    await connection?.close().catch(() => {});
  }
}
