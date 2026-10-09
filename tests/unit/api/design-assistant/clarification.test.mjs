import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClarification,
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
          { id: 'OPT-3', label: '提供代码列表', recommended: false, other: false, requires_material: true },
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
