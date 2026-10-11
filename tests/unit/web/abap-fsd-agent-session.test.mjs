import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answersFromValues,
  buildTimeline,
  decisionFromQuestions,
  pendingQuestions,
  toolLabel,
} from '../../../apps/web/src/features/abap-fsd-agent/session-model.mjs';

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
  assert.equal(toolLabel('unknownTool'), 'unknownTool');
});

test('only an unanswered question batch at the end is pending', () => {
  assert.equal(pendingQuestions(detail), null);
  const asked = { ...detail, turns: detail.turns.slice(0, 1) };
  assert.equal(pendingQuestions(asked).questions[0].question, question.question);
  assert.equal(buildTimeline(asked)[1].status, 'waiting_user');
});
