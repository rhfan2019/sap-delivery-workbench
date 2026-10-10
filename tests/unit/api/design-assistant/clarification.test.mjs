import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClarification,
  normalizeReview,
  validateAnswer,
} from '../../../../apps/api/src/modules/design-assistant/policy.mjs';

test('CLAR-01 options the model marks requires_material stay answerable without an attachment', () => {
  const batch = normalizeClarification({
    kind: 'ClarificationBatch',
    questions: [
      {
        id: 'Q-03',
        question: '订单类型范围？',
        options: [
          { id: 'OPT-1', label: 'OR', recommended: true, other: false, requires_material: false },
          {
            id: 'OPT-3',
            label: '提供代码列表',
            recommended: false,
            other: false,
            requires_material: true,
          },
          { id: 'OPT-4', label: '其他', recommended: false, other: true, requires_material: true },
        ],
      },
    ],
  });
  const [q] = batch.questions;
  assert.ok(q.options.every((o) => o.requires_material === false));
  assert.equal(validateAnswer(q, { option_id: 'OPT-3' }, []).answer, '提供代码列表');
  assert.equal(validateAnswer(q, { option_id: 'OPT-4', text: '暂不确定' }, []).text, '暂不确定');
});

test('REVIEW-01 review issues get missing structural fields; the finding text is kept', () => {
  const out = normalizeReview({
    kind: 'ReviewResult',
    issues: [
      { rule_ref: 'LOG-QUERY', counterexample: '多计划行重复计数', status: 'open' },
      { id: 'X', description: '状态口径冲突', impact: '漏选', status: '已解决' },
    ],
  });
  assert.deepEqual(out.issues, [
    {
      issue_id: 'REVIEW-1',
      rule_ref: 'LOG-QUERY',
      counterexample: '多计划行重复计数',
      evidence_refs: [],
      impact: '未说明影响',
      suggestion: '未给出建议',
      status: 'OPEN',
    },
    {
      issue_id: 'X',
      rule_ref: 'UNSPECIFIED',
      counterexample: '状态口径冲突',
      evidence_refs: [],
      impact: '漏选',
      suggestion: '未给出建议',
      status: 'RESOLVED',
    },
  ]);
});
