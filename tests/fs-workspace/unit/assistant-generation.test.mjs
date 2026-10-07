import test from 'node:test';
import assert from 'node:assert/strict';
import { streamText, streamPayload } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';
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
test('draft recovery continues exact partial JSON with a bounded extra request', async () => {
  const { streamAssistant } = await import('../../../apps/api/src/abap-fsd-agent/generation.mjs');
  let n = 0,
    text = '';
  const attempts = [];
  const result = await streamAssistant(config, 'key', 'x', {
    context: { messages: [{ role: 'user', content: 'x' }], manifest: { task: 'draft' } },
    onDelta: (d) => (text += d),
    onProgress: (p) => attempts.push(p),
    transport: async function* (c, k, p) {
      n++;
      assert.equal(p.max_tokens, undefined);
      if (n === 2)
        assert.ok(p.messages.some((m) => m.role === 'assistant' && m.content === '{"title":'));
      yield frames(n === 1 ? ' {"title":'.trim() : '"ok"}', n === 1 ? 'length' : 'stop');
    },
  });
  assert.deepEqual(JSON.parse(text), { title: 'ok' });
  assert.equal(n, 2);
  assert.equal(result.attempts.length, 2);
  assert.equal(attempts.length, 1);
});
test('recovery stops at budget and never retries provider refusal', async () => {
  const { streamAssistant } = await import('../../../apps/api/src/abap-fsd-agent/generation.mjs');
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
  assert.equal(n, 3);
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
