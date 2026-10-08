import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunStore } from '../../../../apps/api/src/modules/agent-runtime/runs.mjs';
import { analyzeRun } from '../../../../apps/api/src/modules/agent-runtime/diagnostics/analyzer.mjs';
test('disk failure during accepted/model events terminates without unhandled rejection or lease', async () => {
  const store = createRunStore({
    generate: async () => {
      throw Error('must not call provider without writable trace');
    },
  });
  const run = store.start({
    owner: { userId: 'u', sessionId: 's' },
    model: { id: 'm', config: { modelId: 'test' } },
    prompt: 'x',
    recorder: {
      write() {
        throw Object.assign(Error('disk full'), { code: 'ENOSPC' });
      },
    },
  });
  await run.task;
  assert.equal(run.status, 'failed');
  assert.equal(store.runningIds().length, 0);
  assert.equal(run.events.at(-1).data.code, 'TRACE_WRITE_FAILED');
  store.close();
});
test('unfinished invocation remains visible with unknown duration instead of zero calls', () => {
  const a = analyzeRun({ runId: 'r', state: 'failed', snapshot: {} }, [
    {
      type: 'model.started',
      at: '2026-01-01T00:00:00Z',
      data: { callId: 1, stage: 'generate', task: 'draft' },
    },
  ]);
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].status, 'interrupted');
  assert.equal(a.calls[0].durationMs, null);
});
test('provider attempts sum usage without double counting aggregate events', () => {
  const a = analyzeRun({ runId: 'r', snapshot: {} }, [
    { type: 'model.started', data: { callId: 1 } },
    {
      type: 'model.completed',
      data: {
        callId: 1,
        durationMs: 100,
        result: {
          usage: { prompt_tokens: 8, completion_tokens: 7 },
          attempts: [
            { usage: { prompt_tokens: 3, completion_tokens: 2 } },
            { usage: { prompt_tokens: 8, completion_tokens: 7 } },
          ],
        },
      },
    },
  ]);
  assert.equal(a.calls[0].usage.prompt_tokens, 11);
  assert.equal(a.calls[0].providerRequests, 2);
});
