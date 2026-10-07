import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executor } from '../../../apps/api/src/abap-fsd-agent/executor.mjs';
import { planRun } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
const example = JSON.parse(
  readFileSync(
    new URL('../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
    'utf8',
  ),
);
async function run(alwaysBad = false) {
  let calls = 0,
    saves = 0;
  const snapshots = [],
    events = [],
    contexts = [];
  const bad = structuredClone(example);
  bad.fields[0].defaultRule = { status: 'not_applicable', value: '不适用', issueIds: [] };
  const work = executor({
    action: 'draft',
    plan: planRun({ request: '报表', action: 'draft' }),
    context: {
      messages: [{ role: 'system', content: 'original rules' }],
      manifest: { sources: example.sources },
    },
    profile: { systemId: null, identificationSource: 'unknown', profile: {}, evidence: [] },
    verify: { systemId: null },
    persist: async (id, snapshot) => snapshots.push(structuredClone(snapshot)),
    save: async ({ spec }) => {
      saves++;
      return { id: 'artifact', revision: 1, spec };
    },
  });
  let error;
  try {
    await work({
      run: { id: 'r' },
      signal: new AbortController().signal,
      emit: (type, data) => events.push({ type, data }),
      invoke: async (opts) => {
        contexts.push(opts.context);
        opts.onDelta(JSON.stringify(++calls === 1 || alwaysBad ? bad : example));
        return { modelId: 'mock' };
      },
    });
  } catch (e) {
    error = e;
  }
  return { calls, saves, snapshots, events, contexts, error };
}
test('invalid draft gets one in-run repair with original context and exact diagnostics, then saves', async () => {
  const r = await run();
  assert.equal(r.error, undefined);
  assert.equal(r.calls, 2);
  assert.equal(r.saves, 1);
  assert.match(JSON.stringify(r.contexts[1]), /defaultRule\/status/);
  assert.ok(r.events.some((e) => e.type === 'message.reset'));
  assert.ok(r.snapshots.some((s) => s.repair?.originalText));
});
test('repair budget exhausted never publishes an invalid document', async () => {
  const r = await run(true);
  assert.equal(r.calls, 2);
  assert.equal(r.saves, 0);
  assert.ok(r.error);
  assert.ok(r.snapshots.some((s) => s.repair?.status === 'failed'));
});
