import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const messages = {
  INVALID_TABLE: '请输入有效 SAP 表名（最多 30 位，支持 /命名空间/表名）。',
  MCP_NOT_CONFIGURED: '尚未配置 MCP。请在服务端设置 SAP_MCP_ENTRY 及 SAP 连接凭据。',
  MCP_UNAVAILABLE: 'MCP 启动或连接失败，请检查服务端程序路径、SAP 网络、认证及证书配置。',
  MCP_TOOL_MISSING: '当前 MCP 缺少表结构查询所需工具。',
  MCP_TOOL_ERROR: 'SAP 工具调用失败，请检查连接、认证、ADT 服务和读取权限。',
  MCP_RESULT_INVALID: 'MCP 返回格式异常或结果不完整，未将其作为成功结果。',
  TABLE_NOT_FOUND: '当前 SAP 系统中未找到该表，或当前账号无权检索该表。',
  TABLE_METADATA_EMPTY: '已检索到表，但未获得有效字段结构。请检查 ADT 能力和读取权限。',
  MCP_BUSY: '另一个技术验证查询正在运行，请稍后再试。',
};
export function mcpError(code) {
  return Object.assign(new Error(messages[code] ?? messages.MCP_UNAVAILABLE), { code });
}
export function tableName(value) {
  const name = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (name.length > 30 || !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(name))
    throw mcpError('INVALID_TABLE');
  return name;
}
function textJson(envelope) {
  if (envelope?.isError) throw mcpError('MCP_TOOL_ERROR');
  if (
    !Array.isArray(envelope?.content) ||
    envelope.content.length !== 1 ||
    envelope.content[0].type !== 'text'
  )
    throw mcpError('MCP_RESULT_INVALID');
  try {
    return JSON.parse(envelope.content[0].text);
  } catch {
    throw mcpError('MCP_RESULT_INVALID');
  }
}
export async function decodeResult(envelope, call) {
  let value = textJson(envelope);
  if (value?.status === 'paged') {
    const id = value.resultId,
      total = value.totalCharacters;
    let text = '',
      offset = 0,
      count = 0;
    if (!Number.isInteger(total) || total < 1 || total > 4 * 1024 * 1024)
      throw mcpError('MCP_RESULT_INVALID');
    while (true) {
      if (
        ++count > 300 ||
        value.resultId !== id ||
        value.offset !== offset ||
        typeof value.page !== 'string' ||
        !value.page.length
      )
        throw mcpError('MCP_RESULT_INVALID');
      text += value.page;
      offset = text.length;
      if (offset > total) throw mcpError('MCP_RESULT_INVALID');
      if (value.nextOffset === null) break;
      if (value.nextOffset !== offset || !call) throw mcpError('MCP_RESULT_INVALID');
      value = textJson(await call('readResultPage', { resultId: id, offset }));
    }
    if (text.length !== total) throw mcpError('MCP_RESULT_INVALID');
    try {
      value = textJson(JSON.parse(text));
    } catch (error) {
      throw error.code ? error : mcpError('MCP_RESULT_INVALID');
    }
  }
  if (value?.status !== 'success') throw mcpError('MCP_TOOL_ERROR');
  return value;
}

// Only server-controlled environment is accepted. No browser-supplied command,
// URL, credential, tool name or SQL can reach the MCP process.
export async function connectMcp(env = process.env, { onProtocol, deadlineMs = 90000 } = {}) {
  const entry =
    env.SAP_MCP_ENTRY ||
    fileURLToPath(new URL('../../../../../vendor/abap-adt/dist/index.js', import.meta.url));
  if (!isAbsolute(entry)) throw mcpError('MCP_NOT_CONFIGURED');
  const keys = [
    'SAP_URL',
    'SAP_CLIENT',
    'SAP_LANGUAGE',
    'SAP_USER',
    'SAP_PASSWORD',
    'SAP_BEARER_TOKEN',
    'SAP_ALLOW_HTTP',
    'SAP_REQUEST_TIMEOUT_MS',
    'NODE_EXTRA_CA_CERTS',
  ];
  const childEnv = {};
  if (env.SAP_MCP_PROFILE_FILE) {
    try {
      const profile = JSON.parse(await readFile(env.SAP_MCP_PROFILE_FILE, 'utf8'));
      for (const key of keys) if (typeof profile[key] === 'string') childEnv[key] = profile[key];
    } catch {
      throw mcpError('MCP_NOT_CONFIGURED');
    }
  }
  for (const key of keys) if (env[key] !== undefined) childEnv[key] = env[key];
  if (
    !childEnv.SAP_URL ||
    !childEnv.SAP_USER ||
    !(childEnv.SAP_PASSWORD || childEnv.SAP_BEARER_TOKEN)
  )
    throw mcpError('MCP_NOT_CONFIGURED');
  // SDK inherits only its minimal OS environment, never the application's DB secrets.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: childEnv,
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  // Optional local evidence recorder; never enabled by the web API.
  if (onProtocol) {
    const send = transport.send.bind(transport),
      start = transport.start.bind(transport);
    transport.send = async (message) => {
      onProtocol('client', message);
      return send(message);
    };
    transport.start = async () => {
      const receive = transport.onmessage;
      transport.onmessage = (message) => {
        onProtocol('server', message);
        receive?.(message);
      };
      return start();
    };
  }
  const client = new Client({ name: 'sap-delivery-workbench-verification', version: '0.1.0' });
  // One connection serves a bounded piece of work; agents pass a longer turn budget.
  const deadline = Date.now() + deadlineMs;
  const options = () => ({ timeout: Math.max(1, Math.min(65000, deadline - Date.now())) });
  try {
    await client.connect(transport, { timeout: 15000 });
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const catalog = await client.listTools(cursor ? { cursor } : {}, options());
      tools.push(...catalog.tools);
      cursor = catalog.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw mcpError('MCP_RESULT_INVALID');
    return {
      serverInfo: client.getServerVersion(),
      tools,
      call: (name, args) => client.callTool({ name, arguments: args }, undefined, options()),
      close: () => client.close(),
    };
  } catch {
    await client.close().catch(() => {});
    throw mcpError('MCP_UNAVAILABLE');
  }
}
export async function queryTable(input, { connect = connectMcp } = {}) {
  const name = tableName(input),
    started = Date.now(),
    requestId = randomUUID();
  const trace = [];
  let connection;
  try {
    connection = await connect();
    for (const name of ['searchObject', 'ddicElement'])
      if (!connection.tools.some((tool) => tool.name === name)) throw mcpError('MCP_TOOL_MISSING');
    const call = async (tool, args) => {
      trace.push({ tool, arguments: args });
      return connection.call(tool, args);
    };
    const search = await decodeResult(
      await call('searchObject', { query: name, objType: 'TABL', max: 100 }),
      call,
    );
    const object = search.results?.find(
      (row) => row['adtcore:name']?.toUpperCase() === name && row['adtcore:type'] === 'TABL/DT',
    );
    if (!object) throw mcpError('TABLE_NOT_FOUND');
    const metadata = await decodeResult(await call('ddicElement', { path: name }), call);
    const definition = metadata.result;
    if (
      definition?.name?.toUpperCase() !== name ||
      definition.type !== 'TABL/DT' ||
      !definition.children?.length
    )
      throw mcpError('TABLE_METADATA_EMPTY');
    return {
      requestId,
      status: 'success',
      tableName: name,
      retrievedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      fieldCount: definition.children.length,
      source: {
        transport: 'stdio',
        server: connection.serverInfo,
        discoveredToolCount: connection.tools.length,
      },
      object,
      definition,
      trace,
    };
  } catch (error) {
    const safe = messages[error.code] ? error : mcpError('MCP_UNAVAILABLE');
    safe.requestId = requestId;
    throw safe;
  } finally {
    await connection?.close().catch(() => {});
  }
}
