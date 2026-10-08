import test from 'node:test';
import assert from 'node:assert/strict';
import { streamText, streamPayload } from '../../../../apps/api/src/modules/agent-runtime/model-stream.mjs';
const config = {
  protocol: 'openai_chat',
  provider: 'QianWen',
  modelId: 'qwen3.8-flash',
  maxOutputTokens: 8192,
};
const frames = (text, reason) =>
  Buffer.from(
    'data: ' +
      JSON.stringify({
        choices: [{ delta: { content: text }, finish_reason: reason }],
        usage: { completion_tokens: 8192 },
      }) +
      '\n\ndata: [DONE]\n\n',
  );
test('Qwen omits output caps and retains final content and truncation diagnostics', async () => {
  assert.equal(streamPayload(config, 'x').max_tokens, undefined);
  assert.equal(streamPayload(config, 'x').max_completion_tokens, undefined);
  let text = '';
  let error;
  try {
    await streamText(config, 'key', 'x', {
      onDelta: (d) => (text += d),
      transport: async function* () {
        yield frames('last chunk', 'length');
      },
    });
  } catch (e) {
    error = e;
  }
  assert.equal(text, 'last chunk');
  assert.equal(error.code, 'OUTPUT_LIMIT');
  assert.equal(error.finishReason, 'length');
  assert.equal(error.outputLimit, null);
});
test('retired design continuation is not revived: truncation keeps partial output and one diagnostic attempt', async () => {
  const { streamAssistant } = await import('../../../../apps/api/src/modules/agent-runtime/generation.mjs');
  let n = 0,
    text = '';
  const attempts = [];
  await assert.rejects(streamAssistant(config, 'key', 'x', {
    context: { messages: [{ role: 'user', content: 'x' }], manifest: { task: 'draft' } },
    onDelta: (d) => (text += d),
    onAttempt: (event, detail) => attempts.push({ event, detail }),
    transport: async function* (c, k, p) {
      n++;
      assert.equal(p.max_tokens, undefined);
      assert.equal(p.messages.some((m) => m.role === 'assistant'), false);
      yield frames('{"title":', 'length');
    },
  }), (error) => error.code === 'OUTPUT_LIMIT' && error.attempts.length === 1);
  assert.equal(text, '{"title":');
  assert.equal(n, 1);
  assert.deepEqual(attempts.map(a => a.event), ['started', 'failed']);
  assert.equal(attempts[1].detail.output, text);
});
test('single-attempt development transport never automatically retries truncation or provider refusal', async () => {
  const { streamAssistant } = await import('../../../../apps/api/src/modules/agent-runtime/generation.mjs');
  let n = 0;
  await assert.rejects(
    streamAssistant(config, 'key', 'x', {
      context: { messages: [], manifest: { task: 'draft' } },
      onDelta() {},
      transport: async function* () {
        n++;
        yield frames('x', 'length');
      },
    }),
    (e) => e.code === 'OUTPUT_LIMIT',
  );
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(
    streamAssistant(config, 'key', 'x', {
      context: { messages: [], manifest: { task: 'draft' } },
      onDelta() {},
      transport: async function* () {
        n++;
        yield frames('', 'content_filter');
      },
    }),
    (e) => e.code === 'CONTENT_FILTER',
  );
  assert.equal(n, 1);
});
