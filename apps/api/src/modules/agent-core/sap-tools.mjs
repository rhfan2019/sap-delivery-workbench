import { connectMcp, decodeResult, resolveProjectSap } from '../sap/public.mjs';
import { failure } from '../../platform/auth.mjs';

// Read-only abap-adt tools the model may use (system prompt part 4). Everything else the
// MCP server offers (writes, code execution, debugger, transports...) never reaches the model.
export const SAP_TOOLS = [
  'searchObject',
  'findObjectPath',
  'objectTypes',
  'ddicElement',
  'ddicRepositoryAccess',
  'tableContents',
  'runQuery',
  'getObjectSource',
  'objectStructure',
  'classComponents',
  'findDefinition',
  'usageReferences',
  'abapDocumentation',
];
// Usage notes appended to the server's terse descriptions; the model sees them on every call.
const HINTS = {
  ddicElement: 'path 只放一个对象名，例如 LIKP；返回字段清单。多个表请并行发出多个调用。',
  runQuery:
    '只允许单表 SELECT：不用表别名、JOIN、子查询；只写表中真实存在的字段。行数用 rowNumber 参数控制，SQL 中不写 UP TO n ROWS；按 ABAP SQL 书写，降序写 ORDER BY 字段 DESCENDING，不写 DESC。域文本在 DD07T.DDTEXT，DD07L 没有 DDTEXT。',
  tableContents: '读取小表的前几行，用于了解配置；需要条件或字段时用 runQuery。',
  searchObject: 'objType 可省略，或用 TABL、PROG、FUNC、CLAS 等具体类型，不要用 *。',
};
const MAX_ROWS = 100;
const MAX_SOURCE_LINES = 400;
const MAX_RESULT_CHARS = 24000;
const SELECT_ONLY = /^\s*SELECT\b/i;
const FORBIDDEN_SQL =
  /;|--|\/\*|\b(INSERT|UPDATE|DELETE|MODIFY|DROP|ALTER|CREATE|EXEC|CALL|COMMIT|GRANT)\b/i;

// Returns a problem description, or null when the call is allowed; may tighten limits in place.
export function guardSapCall(name, args) {
  if (!SAP_TOOLS.includes(name)) return '该工具不在只读白名单中。';
  // tableContents also accepts free SQL, so both tools get the same SELECT-only rule.
  if (name === 'runQuery' || (name === 'tableContents' && args.sqlQuery !== undefined)) {
    const sql = String(args.sqlQuery ?? '');
    if (!SELECT_ONLY.test(sql) || FORBIDDEN_SQL.test(sql))
      return `${name} 只允许单条 SELECT 语句。`;
  }
  if (name === 'runQuery' || name === 'tableContents')
    args.rowNumber = Math.min(Number(args.rowNumber) || MAX_ROWS, MAX_ROWS);
  if (typeof args.sqlQuery === 'string') args.sqlQuery = wrapSql(args.sqlQuery);
  if (name === 'getObjectSource')
    args.maxLines = Math.min(Number(args.maxLines) || MAX_SOURCE_LINES, MAX_SOURCE_LINES);
  return null;
}

// ADT's data preview compiles the statement as ABAP source, whose lines may not exceed 255
// characters (long IN lists hit this). Breaks after a comma or before AND/OR, never inside
// a literal, so every line stays within `width`.
export function wrapSql(sql, width = 200) {
  if (sql.split('\n').every((line) => line.length <= width)) return sql;
  const out = [];
  let line = '',
    quoted = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '\n') {
      out.push(line);
      line = '';
      continue;
    }
    if (!quoted && line.length >= width * 0.7) {
      const rest = sql.slice(i);
      if (ch === ' ' && /^ (AND|OR) /i.test(rest)) {
        out.push(line);
        line = '';
        continue;
      }
      if (line.endsWith(',') && ch === ' ') {
        out.push(line);
        line = '';
        continue;
      }
    }
    line += ch;
  }
  out.push(line);
  return out.join('\n');
}

export function truncate(text, limit = MAX_RESULT_CHARS) {
  return text.length <= limit
    ? text
    : text.slice(0, limit) + `\n…（结果已截断，共 ${text.length} 字符；请缩小查询范围）`;
}

// Contract 1.12: the user picks the SAP system per message; agents never read PRD.
export const SAP_ENVIRONMENTS = ['DEV', 'QAS'];
export function sapEnvironment(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!SAP_ENVIRONMENTS.includes(value)) throw failure(400, 'SAP 系统只能选择 DEV 或 QAS。');
  return value;
}

// Opens one MCP connection for a turn. Never throws: when SAP is not usable the agent
// keeps working without SAP tools and tells the model why.
export async function openSap(
  db,
  scope,
  { budgetMs, environment = 'DEV', connect = connectMcp, resolve = resolveProjectSap } = {},
) {
  let resolved;
  try {
    resolved = await resolve(db, scope, environment);
  } catch (error) {
    return {
      available: false,
      reason: `项目未配置可用的 ${environment} SAP 系统：` + error.message,
    };
  }
  let connection;
  try {
    connection = await connect(resolved.env, { deadlineMs: budgetMs });
  } catch (error) {
    return { available: false, target: resolved.target, reason: 'SAP 连接失败：' + error.message };
  }
  const offered = new Map(connection.tools.map((t) => [t.name, t]));
  const tools = SAP_TOOLS.filter((n) => offered.has(n)).map((name) => ({
    type: 'function',
    function: {
      name,
      description: [offered.get(name).description ?? name, HINTS[name]].filter(Boolean).join(' '),
      parameters: schemaOf(offered.get(name)),
    },
  }));
  return {
    available: true,
    target: resolved.target,
    tools,
    async call(name, args) {
      const problem = guardSapCall(name, args);
      if (problem) return { status: 'denied', content: problem };
      return callSapTool(connection, name, args);
    },
    // Full source of one object for the program itself (framework loading, code sync);
    // never offered to the model, so the line limit above does not apply. Throws on failure.
    async readSource(objectSourceUrl) {
      const value = await decodeResult(
        await connection.call('getObjectSource', { objectSourceUrl }),
        connection.call,
      );
      return { source: String(value.source ?? ''), totalLines: value.totalLines ?? null };
    },
    close: () => connection.close().catch(() => {}),
  };
}

// One read-only tool call on an open MCP connection, with SAP's own error text on failure
// so the model can correct the query.
export async function callSapTool(connection, name, args) {
  try {
    const envelope = await connection.call(name, args);
    let value;
    try {
      value = await decodeResult(envelope, connection.call);
    } catch {
      // Not every tool answers with the paged JSON envelope; fall back to its text.
      if (envelope?.isError) throw new Error(textOf(envelope) || 'SAP 工具返回错误');
      value = textOf(envelope);
    }
    return { status: 'ok', content: truncate(formatResult(name, value)) };
  } catch (error) {
    return { status: 'error', content: 'SAP 查询失败：' + String(error.message).slice(0, 500) };
  }
}

// ddicElement answers with verbose JSON (EBAN alone is ~24k characters); the model only
// needs the field list, so tables and structures are reduced to one line per field.
export function formatResult(name, value) {
  if (typeof value === 'string') return value;
  const r = value?.result;
  if (name === 'ddicElement' && Array.isArray(r?.children) && r.children.length) {
    const lines = r.children.map((c) => {
      const p = c.properties?.elementProps || {};
      return [
        String(c.name).toUpperCase(),
        p.ddicIsKey ? '键' : '',
        p.ddicDataElement ? String(p.ddicDataElement).toUpperCase() : '',
        p.ddicDataType ? `${p.ddicDataType}(${p.ddicLength ?? ''})` : c.type,
      ]
        .filter(Boolean)
        .join(' ');
    });
    return `${String(r.name).toUpperCase()}（${r.type}）共 ${lines.length} 个字段：\n${lines.join('\n')}`;
  }
  return JSON.stringify(value);
}

// Providers reject JSON Schema meta keys in function parameters.
function schemaOf(tool) {
  const { $schema, ...schema } = tool.inputSchema ?? {};
  return schema.type ? schema : { type: 'object', properties: {} };
}

function textOf(envelope) {
  return (envelope?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}
