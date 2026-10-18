import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewSource,
  classSource,
  documentsOf,
  executeTestData,
  CLASS_PREFIX,
} from '../../../apps/api/src/modules/sap/test-data.mjs';
import { profileCredentials } from '../../../apps/api/src/modules/sap/credentials.mjs';

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

test('review accepts any BAPI, function or class and ignores comments, literals and components', () => {
  assert.deepEqual(reviewSource(body), {
    problems: [],
    functions: ['BAPI_SALESORDER_CREATEFROMDAT2', 'BAPI_TRANSACTION_COMMIT'],
  });
});

test('review refuses direct database writes, dynamic and remote calls, definitions', () => {
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
  const { problems, functions } = reviewSource(bad);
  for (const pattern of [
    /直接更新数据库表/,
    /直接删除数据库表记录/,
    /直接修改数据库表/,
    /动态函数调用/,
    /SUBMIT/,
    /CALL TRANSACTION/,
    /DESTINATION/,
    /类或方法定义/,
  ])
    assert.ok(
      problems.some((p) => pattern.test(p)),
      pattern,
    );
  // Contract 1.9: no allowlist; every function and class called is listed for the user.
  assert.ok(functions.includes('RFC_PING') && functions.includes('ZCL_ANYTHING'));
  assert.ok(!problems.some((p) => /白名单/.test(p)));
  assert.match(reviewSource('out->write( 1 ).').problems.join(), /没有调用任何 BAPI/);
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
  runDump = false,
} = {}) {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const calls = [];
  const reply = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const connection = {
    async call(name, args) {
      calls.push([name, args]);
      if (name === 'lock') return reply({ status: 'success', lockHandle: 'H' });
      if (name === 'activateByName') return reply(activation);
      if (name === 'runClass')
        return runDump
          ? { isError: true, content: [{ type: 'text', text: 'Internal Server Error' }] }
          : reply({ status: 'success', result: output });
      if (name === 'dumps')
        return reply({
          status: 'success',
          dumps: {
            dumps: [
              {
                categories: [
                  { term: 'CALL_FUNCTION_CONFLICT_LENG', label: 'ABAP runtime error' },
                  { term: calls[0][1].name + '==========CP', label: 'Terminated ABAP program' },
                ],
                text: '<p>Short Text&nbsp; Type conflict during a function module call (field length). Runtime Error&nbsp; CALL_FUNCTION_CONFLICT_LENG</p>',
              },
            ],
          },
        });
      return reply({ status: 'success' });
    },
    close: async () => {},
  };
  const deps = {
    allowed: async () => {},
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

test('execution refuses non-test targets, people without the permission and code failing the review', async () => {
  const f = fakes();
  f.deps.resolve = async () => ({ target: { environment: 'DEV' }, env: {} });
  await assert.rejects(executeTestData(f.db, f.scope, f.request, f.deps), /只能建在项目的测试系统/);
  const h = fakes();
  h.deps.allowed = async () => {
    throw Object.assign(new Error('您没有在测试系统创建测试数据的权限。'), {
      code: 'ACCESS_DENIED',
    });
  };
  await assert.rejects(executeTestData(h.db, h.scope, h.request, h.deps), /权限/);
  assert.equal(h.calls.length, 0);
  const g = fakes();
  await assert.rejects(
    executeTestData(g.db, g.scope, { ...g.request, body: 'SUBMIT zx.' }, g.deps),
    /代码审查未通过/,
  );
  assert.equal(f.calls.length + g.calls.length, 0);
});

test('the local credentials file logs in only outside production and for the same system', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(await mkdtemp(join(tmpdir(), 'sap-profile-')), 'profile.json');
  await writeFile(
    file,
    JSON.stringify({
      SAP_URL: 'https://qas.example:44300',
      SAP_CLIENT: '100',
      SAP_USER: 'TESTER',
      SAP_PASSWORD: 'secret',
    }),
  );
  const qas = { sapUrl: 'https://qas.example:44300', client: '100' };
  const env = { SAP_MCP_PROFILE_FILE: file };
  assert.deepEqual(await profileCredentials(qas, env), { username: 'TESTER', password: 'secret' });
  assert.equal(await profileCredentials(qas, { ...env, NODE_ENV: 'production' }), null);
  assert.equal(await profileCredentials({ ...qas, client: '200' }, env), null);
  assert.equal(await profileCredentials({ ...qas, sapUrl: 'https://other:44300' }, env), null);
  assert.equal(await profileCredentials(qas, {}), null);
  assert.equal(await profileCredentials(qas, { SAP_MCP_PROFILE_FILE: file + '.missing' }), null);
});

test('a run that dumps names the step and the runtime error, and says it ran', async () => {
  const f = fakes({ runDump: true });
  const run = await executeTestData(f.db, f.scope, f.request, f.deps);
  assert.equal(run.status, 'failed');
  assert.equal(run.ran, true);
  assert.match(run.error, /^运行建单代码失败：/);
  assert.match(
    run.error,
    /运行时错误 CALL_FUNCTION_CONFLICT_LENG：Type conflict during a function module call/,
  );
  assert.equal(run.dump.error, 'CALL_FUNCTION_CONFLICT_LENG');
  assert.equal(f.calls.at(-1)[0], 'deleteObject');
  const g = fakes({ activation: { success: false, messages: [{ type: 'E', shortText: 'X' }] } });
  const early = await executeTestData(g.db, g.scope, g.request, g.deps);
  assert.deepEqual([early.ran, early.dump], [false, null]);
  assert.match(early.error, /^激活临时类失败：/);
});
