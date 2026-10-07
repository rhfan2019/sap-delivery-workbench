import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { effectScope } from 'vue';
import { createSseParser } from '../../../packages/contracts/abap-fsd-agent/sse.mjs';
const source = await fs.readFile(
  'apps/web/src/features/fs-assistant-test/useAssistantRun.ts',
  'utf8',
);
const js = ts.transpileModule(source.replace(/import .*from .*;\r?\n/g, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function harness(api, fetch) {
  const vue = await import('vue');
  const exports = {};
  const dependencies = {
    exports,
    computed: vue.computed,
    onScopeDispose: vue.onScopeDispose,
    ref: vue.ref,
    api,
    fetch,
    createSseParser,
    identity: { value: { user: { id: 'u' } } },
    localStorage: { setItem() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
  const scope = effectScope();
  return { run: scope.run(() => exports.useAssistantRun()), close: () => scope.stop() };
}

test('terminal event releases UI and reader even when SSE connection stays open', async () => {
  let cancelled = false;
  const { run, close } = await harness(
    async () => ({ runId: 'r1' }),
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"runId":"r1","seq":1,"type":"run.completed","data":{}}\n\n',
              ),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  try {
    await Promise.race([
      run.send({ id: 'm', name: 'model', rowVersion: '1' }, 'request'),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('terminal event left UI busy')), 100),
      ),
    ]);
    assert.equal(run.busy.value, false);
    assert.equal(run.status.value, 'completed');
    assert.equal(cancelled, true);
  } finally {
    close();
  }
});

test('restored retry uses current model version after administrator fixes configuration', async () => {
  let submitted;
  const { run, close } = await harness(
    async (path, body) => {
      if (path.endsWith('/runs')) {
        submitted = body;
        return { runId: 'r2' };
      }
      return {
        runId: 'r1',
        state: 'failed',
        snapshot: {
          input: { modelId: 'm', modelRowVersion: 'old', selection: {} },
          prompt: 'retry me',
        },
        history: [],
      };
    },
    async () =>
      new Response('data: {"runId":"r2","seq":1,"type":"run.completed","data":{}}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  try {
    await run.restore([{ id: 'm', name: 'model', rowVersion: 'new' }], 'r1');
    await run.retry();
    assert.equal(submitted.rowVersion, 'new');
    assert.equal(submitted.retryRunId, 'r1');
  } finally {
    close();
  }
});
test('running restore recovers after one poll error and freezes at server completion', async () => {
  const vue = await import('vue');
  const exports = {},
    scheduled = [];
  let calls = 0;
  const api = async () => {
    calls++;
    if (calls === 2) throw new Error('temporary');
    return {
      runId: 'r',
      state: calls < 3 ? 'running' : 'completed',
      conversationId: 'c',
      serverTime: new Date().toISOString(),
      snapshot: { input: { modelId: 'm', selection: {} }, plan: { steps: [] } },
      history: [
        {
          id: 'r:a',
          runId: 'r',
          role: 'assistant',
          status: calls < 3 ? 'failed' : 'completed',
          content: calls < 3 ? '' : '完成',
          createdAt: '2026-10-05T14:00:00Z',
          finishedAt: calls < 3 ? null : '2026-10-05T14:01:00Z',
        },
      ],
    };
  };
  new Function(
    'exports',
    'computed',
    'onScopeDispose',
    'ref',
    'api',
    'createSseParser',
    'identity',
    'localStorage',
    'setTimeout',
    'clearTimeout',
    'cancelAnimationFrame',
    js,
  )(
    exports,
    vue.computed,
    vue.onScopeDispose,
    vue.ref,
    api,
    createSseParser,
    { value: { user: { id: 'u' } } },
    { setItem() {} },
    (fn) => {
      scheduled.push(fn);
      return 1;
    },
    () => {},
    () => {},
  );
  const scope = effectScope();
  const run = scope.run(() => exports.useAssistantRun());
  await run.restore([{ id: 'm' }], 'r');
  assert.equal(run.busy.value, true);
  await scheduled.shift()();
  assert.match(run.error.value, /重试/);
  await scheduled.shift()();
  assert.equal(run.error.value, '');
  assert.equal(run.busy.value, false);
  assert.equal(run.messages.value[0].finishedAt, '2026-10-05T14:01:00Z');
  scope.stop();
});

test('scoped restore rejects a run from another item and keeps the new conversation editable', async () => {
  const vue = await import('vue');
  const exports = {};
  const storage = new Map();
  new Function(
    'exports',
    'computed',
    'onScopeDispose',
    'ref',
    'api',
    'createSseParser',
    'identity',
    'localStorage',
    js,
  )(
    exports,
    vue.computed,
    vue.onScopeDispose,
    vue.ref,
    async () => ({
      runId: 'old',
      conversationId: 'old-session',
      state: 'completed',
      snapshot: { input: { selection: { projectId: 'p', itemId: 'A' } } },
      history: [{ id: 'old', content: 'A content' }],
    }),
    createSseParser,
    { value: { organization: { id: 'o' }, user: { id: 'u' } } },
    {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
  );
  const scope = effectScope();
  const run = scope.run(() =>
    exports.useAssistantRun({
      storageScope: 'p:B:design',
      selection: { projectId: 'p', itemId: 'B' },
    }),
  );
  await run.restore([], 'old');
  assert.equal(run.conversationId.value, '');
  assert.equal(run.messages.value.length, 0);
  assert.match(run.error.value, /归属|目标/);
  scope.stop();
});
test('late cancel failure cannot resurrect terminal run; reader settlement prevents overlap', async () => {
  const vue = await import('vue');
  let stream, rejectCancel, settleReader;
  const api = async (path) =>
    path.endsWith('/cancel')
      ? new Promise((_, reject) => {
          rejectCancel = reject;
        })
      : { runId: 'r1' };
  const fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          stream = c;
        },
        cancel() {
          return new Promise((resolve) => {
            settleReader = resolve;
          });
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  const exports = {};
  new Function(
    'exports',
    'computed',
    'onScopeDispose',
    'ref',
    'api',
    'createSseParser',
    'fetch',
    'identity',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    js,
  )(
    exports,
    vue.computed,
    vue.onScopeDispose,
    vue.ref,
    api,
    createSseParser,
    fetch,
    { value: { user: { id: 'u', displayName: '测试顾问' } } },
    () => 1,
    () => {},
  );
  const scope = effectScope();
  const run = scope.run(() => exports.useAssistantRun());
  const pending = run.send({ id: 'm', name: 'model', rowVersion: '1' }, 'hello');
  await new Promise((r) => setImmediate(r));
  run.reset();
  assert.equal(run.messages.value.length, 2, 'active run cannot be cleared');
  const stopping = run.stop();
  stream.enqueue(
    new TextEncoder().encode(
      'data: ' + JSON.stringify({ runId: 'r1', seq: 1, type: 'run.completed', data: {} }) + '\n\n',
    ),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(run.busy.value, true, 'reader still owns the run until settled');
  settleReader();
  await pending;
  assert.equal(run.status.value, 'completed');
  assert.equal(run.busy.value, false);
  rejectCancel(new Error('late failure'));
  await stopping;
  assert.equal(run.status.value, 'completed');
  assert.equal(run.busy.value, false);
  run.reset();
  assert.equal(run.messages.value.length, 0);
  assert.equal(run.receipt.value, null);
  scope.stop();
});
test('SSE accepts CR-only delimiters and split CRLF', () => {
  const p = createSseParser();
  assert.equal(p.push('data: ok\r\r').length, 1);
  p.finish();
  const q = createSseParser();
  assert.equal(q.push('data: ok\r').length, 0);
  assert.equal(q.push('\n\r').length, 1);
  assert.equal(q.push('\n').length, 0);
  q.finish();
});

test('new conversation ignores a delayed old restore response', async () => {
  const vue = await import('vue');
  let finishRestore;
  const storage = new Map([['fs-assistant-run:org:user', 'old']]);
  const exports = {};
  new Function(
    'exports',
    'computed',
    'onScopeDispose',
    'ref',
    'api',
    'createSseParser',
    'identity',
    'localStorage',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    js,
  )(
    exports,
    vue.computed,
    vue.onScopeDispose,
    vue.ref,
    () =>
      new Promise((resolve) => {
        finishRestore = resolve;
      }),
    createSseParser,
    { value: { organization: { id: 'org' }, user: { id: 'user' } } },
    {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    () => 1,
    () => {},
  );
  const scope = effectScope();
  const run = scope.run(() => exports.useAssistantRun());
  const restore = run.restore([], 'old');
  run.reset();
  finishRestore({
    runId: 'old',
    conversationId: 'old-conversation',
    state: 'completed',
    snapshot: { prompt: 'old prompt' },
    history: [{ id: 'old-message', role: 'user', status: 'completed', content: 'old prompt' }],
  });
  await restore;
  assert.equal(run.conversationId.value, '');
  assert.deepEqual(run.messages.value, []);
  assert.equal(storage.has('fs-assistant-run:org:user'), false);
  scope.stop();
});

test('cancelled terminal keeps streamed text while persistence is still catching up', async () => {
  const vue = await import('vue');
  const exports = {};
  const api = async (path) =>
    path.endsWith('/r1')
      ? {
          state: 'running',
          history: [
            { id: 'r1:assistant', role: 'assistant', runId: 'r1', content: '', status: 'failed' },
          ],
          artifacts: [],
        }
      : { runId: 'r1' };
  const events = [
    { runId: 'r1', seq: 1, type: 'message.delta', data: { text: '已收到的部分输出' } },
    { runId: 'r1', seq: 2, type: 'run.cancelled', data: {} },
  ]
    .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
    .join('');
  new Function(
    'exports',
    'computed',
    'onScopeDispose',
    'ref',
    'api',
    'createSseParser',
    'fetch',
    'identity',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    js,
  )(
    exports,
    vue.computed,
    vue.onScopeDispose,
    vue.ref,
    api,
    createSseParser,
    async () => new Response(events, { headers: { 'content-type': 'text/event-stream' } }),
    { value: { user: { id: 'u', displayName: '测试顾问' } } },
    () => 1,
    () => {},
  );
  const scope = effectScope();
  const run = scope.run(() => exports.useAssistantRun());
  await run.send({ id: 'm', name: 'model', rowVersion: '1' }, '生成报表', {}, { action: 'draft' });
  assert.equal(run.status.value, 'cancelled');
  assert.equal(run.messages.value.at(-1).status, 'cancelled');
  assert.equal(run.messages.value.at(-1).content, '已收到的部分输出');
  scope.stop();
});
