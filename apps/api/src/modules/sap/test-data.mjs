import { randomUUID } from 'node:crypto';
import { connectMcp } from '../technical/sap-mcp.mjs';
import { listAllowlist } from './allowlist.mjs';
import { resolveTestSystem } from './targets.mjs';

// Contract 3.4: the only place that writes to SAP. Generated test data code runs in QAS as
// a temporary $TMP class after the user authorized this very request; the class definition
// is fixed here, the model supplies only the body of the main method.
export const CLASS_PREFIX = 'ZCL_SDWB_TD_';
const MAX_BODY = 20000;
const SAFE_CLASSES = new Set(['CL_ABAP_CHAR_UTILITIES', 'CL_ABAP_CONTEXT_INFO']);
// Statements that may not start a statement of the body.
const FORBIDDEN_STATEMENTS = [
  [/^EXEC\s+SQL\b/i, 'EXEC SQL'],
  [/^CALL\s+'/i, "内核调用 CALL '…'"],
  [/^SYSTEM-CALL\b/i, 'SYSTEM-CALL'],
  [/^SUBMIT\b/i, 'SUBMIT'],
  [/^(CALL|LEAVE\s+TO)\s+TRANSACTION\b/i, 'CALL TRANSACTION'],
  [/^(OPEN|CLOSE|DELETE|TRANSFER|READ)\s+DATASET\b/i, '文件操作'],
  [
    /^(INSERT|DELETE|GENERATE|READ)\s+(REPORT|SUBROUTINE\s+POOL|TEXTPOOL|DYNPRO)\b/i,
    '生成或改写程序',
  ],
  [/^UPDATE\b/i, '直接更新数据库表'],
  [/^DELETE\s+FROM\b/i, '直接删除数据库表记录'],
  [/^DELETE\s+[\w/]+\s+FROM\s+(TABLE\s+)?@/i, '直接删除数据库表记录'],
  [/^INSERT\s+(INTO\s+)?[\w/]+\s+(VALUES|FROM)\b/i, '直接插入数据库表'],
  [/^MODIFY\s+[\w/]+\s+FROM\s+(TABLE\s+)?@/i, '直接修改数据库表'],
  [/^CALL\s+FUNCTION\s+(?!')/i, '动态函数调用（函数名必须是字面量）'],
  [/^CALL\s+METHOD\s+\(/i, '动态方法调用'],
  [/^CREATE\s+OBJECT\b.*\bTYPE\s+\(/i, '动态创建对象'],
  [
    /^(CLASS|METHOD|METHODS|ENDMETHOD|ENDCLASS|INTERFACES)\b/i,
    '类或方法定义（正文只写主方法内的语句）',
  ],
];
// Additions anywhere in a statement; a preceding - or ~ marks a structure component instead.
const FORBIDDEN_ANYWHERE = [
  [/(?<![-~\w])DESTINATION\s/i, '远程调用 DESTINATION'],
  [/(?<![-~\w])(STARTING\s+NEW\s+TASK|IN\s+BACKGROUND\s+TASK)\b/i, '异步或后台调用'],
  [/(=>|->)\s*\(/, '动态方法调用'],
];

// Comments removed; with `blankLiterals`, the inside of literals and templates is blanked.
function stripped(body, blankLiterals) {
  return body
    .split('\n')
    .filter((line) => !line.startsWith('*'))
    .map((line) => {
      let out = '',
        quote = null;
      for (const ch of line) {
        if (quote) {
          if (ch === quote) quote = null;
          out += quote && blankLiterals ? ' ' : ch;
        } else if (ch === '"') break;
        else {
          if (ch === "'" || ch === '`' || ch === '|') quote = ch;
          out += ch;
        }
      }
      return out;
    })
    .join('\n');
}

// Static review of a main method body against the system's active allowlist. Conservative:
// anything it cannot prove harmless is refused with a reason the model can act on.
export function reviewSource(body, allowlist) {
  const problems = [];
  if (typeof body !== 'string' || !body.trim()) return { problems: ['代码为空。'], functions: [] };
  if (body.length > MAX_BODY) problems.push(`代码超过 ${MAX_BODY} 字符。`);
  const code = stripped(body, true);
  const statements = code.split('.').map((t) => t.replace(/\s+/g, ' ').trim());
  const refused = new Set();
  for (const statement of statements) {
    for (const [pattern, label] of FORBIDDEN_STATEMENTS)
      if (pattern.test(statement)) refused.add(label);
    for (const [pattern, label] of FORBIDDEN_ANYWHERE)
      if (pattern.test(statement)) refused.add(label);
  }
  for (const label of refused) problems.push(`不允许：${label}。`);
  const allowed = (kinds) =>
    new Set(allowlist.filter((e) => kinds.includes(e.kind)).map((e) => e.name.toUpperCase()));
  const functionsAllowed = allowed(['BAPI', 'FM']),
    classesAllowed = allowed(['CLASS']);
  const functions = [
    ...new Set(
      [...stripped(body, false).matchAll(/\bCALL\s+FUNCTION\s+'([^']+)'/gi)].map((m) =>
        m[1].toUpperCase(),
      ),
    ),
  ];
  for (const name of functions)
    if (!functionsAllowed.has(name)) problems.push(`函数 ${name} 不在该系统的白名单中。`);
  const classes = new Set();
  for (const pattern of [
    /\b([A-Z_/][\w/]*)\s*=>/gi,
    /\bNEW\s+([A-Z_/][\w/]*)\s*\(/gi,
    /\bTYPE\s+REF\s+TO\s+([A-Z_/][\w/]*)/gi,
    /\bCREATE\s+OBJECT\b[^.]*?\bTYPE\s+([A-Z_/][\w/]*)/gi,
  ])
    for (const m of code.matchAll(pattern)) classes.add(m[1].toUpperCase());
  for (const name of ['DATA', 'ME', 'IF_OO_ADT_CLASSRUN_OUT']) classes.delete(name);
  for (const name of classes)
    if (!SAFE_CLASSES.has(name) && !classesAllowed.has(name))
      problems.push(`类 ${name} 不在该系统的白名单中。`);
  if (!functions.length && ![...classes].some((c) => classesAllowed.has(c)))
    problems.push('代码没有调用白名单中的 BAPI、函数或类，无法建立单据。');
  return {
    problems,
    functions: [...functions, ...[...classes].filter((c) => classesAllowed.has(c))],
  };
}

export function classSource(name, body) {
  const lower = name.toLowerCase();
  return [
    `CLASS ${lower} DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    '  PUBLIC SECTION.',
    '    INTERFACES if_oo_adt_classrun.',
    'ENDCLASS.',
    '',
    `CLASS ${lower} IMPLEMENTATION.`,
    '  METHOD if_oo_adt_classrun~main.',
    body.replace(/\s+$/, ''),
    '  ENDMETHOD.',
    'ENDCLASS.',
    '',
  ].join('\n');
}

// Lines the generated code prints as `DOCUMENT <object> <number>`.
export function documentsOf(output) {
  return [...String(output).matchAll(/^\s*DOCUMENT\s+(.+?)\s+(\S+)\s*$/gm)].map((m) => ({
    object: m[1],
    number: m[2],
  }));
}

function mcpCaller(connection) {
  return async (name, args) => {
    const envelope = await connection.call(name, args);
    const text = (envelope?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (envelope?.isError) throw new Error(text || `${name} 失败`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
}

const activationErrors = (result) =>
  (result?.messages ?? [])
    .filter((m) => /^[EA]$/i.test(m.type ?? m.objType ?? ''))
    .map((m) => m.shortText ?? m.text ?? JSON.stringify(m))
    .join('；');

// Creates, activates, runs and deletes the temporary class. Each step's failure is recorded;
// a failure after creation still tries to delete the class. Returns the run record.
export async function executeTestData(
  db,
  scope,
  { agent, agentSessionId, requestId, purpose, body },
  { connect = connectMcp, resolve = resolveTestSystem } = {},
) {
  const { target, env } = await resolve(db, scope);
  if (target.environment !== 'QAS') throw new Error('测试数据只能建在 QAS。');
  const allowlist = await listAllowlist(db, scope.organizationId, target.systemId, {
    activeOnly: true,
  });
  const review = reviewSource(body, allowlist);
  if (review.problems.length) throw new Error('代码审查未通过：' + review.problems.join(' '));
  const id = randomUUID();
  const className = CLASS_PREFIX + id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const source = classSource(className, body);
  try {
    await db.query(
      `INSERT INTO app.sap_test_data_run(id,organization_id,project_id,system_id,environment,client,sap_user,agent,agent_session_id,request_id,purpose,class_name,source,functions,status,authorized_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'running',$15)`,
      [
        id,
        scope.organizationId,
        scope.projectId,
        target.systemId,
        target.environment,
        target.client,
        target.username,
        agent,
        agentSessionId,
        requestId,
        String(purpose).slice(0, 2000),
        className,
        source,
        review.functions,
        scope.actorId,
      ],
    );
  } catch (error) {
    if (error.code === '23505') throw new Error('这个建单请求已经执行过，不能重复执行。');
    throw error;
  }

  const url = '/sap/bc/adt/oo/classes/' + className.toLowerCase();
  let status = 'failed',
    output = '',
    failure = null,
    created = false,
    cleanedUp = false,
    connection;
  try {
    connection = await connect(env);
    const call = mcpCaller(connection);
    await call('createObject', {
      objtype: 'CLAS/OC',
      name: className,
      parentName: '$TMP',
      parentPath: '/sap/bc/adt/packages/%24tmp',
      description: 'Workbench test data (temporary)',
      responsible: String(target.username).toUpperCase(),
    });
    created = true;
    const { lockHandle } = await call('lock', { objectUrl: url, accessMode: 'MODIFY' });
    try {
      await call('setObjectSource', {
        objectSourceUrl: url + '/source/main',
        source,
        lockHandle,
      });
    } finally {
      await call('unLock', { objectUrl: url, lockHandle }).catch(() => {});
    }
    const activation = await call('activateByName', { objectName: className, objectUrl: url });
    if (activation?.success === false || activationErrors(activation))
      throw new Error('激活失败：' + (activationErrors(activation) || '语法错误'));
    // The stateful session that activated the class still holds its old definition; a
    // fresh session sees the interface implementation.
    await call('dropSession', {});
    const run = await call('runClass', { className });
    output = String(run?.result ?? run ?? '');
    // Classrun reports its own failures (e.g. a missing implementation) as output text.
    if (/^Error:/.test(output)) throw new Error(output.slice(0, 500));
    status = 'succeeded';
  } catch (error) {
    failure = String(error.message ?? error).slice(0, 2000);
  } finally {
    if (created && connection)
      try {
        const call = mcpCaller(connection);
        const { lockHandle } = await call('lock', { objectUrl: url, accessMode: 'MODIFY' });
        await call('deleteObject', { objectUrl: url, lockHandle });
        cleanedUp = true;
      } catch {}
    await connection?.close().catch(() => {});
    await db.query(
      `UPDATE app.sap_test_data_run SET status=$2,output=$3,error=$4,cleaned_up=$5,finished_at=now() WHERE id=$1`,
      [id, status, output.slice(0, 20000), failure, cleanedUp],
    );
    await db.query(
      `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details) VALUES($1,$2,'sap.test_data.create',$3,'project',$4,$5,$6)`,
      [
        scope.organizationId,
        scope.actorId,
        status === 'succeeded' ? 'success' : 'failure',
        scope.projectId,
        id,
        JSON.stringify({ systemId: target.systemId, className, functions: review.functions }),
      ],
    );
  }
  return {
    id,
    status,
    target,
    className,
    functions: review.functions,
    output,
    error: failure,
    documents: documentsOf(output),
    cleanedUp,
  };
}
