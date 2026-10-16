import { randomUUID } from 'node:crypto';
import {
  connectMcp,
  decodeResult,
  testSystemTarget,
  resolveTestSystem,
  reviewSource,
  executeTestData,
} from '../sap/public.mjs';
import { fn, str } from './questions.mjs';
import { guardSapCall, truncate, formatResult } from './sap-tools.mjs';

// Contract 3.4: finding test documents in the test system (QAS) and asking the user to
// authorize creating missing ones. Creation itself runs only after the user agreed, in
// runAuthorizedTestData; the model never triggers a write directly.
export const TEST_DATA_TOOLS = [
  fn(
    'query_test_system',
    '在测试系统（QAS）中执行单表 SELECT，查找测试单据。规则同 runQuery：只查一张表，不用别名、JOIN、子查询；行数用 rowNumber 控制。需要用户已在界面输入本人的 QAS 用户。',
    {
      sqlQuery: str('单表 SELECT 语句'),
      rowNumber: { type: 'integer', description: '最多返回行数，不超过 100' },
    },
    ['sqlQuery'],
  ),
  fn(
    'request_test_data',
    '测试系统中找不到所需单据时，申请在 QAS 建立。提交后本轮结束，用户在界面同意后程序才执行。一次申请建立一组相关单据。',
    {
      data_id: str('对应附录 D.2 的数据编号，如 TD-03；多个用“、”分隔'),
      object: str('要建立的业务对象，如“销售订单（部分拒绝）”'),
      purpose: str('为什么需要：服务哪些测试案例、需要什么数据特征'),
      key_data: str(
        '关键数据，一行一项：组织、单据类型、客户、物料、数量、日期等，均来自 QAS 查询',
      ),
      abap_body: str(
        '主方法 if_oo_adt_classrun~main 的正文（不含 METHOD/ENDMETHOD）。通过标准 BAPI、函数或类建单，不直接写数据库表；检查 RETURN 中的错误，失败时调用 BAPI_TRANSACTION_ROLLBACK，成功时调用 BAPI_TRANSACTION_COMMIT（WAIT = abap_true）；每建成一张单据输出一行 out->write( |DOCUMENT <对象> { 单据号 }| )，并输出 RETURN 中的消息。',
      ),
    },
  ),
];

// Facts for the session context: where test data lives and what creation may call.
// `configured` tells whether the project has a test system at all.
export async function testSystemFacts(db, scope, deps = {}) {
  let target;
  try {
    target = await (deps.testSystemTarget ?? testSystemTarget)(db, scope);
  } catch {
    return {
      configured: false,
      text: '- 测试系统（QAS）：项目未配置。测试单据在目标开发系统中用 runQuery 查找，查不到时来源写“未找到”。',
    };
  }
  const text = [
    `- 测试系统（QAS）：${target.systemCode} ${target.systemName}，client ${target.client}。测试单据用 query_test_system 在 QAS 查找，不在开发系统查找。`,
    target.ready
      ? '- 用户已输入本人的 QAS 用户，可以查询。'
      : '- 用户尚未输入本人的 QAS 用户：query_test_system 会提示用户登录；可以先写其余内容。',
    '- 找不到所需单据时，可以用 request_test_data 申请在 QAS 建立，用户审阅代码并同意后执行。',
  ].join('\n');
  return { configured: true, text };
}

// Per-turn handlers of the test data tools. `results` keeps every QAS query result, as
// the model saw it, so document numbers can be checked against them.
export function createTestDataTools({ db, scope, deps = {} }) {
  const results = [];
  let connection = null,
    requested = null;
  async function query_test_system(args) {
    const problem = guardSapCall('runQuery', args);
    if (problem) return problem;
    if (!connection) {
      let env;
      try {
        ({ env } = await (deps.resolveTestSystem ?? resolveTestSystem)(db, scope));
      } catch (error) {
        return error.code === 'TEST_SYSTEM_LOGIN_REQUIRED'
          ? '用户尚未在界面输入本人的 QAS 用户和密码，暂时无法查询。请在回复中提醒用户点击“登录 QAS”后再继续，或先写其余内容。'
          : '项目未配置可用的 QAS 系统，无法查询测试单据。';
      }
      connection = await (deps.connect ?? connectMcp)(env);
    }
    try {
      const value = await decodeResult(await connection.call('runQuery', args), connection.call);
      const content = truncate(formatResult('runQuery', value));
      results.push(content);
      return content;
    } catch (error) {
      return 'QAS 查询失败：' + String(error.message).slice(0, 500);
    }
  }
  async function request_test_data(args) {
    for (const key of ['data_id', 'object', 'purpose', 'key_data', 'abap_body'])
      if (typeof args[key] !== 'string' || !args[key].trim()) return `缺少 ${key}。`;
    let target;
    try {
      target = await (deps.testSystemTarget ?? testSystemTarget)(db, scope);
    } catch {
      return '项目未配置可用的 QAS 系统，不能申请建单。';
    }
    const review = reviewSource(args.abap_body);
    if (review.problems.length)
      return '代码审查未通过，请修改后重新申请：\n' + review.problems.join('\n');
    requested = {
      id: randomUUID(),
      dataId: args.data_id.trim(),
      object: args.object.trim(),
      purpose: args.purpose.trim(),
      keyData: args.key_data.trim(),
      body: args.abap_body,
      functions: review.functions,
      target: {
        environment: target.environment,
        systemCode: target.systemCode,
        systemName: target.systemName,
        client: target.client,
      },
    };
    return {
      content: '已提交建单授权请求，本轮到此结束，等待用户在界面同意或拒绝。',
      payload: { testDataRequest: requested },
    };
  }
  return {
    handlers: { query_test_system, request_test_data },
    results,
    get requested() {
      return requested;
    },
    close: () => connection?.close().catch(() => {}),
  };
}

// Before a request is approved: the user's own QAS credentials must be present.
// Throws TEST_SYSTEM_NOT_CONFIGURED or TEST_SYSTEM_LOGIN_REQUIRED with a message for the user.
export async function assertTestSystemReady(db, scope, deps = {}) {
  await (deps.resolveTestSystem ?? resolveTestSystem)(db, scope);
}

// The request awaiting the user's decision: the latest one with no user message after it.
export function pendingTestDataRequest(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return null;
    if (m.role === 'tool' && m.payload?.testDataRequest) return m.payload.testDataRequest;
  }
  return null;
}

// Runs a request the user just approved and words the outcome for the model.
export async function runAuthorizedTestData(
  db,
  scope,
  request,
  { agent, agentSessionId, deps = {} },
) {
  let run;
  try {
    run = await (deps.executeTestData ?? executeTestData)(db, scope, {
      agent,
      agentSessionId,
      requestId: request.id,
      purpose: `${request.dataId} ${request.object}：${request.purpose}`,
      body: request.body,
    });
  } catch (error) {
    run = {
      status: 'failed',
      error: String(error.message).slice(0, 1000),
      output: '',
      documents: [],
    };
  }
  const where = run.target ? `QAS（${run.target.systemCode} client ${run.target.client}）` : 'QAS';
  const text =
    run.status === 'succeeded'
      ? `用户同意后，程序已在 ${where} 执行建单代码（临时类${run.cleanedUp ? '已删除' : '未能删除'}）。` +
        (run.documents.length
          ? `建立的单据：${run.documents.map((d) => `${d.object} ${d.number}`).join('、')}。`
          : '输出中没有 DOCUMENT 行，请根据输出判断是否建成。') +
        `\n输出：\n${run.output}`
      : `建单失败：${run.error}${run.output ? `\n输出：\n${run.output}` : ''}`;
  return { run, text: truncate(text) };
}
