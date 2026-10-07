import test from 'node:test';
import assert from 'node:assert/strict';
import { executor } from '../../../apps/api/src/abap-fsd-agent/executor.mjs';
import { planRun } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
test('first terminal persistence contains final steps and failure', async () => {
  const writes = [];
  let snapshot = {};
  const work = executor({
    action: 'draft',
    plan: planRun({ request: '报表', action: 'draft' }),
    context: { messages: [], manifest: { sources: [] } },
    persist: async (id, s, state) => {
      snapshot = { ...snapshot, ...structuredClone(s) };
      writes.push({ s: snapshot, state });
    },
  });
  await assert.rejects(
    work({
      run: { id: 'r' },
      signal: new AbortController().signal,
      emit() {},
      invoke: async (o) => {
        o.onDelta('{}');
        return {};
      },
    }),
  );
  const terminal = writes.find((x) => x.state === 'failed');
  assert.ok(terminal.s.failure);
  assert.equal(terminal.s.plan.steps.find((x) => x.stepId === 'validate').status, 'failed');
  assert.ok(terminal.s.validation.errors.length);
});
