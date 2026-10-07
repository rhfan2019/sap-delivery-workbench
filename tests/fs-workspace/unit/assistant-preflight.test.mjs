import test from 'node:test';
import assert from 'node:assert/strict';
import { executor } from '../../../apps/api/src/abap-fsd-agent/executor.mjs';
import { planRun } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
test('preflight questions stop before long draft and preserve exact question output', async () => {
  const snapshots = [];
  let calls = 0;
  const preflight = {
    messages: [{ role: 'system', content: 'clarify' }],
    manifest: { task: 'clarification' },
  };
  const work = executor({
    action: 'draft',
    plan: planRun({ request: '报表', action: 'draft' }),
    context: { preflight, messages: [], manifest: {} },
    persist: async (id, s) => snapshots.push(structuredClone(s)),
    save: () => {
      throw Error('must not save');
    },
  });
  const result = await work({
    run: { id: 'r' },
    signal: new AbortController().signal,
    emit() {},
    invoke: async (o) => {
      calls++;
      assert.equal(o.context, preflight);
      o.onDelta(
        '说明 {"kind":"clarification","questions":[{"title":"数量怎样合计？","options":[{"label":"同单位分组","description":"避免混加"},{"label":"暂不确定","description":"保留待确认"}]}]}',
      );
      return { modelId: 'test' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.waitingUser, true);
  assert.ok(snapshots.some((s) => s.preflight?.text?.startsWith('说明')));
  assert.ok(snapshots.some((s) => s.plan?.steps[0].status === 'waiting_user'));
});
