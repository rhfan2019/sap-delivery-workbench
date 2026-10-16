import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewSource,
  classSource,
  documentsOf,
  executeTestData,
  CLASS_PREFIX,
} from '../../../apps/api/src/modules/sap/test-data.mjs';
import {
  rememberCredentials,
  recalledCredentials,
  forgetCredentials,
} from '../../../apps/api/src/modules/sap/session-credentials.mjs';
import { binding } from '../../../apps/api/src/modules/sap/resolve.mjs';

const allowlist = [
  { kind: 'BAPI', name: 'BAPI_SALESORDER_CREATEFROMDAT2' },
  { kind: 'BAPI', name: 'BAPI_TRANSACTION_COMMIT' },
  { kind: 'BAPI', name: 'BAPI_TRANSACTION_ROLLBACK' },
];
const body = [
  'DATA: ls_header TYPE bapisdhd1, lt_return TYPE STANDARD TABLE OF bapiret2, lv_vbeln TYPE vbeln_va.',
  "ls_header-doc_type = 'OR'. \" a comment saying UPDATE vbak",
  "ls_header-class = 'X'.",
  "CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'",
  '  EXPORTING order_header_in = ls_header',
  '  IMPORTING salesdocument = lv_vbeln',
  '  TABLES return = lt_return.',
  "CALL FUNCTION 'BAPI_TRANSACTION_COMMIT' EXPORTING wait = abap_true.",
  'out->write( |DOCUMENT 销售订单 { lv_vbeln }| ).',
  "DATA(lv_text) = 'SUBMIT and UPDATE are only words here'.",
].join('\n');

test('review accepts allowlisted calls and ignores comments, literals and components', () => {
  assert.deepEqual(reviewSource(body, allowlist), {
    problems: [],
    functions: ['BAPI_SALESORDER_CREATEFROMDAT2', 'BAPI_TRANSACTION_COMMIT'],
  });
});

test('review refuses direct database writes, dynamic and remote calls, unknown objects', () => {
  const bad = [
    body,
    "UPDATE vbak SET netwr = 0 WHERE vbeln = '1'.",
    'DELETE FROM vbap WHERE vbeln = lv_vbeln.',
    'MODIFY vbak FROM @ls_vbak.',
    'CALL FUNCTION lv_name.',
    'SUBMIT zreport AND RETURN.',
    "CALL TRANSACTION 'VA01'.",
    "CALL FUNCTION 'RFC_PING' DESTINATION 'NONE'.",
    'lo_x = NEW zcl_anything( ).',
    'METHOD other.',
  ].join('\n');
  const { problems } = reviewSource(bad, allowlist);
  for (const pattern of [
    /直接更新数据库表/,
    /直接删除数据库表记录/,
    /直接修改数据库表/,
    /动态函数调用/,
    /SUBMIT/,
    /CALL TRANSACTION/,
    /DESTINATION/,
    /函数 RFC_PING 不在/,
    /类 ZCL_ANYTHING 不在/,
    /类或方法定义/,
  ])
    assert.ok(
      problems.some((p) => pattern.test(p)),
      pattern,
    );
  assert.match(reviewSource('out->write( 1 ).', allowlist).problems.join(), /没有调用白名单/);
  assert.match(reviewSource(body, []).problems.join(), /不在该系统的白名单中/);
});

test('the class wraps the body; outputs list created documents', () => {
  const source = classSource('ZCL_SDWB_TD_00000001', '    out->write( 1 ).');
  assert.match(source, /^CLASS zcl_sdwb_td_00000001 DEFINITION PUBLIC FINAL CREATE PUBLIC\./);
  assert.match(source, /INTERFACES if_oo_adt_classrun\./);
  assert.match(
    source,
    /METHOD if_oo_adt_classrun~main\.\n {4}out->write\( 1 \)\.\n {2}ENDMETHOD\./,
  );
  assert.deepEqual(documentsOf('x\nDOCUMENT 销售订单 0000012345\n  DOCUMENT 交货单 80000001'), [
    { object: '销售订单', number: '0000012345' },
    { object: '交货单', number: '80000001' },
  ]);
});

function fakes({
  activation = { success: true, messages: [] },
  output = 'DOCUMENT 销售订单 4711\n',
} = {}) {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: /sap_system_allowlist/.test(sql) ? allowlist : [] };
    },
  };
  const calls = [];
  const reply = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const connection = {
    async call(name, args) {
      calls.push([name, args]);
      if (name === 'lock') return reply({ status: 'success', lockHandle: 'H' });
      if (name === 'activateByName') return reply(activation);
      if (name === 'runClass') return reply({ status: 'success', result: output });
      return reply({ status: 'success' });
    },
    close: async () => {},
  };
  const deps = {
    connect: async () => connection,
    resolve: async () => ({
      target: {
        environment: 'QAS',
        systemId: 's',
        systemCode: 'Q01',
        client: '100',
        username: 'tester',
      },
      env: {},
    }),
  };
  const scope = { organizationId: 'o', projectId: 'p', actorId: 'u' };
  const request = {
    agent: 'abap-fsd-agent',
    agentSessionId: 'a',
    requestId: 'r',
    purpose: 'TD-01',
    body,
  };
  return { db, queries, calls, deps, scope, request };
}

test('execution creates, activates in a fresh session, runs and deletes the class', async () => {
  const f = fakes();
  const run = await executeTestData(f.db, f.scope, f.request, f.deps);
  assert.equal(run.status, 'succeeded');
  assert.ok(run.className.startsWith(CLASS_PREFIX));
  assert.deepEqual(run.documents, [{ object: '销售订单', number: '4711' }]);
  assert.equal(run.cleanedUp, true);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    [
      'createObject',
      'lock',
      'setObjectSource',
      'unLock',
      'activateByName',
      'dropSession',
      'runClass',
      'lock',
      'deleteObject',
    ],
  );
  assert.equal(f.calls[0][1].parentName, '$TMP');
  const record = f.queries.find((q) => /UPDATE app.sap_test_data_run/.test(q.sql));
  assert.deepEqual(record.params.slice(1), ['succeeded', 'DOCUMENT 销售订单 4711\n', null, true]);
  assert.ok(f.queries.some((q) => /sap.test_data.create/.test(q.sql)));
});

test('a failed activation or run is recorded and the class is still deleted', async () => {
  const f = fakes({
    activation: { success: false, messages: [{ type: 'E', shortText: '语法错误 X' }] },
  });
  const run = await executeTestData(f.db, f.scope, f.request, f.deps);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /激活失败：语法错误 X/);
  assert.ok(!f.calls.some(([name]) => name === 'runClass'));
  assert.deepEqual(f.calls.at(-1)[0], 'deleteObject');

  const g = fakes({ output: 'Error: Class does not implement if_oo_adt_classrun~main method!' });
  assert.equal((await executeTestData(g.db, g.scope, g.request, g.deps)).status, 'failed');
});

test('execution refuses PRD-like targets and code failing the review before touching SAP', async () => {
  const f = fakes();
  f.deps.resolve = async () => ({ target: { environment: 'PRD' }, env: {} });
  await assert.rejects(executeTestData(f.db, f.scope, f.request, f.deps), /只能建在 QAS/);
  const g = fakes();
  await assert.rejects(
    executeTestData(g.db, g.scope, { ...g.request, body: 'SUBMIT zx.' }, g.deps),
    /代码审查未通过/,
  );
  assert.equal(f.calls.length + g.calls.length, 0);
});

test('session credentials live per login and project, expire, and can be forgotten', () => {
  const effective = { systemId: 's', sapUrl: 'https://q', client: '100', username: 'TESTER' };
  rememberCredentials('login-1', 'p', effective, 'secret', 1000);
  const entry = recalledCredentials('login-1', 'p', 2000);
  assert.equal(entry.password, 'secret');
  assert.equal(entry.binding, binding(effective));
  assert.equal(recalledCredentials('login-2', 'p', 2000), null);
  assert.equal(recalledCredentials('login-1', 'p', 1000 + 13 * 3600 * 1000), null);
  forgetCredentials('login-1', 'p');
  assert.equal(recalledCredentials('login-1', 'p', 2000), null);
});
