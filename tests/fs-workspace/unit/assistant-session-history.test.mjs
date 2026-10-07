import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionDecisions,
  sessionHistory,
  isReviewContinuation,
} from '../../../apps/api/src/abap-fsd-agent/session-state.mjs';
import { classifyFailure } from '../../../apps/api/src/abap-fsd-agent/errors.mjs';

test('session answers survive ordinary failed runs and later answers supersede only the same question', () => {
  const rows = [
    {
      id: '1',
      snapshot: {
        decisions: [
          { question: '单位？', label: '分组', value: 'o1' },
          { question: '日期', label: '创建日期' },
        ],
      },
    },
    { id: '2', snapshot: { decisions: [] } },
    {
      id: '3',
      snapshot: {
        answer: [{ question: '单位？', label: '不合计', value: 'o2' }],
        answeredAt: '2026-10-05',
      },
    },
  ];
  const answers = sessionDecisions(rows);
  assert.equal(answers.length, 2);
  assert.equal(answers[0].label, '不合计');
  assert.equal(answers[0].sourceRunId, '3');
  assert.equal(answers[1].label, '创建日期');
});

test('history retains original options, answers, later failure and links only the actual artifact owner', () => {
  const decision = {
    id: 'q',
    questions: [
      {
        id: 'a',
        title: '单位？',
        options: [
          { value: 'o1', label: '分组' },
          { value: 'o2', label: '不合计' },
        ],
      },
    ],
  };
  const rows = [
    {
      id: '1',
      state: 'waiting_user',
      snapshot: {
        prompt: '原始需求',
        decision,
        answer: [{ question: '单位？', label: '分组' }],
        resolvedRunId: '2',
      },
    },
    {
      id: '2',
      state: 'completed',
      snapshot: { prompt: '原始需求', resumeRunId: '1', text: 'JSON', input: { action: 'draft' } },
    },
    {
      id: '3',
      state: 'failed',
      snapshot: { prompt: '继续', failure: { code: 'OUTPUT_PROTOCOL', message: '输出协议错误' } },
    },
  ];
  const history = sessionHistory(rows, [{ id: 'a1', run_id: '2', revision: 1 }]);
  assert.equal(history.filter((m) => m.role === 'user' && m.content === '原始需求').length, 1);
  assert.deepEqual(history.find((m) => m.decision)?.decision, decision);
  assert.match(history.find((m) => m.role === 'user' && m.id.includes('answer')).content, /分组/);
  assert.equal(history.find((m) => m.runId === '2' && m.role === 'assistant').artifact.id, 'a1');
  assert.equal(history.at(-1).artifact, undefined);
  assert.equal(history.at(-1).errorCode, 'OUTPUT_PROTOCOL');
});

test('only an exact acknowledgement with a saved draft enters review without regeneration', () => {
  assert.equal(isReviewContinuation('确认，请继续', { latestArtifact: { id: 'a' } }), true);
  assert.equal(
    isReviewContinuation('确认，请继续，增加工厂字段', { latestArtifact: { id: 'a' } }),
    false,
  );
  assert.equal(isReviewContinuation('确认，请继续', { latestArtifact: null }), false);
  assert.equal(
    isReviewContinuation('确认，请继续', { latestArtifact: { id: 'a' }, pending: true }),
    false,
  );
});

test('failure categories distinguish natural language JSON parsing, schema, save and network', () => {
  assert.equal(classifyFailure(new SyntaxError('bad JSON'), 'understand').code, 'OUTPUT_PROTOCOL');
  assert.equal(
    classifyFailure(
      Object.assign(new Error('bad'), { code: 'DRAFT_VALIDATION_FAILED' }),
      'validate',
    ).code,
    'STRUCTURE_VALIDATION',
  );
  assert.equal(classifyFailure(new Error('db password secret'), 'save').code, 'SAVE_FAILED');
  assert.doesNotMatch(
    classifyFailure(new Error('db password secret'), 'save').message,
    /password|secret/,
  );
  assert.equal(classifyFailure(new TypeError('fetch failed'), 'generate').code, 'MODEL_CONNECTION');
  assert.equal(
    classifyFailure(Object.assign(new Error('conflict'), { statusCode: 409 }), 'understand').code,
    'BUSINESS_CONFLICT',
  );
});
