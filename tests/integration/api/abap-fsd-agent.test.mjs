import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../../fixtures/api.mjs';
import { REQUIRED_SECTIONS } from '../../../apps/api/src/modules/abap-fsd-agent/tools/check.mjs';

const skeleton = REQUIRED_SECTIONS.map(
  ([n, t]) =>
    `## ${n} ${t}\n${n === '附录 D' ? '无需测试案例：这份测试文档没有可执行的取数逻辑。' : t + '的内容'}`,
).join('\n\n');
const reply = (content, toolCalls = []) => ({
  content,
  reasoning: '',
  toolCalls: toolCalls.map(([name, args], i) => ({
    id: `call_${name}_${i}`,
    name,
    arguments: JSON.stringify(args),
  })),
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  usage: { prompt_tokens: 100, completion_tokens: 10 },
});
const question = {
  question: '逾期按哪个日期判断？',
  background: '影响逾期标识',
  options: [
    { label: '计划发货日', impact: 'A' },
    { label: '交货日期', impact: 'B' },
  ],
  recommended: '计划发货日',
  reason: '与考核一致',
  why_customer: '客户口径，系统查不到',
};

// A scripted model: each step pops the next response builder, which sees the messages sent.
function scriptedModel() {
  const queue = [];
  const seen = [];
  return {
    queue,
    seen,
    async streamChat(_config, _key, { messages, onDelta, signal }) {
      seen.push(messages);
      const next = queue.shift();
      if (!next) throw new Error('script exhausted');
      const result = await next(messages, signal);
      if (result.content) onDelta?.({ type: 'text', text: result.content });
      return result;
    },
  };
}

async function setup({ openSap, testData } = {}) {
  const model = scriptedModel();
  const f = await apiFixture({
    abapFsdAgent: {
      resolveModel: async () => ({
        versionId: 'v',
        config: { name: 'Fake', modelId: 'fake' },
        key: 'k',
      }),
      loop: {
        streamChat: model.streamChat,
        openSap: openSap ?? (async () => ({ available: false, reason: '测试环境不连接 SAP' })),
        wait: async () => {},
        testData,
      },
      testData,
    },
  });
  const base = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/abap-fsd-agent`;
  const call = async (method, url, payload, headers = f.headers) => {
    const res = await f.app.inject({ method, url: base + url, payload, headers });
    return { status: res.statusCode, body: res.body, json: () => res.json() };
  };
  const send = async (sessionId, payload) => {
    const res = await call('POST', `/sessions/${sessionId}/messages`, payload);
    assert.equal(res.status, 202, res.body);
    const { turnId } = res.json();
    const events = await call('GET', `/sessions/${sessionId}/turns/${turnId}/events`);
    const end = events.body.split('\n\n').find((frame) => frame.includes('event: turn.end'));
    return { turnId, events: events.body, end: JSON.parse(end.split('data: ')[1]).data };
  };
  return { f, model, call, send };
}

test('a session goes from questions to a draft to a comment-driven revision', async () => {
  const { f, model, call, send } = await setup();
  try {
    const created = await call('POST', '/sessions', { title: '' });
    assert.equal(created.status, 201, created.body);
    const sid = created.json().id;

    model.queue.push(async () => reply('先确认口径。', [['ask_user', { questions: [question] }]]));
    const asked = await send(sid, { content: '设计一个交货逾期清单' });
    assert.equal(asked.end.stopReason, 'asked');
    assert.match(asked.events, /event: tool.end/);
    let detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.equal(detail.session.title, '设计一个交货逾期清单');
    assert.deepEqual(
      detail.messages.map((m) => m.role),
      ['user', 'assistant', 'tool'],
    );
    assert.equal(detail.messages[2].payload.questions[0].question, question.question);
    assert.match(model.seen[0][1].content, /SAP 工具本轮不可用/);

    model.queue.push(
      async (messages) => {
        assert.match(messages.at(-1).content, /答复：计划发货日/);
        return reply('', [
          [
            'write_document',
            { mode: 'replace', content: skeleton, changes: [{ section: '全文', summary: '初稿' }] },
          ],
        ]);
      },
      async (messages) => {
        assert.match(messages.at(-1).content, /自动校验通过/);
        return reply('初稿已完成。');
      },
    );
    const drafted = await send(sid, {
      answers: [{ question: question.question, choice: '计划发货日' }],
    });
    assert.equal(drafted.end.version, 1);
    assert.match(drafted.events, /event: document.saved/);

    const comment = await call('POST', `/sessions/${sid}/comments`, {
      anchorText: '权限校验的内容',
      anchorVersion: 1,
      body: '写清无权限时的处理',
    });
    assert.equal(comment.status, 201, comment.body);
    const commentId = comment.json().id;

    model.queue.push(
      async (messages) => {
        assert.ok(messages[1].content.includes(`[${commentId}]`));
        return reply('', [
          [
            'edit_document',
            {
              old_text: '权限校验的内容',
              new_text: '无权限的工厂排除并提示。',
              reason: '按批注补充',
              comment_id: commentId,
            },
          ],
          ['reply_comment', { comment_id: commentId, reply: '已补充无权限时的处理。' }],
        ]);
      },
      async () => reply('已按批注修改。'),
    );
    const revised = await send(sid, { content: '请处理批注' });
    assert.equal(revised.end.version, 2);
    detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.match(detail.document.markdown, /无权限的工厂排除并提示/);
    assert.equal(detail.document.changes[0].commentId, commentId);
    assert.deepEqual(detail.document.comparison.undeclared, []);
    assert.deepEqual(
      detail.document.comparison.actual.map((c) => c.heading),
      ['2.1 权限校验'],
    );
    assert.equal(detail.comments[0].replies[0].body, '已补充无权限时的处理。');
    assert.deepEqual(
      detail.toolCalls.map((t) => [t.name, t.status]),
      [
        ['ask_user', 'ok'],
        ['write_document', 'ok'],
        ['edit_document', 'ok'],
        ['reply_comment', 'ok'],
      ],
    );

    assert.equal(
      (await call('PATCH', `/sessions/${sid}/comments/${commentId}`, { status: 'resolved' }))
        .status,
      200,
    );
    assert.equal(
      (await call('POST', `/sessions/${sid}/documents/2/labels`, { labels: ['定稿'] })).status,
      200,
    );
    const versions = (await call('GET', `/sessions/${sid}/documents`)).json();
    assert.deepEqual(
      versions.map((v) => [v.version, v.labels]),
      [
        [2, ['定稿']],
        [1, []],
      ],
    );
    const exported = await call('GET', `/sessions/${sid}/export?version=1`);
    assert.equal(exported.status, 200);
    assert.match(exported.body, /权限校验的内容/);
  } finally {
    await f.close();
  }
});

test('a rewrite that touches undeclared sections is flagged', async () => {
  const { f, model, call, send } = await setup();
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(
      async () =>
        reply('', [
          [
            'write_document',
            { mode: 'replace', content: skeleton, changes: [{ section: '全文', summary: '初稿' }] },
          ],
        ]),
      async () => reply('好了'),
      async () =>
        reply('', [
          [
            'write_document',
            {
              mode: 'replace',
              content: skeleton
                .replace('开发概览的内容', '改过的概览')
                .replace('反向审查的内容', '顺手改了'),
              changes: [{ section: '1.1 开发概览', summary: '调整概览' }],
            },
          ],
        ]),
      async () => reply('改好了'),
    );
    await send(sid, { content: '出稿' });
    const second = await send(sid, { content: '改概览' });
    assert.equal(second.end.version, 2);
    const doc = (await call('GET', `/sessions/${sid}/documents/2`)).json();
    assert.deepEqual(doc.comparison.undeclared, ['附录 C 反向审查']);
  } finally {
    await f.close();
  }
});

test('one turn at a time; a running turn can be cancelled; strangers are rejected', async () => {
  const { f, model, call } = await setup();
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(
      (_messages, signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    );
    const first = await call('POST', `/sessions/${sid}/messages`, { content: '开始' });
    assert.equal(first.status, 202);
    const busy = await call('POST', `/sessions/${sid}/messages`, { content: '再来' });
    assert.equal(busy.status, 409);
    assert.equal((await call('POST', `/sessions/${sid}/cancel`, {})).json().cancelled, true);
    const events = await call('GET', `/sessions/${sid}/turns/${first.json().turnId}/events`);
    assert.match(events.body, /"status":"cancelled"/);
    const detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.equal(detail.session.activeTurnId, null);
    assert.equal(detail.turns[0].status, 'cancelled');

    const anonymous = await call('GET', '/sessions', undefined, { origin: f.headers.origin });
    assert.equal(anonymous.status, 401);
    const missing = await call('GET', '/sessions/00000000-0000-4000-8000-000000000000');
    assert.equal(missing.status, 404);
  } finally {
    await f.close();
  }
});

test('a busy provider is retried before the turn fails', async () => {
  const { f, model, call, send } = await setup();
  const busy = () => {
    throw Object.assign(new Error('模型服务繁忙'), { code: 'PROVIDER_BUSY' });
  };
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(busy, busy, async () => reply('好的。'));
    const ok = await send(sid, { content: '你好' });
    assert.equal(ok.end.status, 'completed');
    assert.match(ok.events, /"retry":2/);

    model.queue.push(busy, busy, busy, busy);
    const failed = await send(sid, { content: '再来' });
    assert.equal(failed.end.status, 'failed');
    assert.equal(model.queue.length, 0);
  } finally {
    await f.close();
  }
});

test('test document numbers in appendix D are checked against SAP results', async () => {
  const runQuery = { type: 'function', function: { name: 'runQuery', parameters: {} } };
  const { f, model, call, send } = await setup({
    openSap: async () => ({
      available: true,
      target: { systemCode: 'S4H', systemName: '测试', environment: 'DEV', client: '100' },
      tools: [runQuery],
      call: async (name) =>
        name === 'runQuery'
          ? { status: 'ok', content: '{"rows":[{"AUFNR":"000001000123"}]}' }
          : { status: 'ok', content: 'AFPO（table）共 1 个字段：\nWEMNG' },
      close: async () => {},
    }),
  });
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const documentWith = (number) =>
    skeleton.replace(
      '## 附录 D 测试案例\n无需测试案例：这份测试文档没有可执行的取数逻辑。',
      [
        '# 附录 D 测试案例',
        '## D.1 测试范围与策略\n覆盖取数。',
        [
          '## D.2 测试数据',
          row(['数据编号', '对象', '单据号', '数据特征', '核实条件', '来源', '核实时间']),
          row(Array(7).fill('---')),
          row([
            'TD-01',
            '生产订单',
            number,
            '部分收货',
            '`AFPO-WEMNG` > 0',
            '系统已有',
            '2026-10-15',
          ]),
        ].join('\n'),
        [
          '## D.3 测试案例',
          row([
            '编号',
            '场景',
            '维度',
            '类型',
            '测试数据',
            '操作',
            '预期结果',
            '对应条款',
            '优先级',
          ]),
          row(Array(9).fill('---')),
          row(['TC-01', '部分收货', '取数', '正向', 'TD-01', '执行', `出现 ${number}`, '3', 'P1']),
        ].join('\n'),
        '## D.4 未覆盖与待补\n- 无。',
      ].join('\n\n'),
    );
  const write = (number) => [
    'write_document',
    {
      mode: 'replace',
      content: documentWith(number),
      changes: [{ section: '全文', summary: '初稿' }],
    },
  ];
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(
      async () => reply('', [['runQuery', { sqlQuery: 'SELECT AUFNR FROM AFPO' }]]),
      async () => reply('', [write('9999999')]),
      async (messages) => {
        assert.match(messages.at(-1).content, /没有在本会话的 SAP 查询结果中出现：TD-01 9999999/);
        return reply('', [write('1000123')]);
      },
      async (messages) => {
        assert.match(messages.at(-1).content, /自动校验通过/);
        return reply('初稿已完成。');
      },
    );
    const drafted = await send(sid, { content: '写 FSD' });
    assert.equal(drafted.end.status, 'completed');
    assert.equal(model.queue.length, 0);

    // A later turn without new queries still accepts the number recorded in the saved version.
    model.queue.push(
      async () => reply('', [['check_document', {}]]),
      async (messages) => {
        assert.match(messages.at(-1).content, /自动校验通过/);
        return reply('没有问题。');
      },
    );
    await send(sid, { content: '再检查一遍' });
    assert.equal(model.queue.length, 0);
  } finally {
    await f.close();
  }
});

test('a test data request waits for authorization, then runs before the model continues', async () => {
  let ready = false;
  const executed = [];
  const testData = {
    testSystemTarget: async () => ({
      environment: 'QAS',
      systemId: 's',
      systemCode: 'Q01',
      systemName: '测试系统',
      client: '100',
      ready,
    }),
    resolveTestSystem: async () => {
      if (!ready)
        throw Object.assign(new Error('请先输入您本人的 QAS 用户和密码。'), {
          code: 'TEST_SYSTEM_LOGIN_REQUIRED',
        });
      return { target: {}, env: {} };
    },
    executeTestData: async (_db, _scope, request) => {
      executed.push(request);
      return {
        status: 'succeeded',
        target: { systemCode: 'Q01', client: '100' },
        output: 'DOCUMENT 销售订单 0000004711\n',
        documents: [{ object: '销售订单', number: '0000004711' }],
        cleanedUp: true,
      };
    },
  };
  const { f, model, call, send } = await setup({ testData });
  const body =
    "CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'.\nCALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.";
  const ask = (data_id) => [
    'request_test_data',
    {
      data_id,
      object: '销售订单',
      purpose: 'TC-02 需要部分拒绝的订单',
      key_data: '销售组织 1710',
      abap_body: body,
    },
  ];
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const today = new Date().toISOString().slice(0, 10);
  const withData = (number) =>
    skeleton.replace(
      '## 附录 D 测试案例\n无需测试案例：这份测试文档没有可执行的取数逻辑。',
      [
        '# 附录 D 测试案例',
        '## D.1 测试范围与策略\n覆盖状态。',
        [
          '## D.2 测试数据',
          row(['数据编号', '对象', '单据号', '数据特征', '核实条件', '来源', '核实时间']),
          row(Array(7).fill('---')),
          row(['TD-01', '销售订单', number, '部分拒绝', '`VBAK-ABSTK` = B', '本次新建', today]),
        ].join('\n'),
        [
          '## D.3 测试案例',
          row([
            '编号',
            '场景',
            '维度',
            '类型',
            '测试数据',
            '操作',
            '预期结果',
            '对应条款',
            '优先级',
          ]),
          row(Array(9).fill('---')),
          row(['TC-01', '部分拒绝', '状态', '正向', 'TD-01', '执行', `出现 ${number}`, '3', 'P1']),
        ].join('\n'),
        '## D.4 未覆盖与待补\n- 权限。',
      ].join('\n\n'),
    );
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(async (messages) => {
      assert.match(messages[1].content, /测试系统（QAS）：Q01/);
      assert.match(messages[1].content, /可以用 request_test_data 申请在 QAS 建立/);
      return reply('', [ask('TD-01')]);
    });
    const asked = await send(sid, { content: '补充附录 D' });
    assert.equal(asked.end.stopReason, 'authorization');
    assert.match(asked.events, /"testDataRequest"/);
    const request = (await call('GET', `/sessions/${sid}`))
      .json()
      .messages.find((m) => m.payload?.testDataRequest).payload.testDataRequest;
    assert.deepEqual(request.functions, [
      'BAPI_SALESORDER_CREATEFROMDAT2',
      'BAPI_TRANSACTION_COMMIT',
    ]);
    assert.equal(request.target.systemCode, 'Q01');

    const decide = (decision, requestId = request.id) =>
      call('POST', `/sessions/${sid}/messages`, { authorization: { requestId, decision } });
    assert.equal((await decide('approve', 'other')).status, 409);
    const notLoggedIn = await decide('approve');
    assert.equal(notLoggedIn.status, 409);
    assert.match(notLoggedIn.json().message, /QAS 用户和密码/);
    assert.equal(executed.length, 0);

    ready = true;
    model.queue.push(
      async (messages) => {
        assert.match(messages.at(-1).content, /建立的单据：销售订单 0000004711/);
        assert.match(messages.at(-2).content, /同意在 QAS 建立测试数据（TD-01 销售订单）/);
        return reply('', [
          [
            'write_document',
            {
              mode: 'replace',
              content: withData('99999999'),
              changes: [{ section: '全文', summary: '初稿' }],
            },
          ],
        ]);
      },
      async (messages) => {
        assert.match(messages.at(-1).content, /没有在本会话的 SAP 查询结果中出现：TD-01 99999999/);
        return reply('', [
          [
            'write_document',
            {
              mode: 'replace',
              content: withData('0000004711'),
              changes: [{ section: '全文', summary: '初稿' }],
            },
          ],
        ]);
      },
      async (messages) => {
        assert.match(messages.at(-1).content, /自动校验通过/);
        return reply('附录 D 已写好。');
      },
    );
    const approvedRes = await call('POST', `/sessions/${sid}/messages`, {
      authorization: { requestId: request.id, decision: 'approve' },
    });
    assert.equal(approvedRes.status, 202, approvedRes.body);
    const events = await call('GET', `/sessions/${sid}/turns/${approvedRes.json().turnId}/events`);
    assert.match(events.body, /"name":"create_test_data"/);
    assert.equal(executed.length, 1);
    assert.equal(executed[0].requestId, request.id);
    assert.equal(model.queue.length, 0);
    const detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.ok(detail.toolCalls.some((c) => c.name === 'create_test_data' && c.status === 'ok'));
    assert.equal((await decide('approve')).status, 409);

    model.queue.push(async () => reply('', [ask('TD-02')]));
    await send(sid, { content: '再补一张' });
    const second = (await call('GET', `/sessions/${sid}`))
      .json()
      .messages.filter((m) => m.payload?.testDataRequest)
      .at(-1).payload.testDataRequest;
    model.queue.push(async (messages) => {
      assert.match(messages.at(-1).content, /不同意建立测试数据（TD-02 销售订单）：没有合适的物料/);
      return reply('已标为未找到。');
    });
    const rejected = await call('POST', `/sessions/${sid}/messages`, {
      authorization: { requestId: second.id, decision: 'reject', note: '没有合适的物料' },
    });
    assert.equal(rejected.status, 202);
    await call('GET', `/sessions/${sid}/turns/${rejected.json().turnId}/events`);
    assert.equal(executed.length, 1);
  } finally {
    await f.close();
  }
});
