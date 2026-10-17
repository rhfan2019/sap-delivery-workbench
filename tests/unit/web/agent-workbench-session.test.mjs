import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activitiesFromSteps,
  activitySummary,
  answersFromValues,
  buildTimeline,
  decisionFromQuestions,
  pendingQuestions,
  pendingTestData,
  preparingText,
  reasoningHeading,
  runningText,
  stepFromToolCall,
  toolLabel,
} from '../../../apps/web/src/features/agent-workbench/session-model.mjs';
import {
  formatElapsed,
  waitHint,
} from '../../../apps/web/src/features/agent-workbench/presentation.mjs';

const question = {
  question: '逾期按哪个日期判断？',
  background: '影响逾期标识',
  options: [
    { label: '计划发货日', impact: 'A' },
    { label: '交货日期', impact: 'B' },
  ],
  recommended: '计划发货日',
  reason: '与考核一致',
  why_customer: '客户口径',
};

test('ask_user questions become a decision card and its values become answers', () => {
  const decision = decisionFromQuestions('m1', [question]);
  assert.equal(decision.questions[0].title, '逾期按哪个日期判断？（影响逾期标识）');
  assert.deepEqual(
    decision.questions[0].options.map((o) => [o.value, o.recommended]),
    [
      ['计划发货日', true],
      ['交货日期', false],
    ],
  );
  assert.deepEqual(answersFromValues([question], { q1: '交货日期' }), [
    { question: '逾期按哪个日期判断？', choice: '交货日期' },
  ]);
  assert.deepEqual(answersFromValues([question], { q1: 'text:按实际发货日' }), [
    { question: '逾期按哪个日期判断？', choice: '其他', note: '按实际发货日' },
  ]);
});

const detail = {
  turns: [
    { id: 't1', status: 'completed', model: { name: 'DS' }, startedAt: '2026-10-11T01:00:00Z' },
    { id: 't2', status: 'completed', model: { name: 'DS' }, startedAt: '2026-10-11T01:05:00Z' },
    {
      id: 't3',
      status: 'interrupted',
      model: { name: 'DS' },
      startedAt: '2026-10-11T01:09:00Z',
    },
  ],
  messages: [
    { id: 'u1', turnId: 't1', role: 'user', content: '需求', authorName: '陈顾问' },
    { id: 'a1', turnId: 't1', role: 'assistant', content: '先确认口径。', payload: {} },
    { id: 'x1', turnId: 't1', role: 'tool', content: '已发', payload: { questions: [question] } },
    {
      id: 'u2',
      turnId: 't2',
      role: 'user',
      content: '对问题的答复',
      payload: { answers: [{ question: question.question, choice: '计划发货日' }] },
    },
    { id: 'a2', turnId: 't2', role: 'assistant', content: '', payload: { toolCalls: [{}] } },
    { id: 'a3', turnId: 't2', role: 'assistant', content: '初稿已完成。', payload: {} },
    { id: 'u3', turnId: 't3', role: 'user', content: '改一下' },
  ],
  toolCalls: [
    { turnId: 't1', name: 'ask_user', status: 'ok' },
    { turnId: 't2', name: 'ddicElement', status: 'ok', summary: 'EBAN 共 246 个字段' },
    { turnId: 't2', name: 'write_document', status: 'ok' },
  ],
  documents: [{ version: 1, turnId: 't2', labels: [] }],
};

test('the timeline has one user and one assistant message per turn', () => {
  const timeline = buildTimeline(detail);
  assert.deepEqual(
    timeline.map((m) => [m.role, m.status]),
    [
      ['user', 'completed'],
      ['assistant', 'completed'],
      ['user', 'completed'],
      ['assistant', 'completed'],
      ['user', 'completed'],
      ['assistant', 'failed'],
    ],
  );
  assert.equal(timeline[0].authorName, '陈顾问');
  // A message answering questions is marked, so the bubble can stay one line.
  assert.equal(timeline[2].answered, 1);
  assert.equal(timeline[0].answered, undefined);
  assert.equal(timeline[1].decision.questions.length, 1);
  assert.deepEqual(timeline[1].answers, [{ question: question.question, label: '计划发货日' }]);
  assert.deepEqual(timeline[1].steps, []);
  assert.equal(timeline[3].content, '初稿已完成。');
  assert.deepEqual(
    timeline[3].steps.map((s) => [s.label, s.status]),
    [
      ['读取表结构', 'succeeded'],
      ['编写文档', 'succeeded'],
    ],
  );
  assert.equal(timeline[3].artifact.revision, 1);
  assert.match(timeline[5].error, /中断/);
  assert.equal(toolLabel('unknownTool'), '其他操作');
});

test('only an unanswered question batch at the end is pending', () => {
  assert.equal(pendingQuestions(detail), null);
  const asked = { ...detail, turns: detail.turns.slice(0, 1) };
  assert.equal(pendingQuestions(asked).questions[0].question, question.question);
  assert.equal(buildTimeline(asked)[1].status, 'waiting_user');
});

test('a test data run outcome shows in the timeline, and the request waits for authorization', () => {
  const turns = [
    { id: 't1', status: 'completed', stopReason: 'authorization' },
    { id: 't2', status: 'completed', stopReason: 'answered' },
  ];
  const request = { id: 'r1', dataId: 'TD-01', object: '销售订单' };
  const messages = [
    { id: 'm1', turnId: 't1', role: 'user', content: '补充附录 D', payload: {} },
    {
      id: 'm2',
      turnId: 't1',
      role: 'tool',
      content: '已提交',
      payload: { testDataRequest: request },
    },
    { id: 'm3', turnId: 't2', role: 'user', content: '同意', payload: { authorization: {} } },
    { id: 'm4', turnId: 't2', role: 'user', content: '建单失败：x', payload: { testDataRun: {} } },
  ];
  assert.equal(
    pendingTestData({ turns: turns.slice(0, 1), messages: messages.slice(0, 2) }),
    request,
  );
  assert.equal(pendingTestData({ turns, messages }), null);
  const timeline = buildTimeline({ turns, messages });
  const outcome = timeline.find((m) => m.id === 'm4');
  assert.equal(outcome.role, 'assistant');
  assert.match(outcome.content, /建单结果[\s\S]*建单失败：x/);
});

test("a failed turn's note to the model is not repeated in the reply", () => {
  const timeline = buildTimeline({
    turns: [{ id: 't1', status: 'failed', error: { message: '模型未正常完成。' } }],
    messages: [
      { id: 'u1', turnId: 't1', role: 'user', content: '写初稿' },
      { id: 'a1', turnId: 't1', role: 'assistant', content: '先查表。', payload: {} },
      {
        id: 'a2',
        turnId: 't1',
        role: 'assistant',
        content: '本轮出错：模型未正常完成。已保存的进度不受影响，可以重新发送消息继续。',
        payload: { error: { message: '模型未正常完成。' } },
      },
    ],
  });
  assert.equal(timeline[1].content, '先查表。');
  assert.equal(timeline[1].error, '模型未正常完成。');
});

// The tool calls of one real FSD turn (00006, 2026-10-16), shortened.
const call = (name, args, status = 'ok', preview = null) =>
  stepFromToolCall({ name, arguments: args, status, preview });
const realTurn = [
  call('ddicElement', { path: ['VBAK', 'VBAP', 'TVKO', 'T001'] }),
  call('runQuery', { sqlQuery: 'SELECT vkorg, bukrs FROM tvko', rowNumber: 5 }),
  call('runQuery', {
    sqlQuery: 'SELECT a~vbeln FROM vbak AS a JOIN kna1 AS k ON k~kunnr = a~kunnr',
  }),
  call('searchObject', { query: 'CONVERT_TO_LOCAL_CURRENCY', objType: 'FUNC' }),
  call('runQuery', { sqlQuery: 'SELECT x FROM nowhere' }, 'error'),
  call('searchObject', { query: 'V_VBAK_VKO', objType: 'SUSO' }),
  call('write_document', {
    mode: 'replace',
    changes: [{ section: '1 开发需求部分' }, { section: '2 功能规范' }],
  }),
  call('ddicElement', { path: 'TVAKT' }),
  call('write_document', { mode: 'append', changes: [{ section: '3 业务逻辑' }] }),
  call('edit_document', { reason: '修复字段名' }),
  call('reply_comment', { comment_id: '', reply: '已完成' }, 'error'),
];

test('lookups between two writes become one row that names the objects', () => {
  const rows = activitiesFromSteps(realTurn);
  assert.deepEqual(
    rows.map((r) => [r.title, r.detail, r.count, r.failures]),
    [
      [
        '查阅 SAP 系统',
        '表 VBAK、VBAP、TVKO、T001、KNA1、NOWHERE · 函数 CONVERT_TO_LOCAL_CURRENCY · 权限对象 V_VBAK_VKO',
        6,
        1,
      ],
      ['编写文档', '1 开发需求部分、2 功能规范', 1, 0],
      ['查阅 SAP 系统', '表 TVAKT', 1, 0],
      ['编写文档', '3 业务逻辑', 1, 0],
      // The model's own mistake (an empty comment id) stays in the details of the row before.
      ['修订文档', '1 处', 1, 0],
    ],
  );
  assert.equal(rows.at(-1).steps.length, 2);
  assert.equal(
    activitySummary(realTurn),
    '查阅 6 张表 · 查找 2 个对象 · 编写 3 个章节 · 修订 1 处',
  );
});

test('more than six objects are counted, and a running call opens a row of its own', () => {
  const tables = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const [row] = activitiesFromSteps([call('ddicElement', { path: tables })]);
  assert.equal(row.detail, '表 A、B、C、D、E、F 等 7 张');
  const live = activitiesFromSteps([
    call('write_document', { changes: [{ section: '1 概述' }] }),
    stepFromToolCall({ name: 'runQuery', status: 'running', arguments: '{"sqlQuery": "SELECT' }),
  ]);
  assert.deepEqual(
    live.map((r) => [r.title, r.status]),
    [
      ['编写文档', 'succeeded'],
      ['查阅 SAP 系统', 'running'],
    ],
  );
});

test('the status line says what is being done, also from arguments cut off at 500 characters', () => {
  assert.equal(runningText(realTurn[0]), '正在查阅 VBAK、VBAP、TVKO 等…');
  const cut = stepFromToolCall({
    name: 'write_document',
    status: 'running',
    arguments: '{"mode": "append", "changes": [{"section": "3 业务逻辑", "summary": "写取数',
  });
  assert.equal(typeof cut.input, 'string');
  assert.deepEqual(activitiesFromSteps([cut])[0].detail, '3 业务逻辑');
  assert.equal(runningText(cut), '正在保存：编写文档…');
  assert.equal(
    preparingText({ name: 'write_document', chars: 2380, sections: ['3 业务逻辑'] }),
    '正在编写「3 业务逻辑」… 已生成约 2400 字',
  );
  assert.equal(preparingText({ name: 'write_document', chars: 0 }), '正在编写文档…');
  assert.equal(preparingText({ name: 'ask_user', chars: 50 }), '正在准备：整理待确认问题…');
  assert.equal(reasoningHeading('**Analyzing tables**\n…\n**确定取数路径**\n…'), '确定取数路径');
  assert.equal(reasoningHeading('no headings'), '');
});

test('elapsed time reads naturally and long silences are explained', () => {
  assert.equal(formatElapsed(42_000), '42 秒');
  assert.equal(formatElapsed(237_800), '3 分 57 秒');
  assert.equal(waitHint(10_000), '');
  assert.match(waitHint(30_000), /1～3 分钟/);
  assert.match(waitHint(90_000), /离开页面不会中断/);
});
