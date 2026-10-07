import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkAction,
  handoffSummary,
} from '../../../apps/api/src/item-workspace/conversations.mjs';
test('continuous chat routes explicit artifact requests and preserves discussion and negation', () => {
  for (const prompt of [
    '请生成说明书',
    '根据刚才讨论输出完整FSD',
    '修改说明书中的异常处理',
    '请根据设计生成ABAP代码',
    '把上述要求写入文档',
    '请生成说明书，包含如何处理异常的内容',
  ])
    assert.equal(resolveWorkAction(prompt), 'draft', prompt);
  for (const prompt of [
    '先不要生成说明书，讨论需求',
    '为什么要生成说明书？',
    '能解释一下代码吗',
    '先讨论，暂不生成',
    '生成说明书是什么意思',
    '不用生成说明书，先讨论范围',
    '不生成说明书，只聊需求',
    '先不要补充文档',
    '无需完善文档',
  ])
    assert.equal(resolveWorkAction(prompt), 'dialogue', prompt);
});
test('handoff is bounded user excerpts, never full assistant output', () => {
  const s = handoffSummary({
    history: [
      { role: 'user', content: '用户要求'.repeat(3000) },
      { role: 'assistant', content: 'SECRET' },
    ],
    decisions: [],
  });
  assert.ok(s.length <= 6000);
  assert.doesNotMatch(s, /SECRET/);
  assert.match(s, /摘录/);
});
