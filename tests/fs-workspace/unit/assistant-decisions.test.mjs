import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestType } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
import { createRunStore } from '../../../apps/api/src/abap-fsd-agent/runs.mjs';
test('natural purchase request infers report without requiring report keyword', () => {
  assert.equal(
    suggestType('把采购订单拉出来，显示供应商、物料，按工厂筛选，最后合计数量').riceType,
    'R',
  );
});
test('waiting for a decision is never a completed run', async () => {
  const s = createRunStore();
  try {
    const r = s.start({
      owner: { userId: 'u', sessionId: 's' },
      model: { id: 'm', config: {} },
      execute: async () => ({ waitingUser: true, decision: { id: 'd' } }),
    });
    await r.task;
    assert.equal(r.status, 'waiting_user');
    assert.equal(r.events.at(-1).type, 'run.waiting_user');
    assert.ok(!r.events.some((e) => e.type === 'run.completed'));
  } finally {
    s.close();
  }
});
