import test from 'node:test';
import assert from 'node:assert/strict';
import { streamChat, chatPayload } from '../../../../apps/api/src/modules/models/chat.mjs';

const config = { protocol: 'openai_chat', modelId: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DS' };
const frames = (...values) =>
  async function* () {
    for (const v of values)
      yield Buffer.from(typeof v === 'string' ? v : `data: ${JSON.stringify(v)}\n\n`);
  };
const split = `data: ${JSON.stringify({
  choices: [
    {
      delta: { tool_calls: [{ index: 0, function: { name: 'ement', arguments: 'th":"EBAN"}' } }] },
    },
  ],
})}\n\n`;

test('streamed tool calls are assembled across chunks with text, reasoning and usage', async () => {
  const deltas = [];
  const transport = frames(
    { choices: [{ delta: { reasoning_content: '先查' } }] },
    { choices: [{ delta: { content: '我先查' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_a', function: { name: 'ddicEl', arguments: '{"pa' } },
            ],
          },
        },
      ],
    },
    // one SSE frame split across two network chunks
    split.slice(0, 40),
    split.slice(40),
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    'data: [DONE]\n\n',
  );
  const result = await streamChat(
    config,
    'k',
    { messages: [], onDelta: (d) => deltas.push(d) },
    { transport },
  );
  assert.equal(result.content, '我先查');
  assert.equal(result.reasoning, '先查');
  assert.deepEqual(result.toolCalls, [
    { id: 'call_a', name: 'ddicElement', arguments: '{"path":"EBAN"}' },
  ]);
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 5 });
  assert.deepEqual(
    deltas.map((d) => d.type),
    ['reasoning', 'text'],
  );
});

test('provider errors, truncated streams and unsupported protocols are reported', async () => {
  await assert.rejects(
    streamChat(
      config,
      'k',
      { messages: [] },
      { transport: frames({ error: { message: 'quota' } }) },
    ),
    /quota/,
  );
  await assert.rejects(
    streamChat(
      config,
      'k',
      { messages: [] },
      { transport: frames({ choices: [{ delta: { content: 'x' } }] }) },
    ),
    /截断/,
  );
  await assert.rejects(
    streamChat({ ...config, protocol: 'anthropic_messages' }, 'k', { messages: [] }),
    /OpenAI 兼容/,
  );
});

test('payload only carries optional limits when configured', () => {
  const plain = chatPayload(config, { messages: [], tools: [] });
  assert.equal(plain.max_tokens, undefined);
  assert.equal(plain.enable_thinking, undefined);
  assert.equal(plain.tools, undefined);
  const tuned = chatPayload(config, {
    messages: [],
    tools: [{}],
    maxOutputTokens: 32000,
    thinking: false,
  });
  assert.equal(tuned.max_tokens, 32000);
  assert.equal(tuned.enable_thinking, false);
  assert.equal(tuned.tool_choice, 'auto');
});

test('a first-byte allowance reaches the transport only when given', async () => {
  const seen = [];
  const transport = (_config, _key, _payload, options) => {
    seen.push(options);
    return frames(
      { choices: [{ delta: { content: '好' }, finish_reason: 'stop' }] },
      'data: [DONE]\n\n',
    )();
  };
  await streamChat(config, 'k', { messages: [], firstByteTimeoutMs: 300000 }, { transport });
  await streamChat(config, 'k', { messages: [] }, { transport });
  assert.equal(seen[0].connectionTimeoutMs, 300000);
  assert.equal('connectionTimeoutMs' in seen[1], false);
});
