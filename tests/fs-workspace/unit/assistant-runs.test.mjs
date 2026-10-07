import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunStore } from '../../../apps/api/src/abap-fsd-agent/runs.mjs';
const owner = { userId: 'user', sessionId: 'session' },
  model = { id: 'model', config: { modelId: 'synthetic', timeoutSeconds: 5 } };
test('run reserves model, buffers first delta, cancels upstream and has one terminal', async () => {
  let began;
  const ready = new Promise((r) => (began = r));
  const store = createRunStore({
    generate: async (c, k, p, { signal, onDelta }) => {
      await onDelta('first');
      began();
      await new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  const run = store.start({
    owner,
    model,
    key: 'secret',
    prompt: 'hello',
    requestId: 'request',
    requestHash: 'hash',
  });
  await ready;
  assert.equal(run.events[1].type, 'message.delta');
  assert.throws(
    () => store.start({ owner, model, key: 'secret', prompt: 'other', requestId: 'other' }),
    /调用|等待/,
  );
  assert.throws(() => store.get(run.id, { ...owner, sessionId: 'other' }), /不存在/);
  store.cancel(run);
  await run.task;
  assert.equal(run.status, 'cancelled');
  assert.equal(
    run.events.filter((e) => e.type.startsWith('run.') && e.type !== 'run.accepted').length,
    1,
  );
  assert.equal(store.reuse(owner, 'request', 'hash'), run);
  assert.throws(() => store.reuse(owner, 'request', 'wrong'), /不同内容/);
  store.close();
});
test('provider failures retain partial text and do not leak raw errors', async () => {
  const store = createRunStore({
    generate: async (c, k, p, { onDelta }) => {
      onDelta('partial');
      throw new Error('SECRET');
    },
  });
  const run = store.start({ owner, model, key: 'secret', prompt: 'hello', requestId: 'req' });
  await run.task;
  assert.equal(run.status, 'failed');
  assert.equal(run.events[1].data.text, 'partial');
  assert.ok(!JSON.stringify(run.events).includes('SECRET'));
  store.close();
});
