import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';
import { createSseParser } from '@sap-delivery-workbench/contracts/abap-fsd-agent/sse';
import { reconnectingChatStream } from '../../../apps/web/src/features/abap-fsd-agent/chatStream.mjs';
const source = await fs.readFile('apps/web/src/features/abap-fsd-agent/useAssistantRun.ts', 'utf8');
const js = ts.transpileModule(source.replace(/import .*from .*;\r?\n/g, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const base = '/projects/p/development-items/i/abap-fsd-agent';
const frame = (seq, type, data = {}) =>
  `data: ${JSON.stringify({ runId: 'r', seq, type, data })}\n\n`;
const reply = (text) => new Response(text, { headers: { 'content-type': 'text/event-stream' } });
function harness(api, fetch) {
  const exports = {};
  const dependencies = {
    exports,
    computed: vue.computed,
    ref: vue.ref,
    onScopeDispose: vue.onScopeDispose,
    api,
    fetch,
    createSseParser,
    reconnectingChatStream: (url, options) =>
      reconnectingChatStream(url, { ...options, fetcher: fetch, retryDelay: 0 }),
    identity: { value: { user: { id: 'u' } } },
    localStorage: { setItem() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
  const scope = vue.effectScope();
  return { run: scope.run(() => exports.useAssistantRun({ base })), close: () => scope.stop() };
}
test('chat send reconnects same run without cancellation or another POST', async () => {
  const calls = [],
    urls = [];
  const { run, close } = harness(
    async (url, body, method) => {
      calls.push([url, method]);
      return { runId: 'r' };
    },
    async (url) => {
      urls.push(url);
      return reply(
        urls.length === 1
          ? frame(1, 'message.delta', { text: '一' })
          : frame(2, 'message.delta', { text: '二' }) + frame(3, 'run.completed'),
      );
    },
  );
  await run.send({ id: 'm', name: 'model' }, 'hello');
  assert.equal(run.responseText.value, '一二');
  assert.equal(run.status.value, 'completed');
  assert.equal(calls.filter((c) => c[1] === 'POST').length, 1);
  assert.deepEqual(urls, [
    `/api${base}/runs/r/events?after=0`,
    `/api${base}/runs/r/events?after=1`,
  ]);
  close();
});
test('chat restore replays active run stream and replaces partial snapshot without duplication', async () => {
  const calls = [],
    urls = [];
  const saved = {
    runId: 'r',
    conversationId: 'c',
    state: 'running',
    snapshot: { input: { modelId: 'm', selection: {} }, prompt: 'hello' },
    history: [{ id: 'a', role: 'assistant', runId: 'r', content: '一', status: 'running' }],
  };
  const { run, close } = harness(
    async (url, body, method) => {
      calls.push([url, method]);
      return saved;
    },
    async (url) => {
      urls.push(url);
      return reply(
        frame(1, 'message.delta', { text: '一' }) +
          frame(2, 'message.delta', { text: '二' }) +
          frame(3, 'run.completed'),
      );
    },
  );
  await run.restore([{ id: 'm', name: 'model' }], 'r');
  assert.equal(run.status.value, 'completed');
  assert.equal(run.responseText.value, '一二');
  assert.equal(run.messages.value.at(-1).content, '一二');
  assert.equal(run.messages.value.at(-1).status, 'completed');
  assert.equal(urls.length, 1);
  assert.equal(calls.filter((c) => c[1] === 'POST').length, 0);
  close();
});

test('leaving chat detaches the stream without remotely cancelling the run', async () => {
  const calls = [];
  let opened;
  const ready = new Promise((resolve) => {
    opened = resolve;
  });
  const { run, close } = harness(
    async (url, body, method) => {
      calls.push([url, method]);
      return { runId: 'r' };
    },
    async (url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            opened();
            options.signal.addEventListener('abort', () => controller.error(new Error('detached')));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  const sending = run.send({ id: 'm', name: 'model' }, 'hello');
  await ready;
  close();
  await sending;
  assert.equal(
    calls.some(([url]) => url.endsWith('/cancel')),
    false,
  );
});
test('explicit chat stop cancels the same run and consumes its terminal event', async () => {
  const calls = [];
  let output, opened;
  const ready = new Promise((resolve) => {
    opened = resolve;
  });
  const { run, close } = harness(
    async (url, body, method) => {
      calls.push([url, method]);
      if (url.endsWith('/cancel'))
        output.enqueue(new TextEncoder().encode(frame(1, 'run.cancelled')));
      return { runId: 'r' };
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            output = controller;
            opened();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  const sending = run.send({ id: 'm', name: 'model' }, 'hello');
  await ready;
  await run.stop();
  await sending;
  assert.equal(run.status.value, 'cancelled');
  assert.equal(calls.filter(([url]) => url.endsWith('/cancel')).length, 1);
  close();
});
