import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDataTools,
  pendingTestDataRequest,
  runAuthorizedTestData,
  testSystemFacts,
} from '../../../../apps/api/src/modules/agent-core/test-data.mjs';

const target = {
  environment: 'QAS',
  systemId: 's',
  systemCode: 'Q01',
  systemName: '测试系统',
  client: '100',
  ready: false,
};
const deps = {
  testSystemTarget: async () => target,
  resolveTestSystem: async () => {
    throw Object.assign(new Error('login'), { code: 'TEST_SYSTEM_LOGIN_REQUIRED' });
  },
};
const scope = { organizationId: 'o' };
const args = {
  data_id: 'TD-01',
  object: '销售订单',
  purpose: 'TC-02',
  key_data: '销售组织 1710',
  abap_body:
    "CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'.\nCALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.",
};

test('facts name the test system and login state; or say it is not configured', async () => {
  const facts = await testSystemFacts(null, scope, deps);
  assert.equal(facts.configured, true);
  assert.match(facts.text, /Q01 测试系统，client 100/);
  assert.match(facts.text, /尚未输入本人的 QAS 用户/);
  assert.match(facts.text, /可以用 request_test_data 申请在 QAS 建立/);
  assert.doesNotMatch(facts.text, /白名单/);
  const none = await testSystemFacts(null, scope, {
    testSystemTarget: async () => {
      throw new Error('none');
    },
  });
  assert.deepEqual([none.configured, /runQuery/.test(none.text)], [false, true]);
});

test('a reviewed request becomes the pending one; refused code is sent back to the model', async () => {
  const tools = createTestDataTools({ db: null, scope, deps });
  assert.match(
    await tools.handlers.request_test_data({ ...args, abap_body: 'SUBMIT zx.' }),
    /代码审查未通过[\s\S]*SUBMIT/,
  );
  assert.equal(tools.requested, null);
  const outcome = await tools.handlers.request_test_data(args);
  assert.match(outcome.content, /等待用户/);
  const request = outcome.payload.testDataRequest;
  assert.deepEqual(request.functions, [
    'BAPI_SALESORDER_CREATEFROMDAT2',
    'BAPI_TRANSACTION_COMMIT',
  ]);
  assert.equal(tools.requested, request);
  const messages = [
    { role: 'user' },
    { role: 'assistant' },
    { role: 'tool', payload: { testDataRequest: request } },
  ];
  assert.equal(pendingTestDataRequest(messages), request);
  assert.equal(pendingTestDataRequest([...messages, { role: 'user' }]), null);
});

test('queries in QAS ask for the user login first and never connect without it', async () => {
  let connected = false;
  const tools = createTestDataTools({
    db: null,
    scope,
    deps: { ...deps, connect: async () => (connected = true) },
  });
  assert.match(
    await tools.handlers.query_test_system({ sqlQuery: 'SELECT VBELN FROM VBAK' }),
    /尚未在界面输入本人的 QAS 用户/,
  );
  assert.match(
    await tools.handlers.query_test_system({ sqlQuery: 'DELETE FROM VBAK' }),
    /只允许单条 SELECT/,
  );
  assert.equal(connected, false);
});

test('an approved run is worded for the model, success or failure', async () => {
  const request = { id: 'r', dataId: 'TD-01', object: '销售订单', purpose: 'p', body: 'x' };
  const ok = await runAuthorizedTestData(null, scope, request, {
    agent: 'abap-fsd-agent',
    agentSessionId: 'a',
    deps: {
      executeTestData: async (_db, _scope, run) => {
        assert.equal(run.requestId, 'r');
        return {
          status: 'succeeded',
          target: { systemCode: 'Q01', client: '100' },
          output: 'DOCUMENT 销售订单 4711',
          documents: [{ object: '销售订单', number: '4711' }],
          cleanedUp: true,
        };
      },
    },
  });
  assert.match(ok.text, /QAS（Q01 client 100）[\s\S]*临时类已删除[\s\S]*销售订单 4711/);
  const failed = await runAuthorizedTestData(null, scope, request, {
    agent: 'abap-fsd-agent',
    agentSessionId: 'a',
    deps: {
      executeTestData: async () => {
        throw new Error('请先输入您本人的 QAS 用户和密码。');
      },
    },
  });
  assert.equal(failed.run.status, 'failed');
  assert.match(failed.text, /^建单失败：请先输入/);
});

test('a failed QAS query returns SAP’s own error text, not a login hint', async () => {
  const tools = createTestDataTools({
    db: null,
    scope,
    deps: {
      ...deps,
      resolveTestSystem: async () => ({ target, env: {} }),
      connect: async () => ({
        call: async () => ({
          isError: true,
          content: [
            { type: 'text', text: 'The elements in the "ORDER BY" list must be separated' },
          ],
        }),
        close: async () => {},
      }),
    },
  });
  const answer = await tools.handlers.query_test_system({
    sqlQuery: 'SELECT VBELN FROM VBAK ORDER BY ERDAT DESC',
  });
  assert.match(answer, /^QAS 查询失败：.*ORDER BY/);
  assert.doesNotMatch(answer, /登录/);
  assert.deepEqual(tools.results, []);
});
