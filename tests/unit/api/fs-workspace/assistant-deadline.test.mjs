import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunStore } from '../../../../apps/api/src/modules/agent-runtime/runs.mjs';
import { sessionHistory } from '../../../../apps/api/src/modules/agent-runtime/session-state.mjs';

test('uncooperative late work cannot replace terminal state or emit a late artifact', async () => {
  const store = createRunStore();
  let complete, emitLate, persisted;
  try {
    const run = store.start({
      owner: {},
      model: { id: 'late', config: {} },
      persistTerminal: async (id, snapshot, state) => {
        persisted = { id, snapshot, state };
      },
      execute: ({ emit }) => {
        emitLate = emit;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    store.cancel(run);
    const keepAlive = setTimeout(() => {}, 100);
    await run.task;
    clearTimeout(keepAlive);
    assert.equal(persisted.state, 'cancelled');
    assert.equal(persisted.snapshot.failure.code, 'CANCELLED');
    complete({ artifactId: 'late' });
    emitLate('artifact.ready', { id: 'late' });
    await Promise.resolve();
    assert.equal(run.status, 'cancelled');
    assert.equal(run.events.filter((e) => e.type === 'artifact.ready').length, 0);
    store.assertAvailable('late');
  } finally {
    store.close();
  }
});

test('historical JSON is readable without becoming an approvable saved artifact', () => {
  const steps = [{ stepId: 'generate', status: 'succeeded' }];
  const history = sessionHistory([
    {
      id: 'old',
      state: 'completed',
      snapshot: {
        text: JSON.stringify({ title: '交货分析', rules: ['按交货日计算'] }),
        plan: { steps },
      },
    },
  ]);
  assert.match(history.at(-1).rendered.markdown, /交货分析/);
  assert.match(history.at(-1).rendered.markdown, /按交货日计算/);
  assert.equal(history.at(-1).artifact, undefined);
  assert.deepEqual(history.at(-1).steps, steps);
  assert.equal(
    sessionHistory([{ id: 'bad', state: 'failed', snapshot: { text: '{"title":' } }]).at(-1)
      .rendered,
    undefined,
  );
});

test('failed or stalled terminal persistence cannot keep a run alive or renew its lease', async () => {
  for (const persistTerminal of [
    async () => {
      throw Error('offline');
    },
    () => new Promise(() => {}),
  ]) {
    const store = createRunStore({ persistTimeoutMs: 10 });
    const keepAlive = setTimeout(() => {}, 500);
    try {
      const run = store.start({
        owner: {},
        model: { id: 'm', config: {} },
        persistTerminal,
        execute: async () => {
          throw Object.assign(Error('network idle'), { code: 'STREAM_IDLE_TIMEOUT' });
        },
      });
      await run.task;
      assert.equal(run.status, 'failed');
      assert.equal(run.metadata.terminalPersistenceFailed, true);
      assert.deepEqual(store.runningIds(), []);
      store.assertAvailable('m');
    } finally {
      clearTimeout(keepAlive);
      store.close();
    }
  }
});
