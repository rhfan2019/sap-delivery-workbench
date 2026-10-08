import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../../../../apps/api/src/modules/agent-runtime/coordinator.mjs';
test('RICE suggestion respects correction and does not classify batch as interface', () => {
  assert.equal(c.suggestType('采购申请列表批量修改数量并审批').riceType, 'R');
  assert.equal(c.suggestType('供应商接口消息推送').riceType, 'I');
  assert.equal(c.suggestType('迁移历史主数据').riceType, 'C');
  assert.equal(c.suggestType('BAdI增强校验').riceType, 'E');
  assert.equal(c.suggestType('报表', 'I').source, 'consultant');
  assert.equal(c.suggestType('SmartForms打印表单').supported, false);
  assert.equal(c.suggestType('你好').riceType, null);
});
test('steps require ordered executor transitions; retry keeps attempt; wait releases work', () => {
  const p = c.planRun({ request: '报表', action: 'draft' });
  assert.equal(p.steps[0].status, 'queued');
  assert.throws(() => c.transitionStep(p, 'save', 'succeeded'));
  c.transitionStep(p, 'understand', 'running');
  c.transitionStep(p, 'understand', 'waiting_user');
  assert.equal(p.steps[0].status, 'waiting_user');
  c.transitionStep(p, 'understand', 'running');
  assert.equal(p.steps[0].attempt, 2);
  c.transitionStep(p, 'understand', 'succeeded');
  assert.throws(() => c.transitionStep(p, 'save', 'running'));
});
