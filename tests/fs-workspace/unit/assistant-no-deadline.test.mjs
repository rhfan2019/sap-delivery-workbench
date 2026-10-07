import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunStore } from '../../../apps/api/src/abap-fsd-agent/runs.mjs';
import { streamText } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';

test('multi-stage execution survives former whole-run deadline and remains cancellable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const store = createRunStore();
  let complete;
  try {
    const run = store.start({
      owner: {},
      model: { id: 'long', config: {} },
      execute: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    run.listeners.add(() => {});
    for (let i = 0; i < 10; i++) await Promise.resolve();
    t.mock.timers.tick(31 * 60 * 1000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(run.controller.signal.aborted, false);
    assert.equal(run.status, 'running');
    complete({ done: true });
    await run.task;
    assert.equal(run.status, 'completed');
    const next = store.start({
      owner: {},
      model: { id: 'long', config: {} },
      execute: () => new Promise(() => {}),
    });
    next.listeners.add(() => {});
    store.cancel(next);
    await next.task;
    assert.equal(next.status, 'cancelled');
    store.assertAvailable('long');
  } finally {
    store.close();
    t.mock.timers.reset();
  }
});

test('assistant does not impose a total generation deadline on transport', async () => {
  await streamText({ protocol: 'openai_chat', modelId: 'qwen3.8-max' }, 'fake', 'draft', {
    onDelta() {},
    transport: async function* (config, key, payload, options) {
      assert.equal(options.totalTimeoutMs, undefined);
      assert.equal(payload.enable_thinking, undefined);
      yield Buffer.from(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
});
