import test from 'node:test';
import assert from 'node:assert/strict';
import {
  streamChat,
  chatPayload,
  anthropicPayload,
} from '../../../../apps/api/src/modules/models/chat.mjs';

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
    streamChat({ ...config, protocol: 'openai_responses' }, 'k', { messages: [] }),
    /OpenAI Chat 兼容或 Anthropic Messages/,
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

const claude = { protocol: 'anthropic_messages', modelId: 'claude-opus-5-5', name: 'Claude' };

test('anthropic payload maps the OpenAI-shaped history, tools and limit', () => {
  const payload = anthropicPayload(claude, {
    messages: [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '查 EBAN' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: '想想',
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'ddic', arguments: '{"p":"EBAN"}' } },
          { id: 't2', type: 'function', function: { name: 'ddic', arguments: '{"p":' } },
        ],
      },
      { role: 'tool', tool_call_id: 't1', content: 'ok' },
      { role: 'tool', tool_call_id: 't2', content: '' },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '' },
    ],
    tools: [
      {
        type: 'function',
        function: { name: 'ddic', description: 'd', parameters: { type: 'object' } },
      },
    ],
    maxOutputTokens: 8000,
  });
  assert.equal(payload.system, '你是助手');
  assert.equal(payload.max_tokens, 8000);
  assert.deepEqual(payload.tool_choice, { type: 'auto' });
  assert.deepEqual(payload.tools, [
    { name: 'ddic', description: 'd', input_schema: { type: 'object' } },
  ]);
  assert.deepEqual(
    payload.messages.map((m) => [m.role, m.content.map((b) => b.type)]),
    [
      ['user', ['text']],
      ['assistant', ['tool_use', 'tool_use']],
      ['user', ['tool_result', 'tool_result', 'text']],
    ],
  );
  assert.deepEqual(payload.messages[1].content[0].input, { p: 'EBAN' });
  assert.deepEqual(payload.messages[1].content[1].input, {});
  assert.equal(payload.messages[2].content[1].content, '（空）');
  assert.equal(anthropicPayload(claude, { messages: [] }).max_tokens, undefined);
});

test('anthropic streams assemble text, thinking, tool calls, stop reason and usage', async () => {
  const deltas = [],
    prepared = [];
  const transport = frames(
    {
      type: 'message_start',
      message: { usage: { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 1 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先查' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '我先查' } },
    {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'ddic', input: {} },
    },
    {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"p":' },
    },
    {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '"EBAN"}' },
    },
    {
      type: 'content_block_start',
      index: 3,
      content_block: { type: 'tool_use', id: 'toolu_2', name: 'now', input: {} },
    },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  );
  const result = await streamChat(
    claude,
    'k',
    {
      messages: [{ role: 'user', content: 'x' }],
      onDelta: (d) => deltas.push(d),
      onToolCall: (c) => prepared.push(c.index),
    },
    { transport },
  );
  assert.equal(result.content, '我先查');
  assert.equal(result.reasoning, '先查');
  assert.deepEqual(result.toolCalls, [
    { id: 'toolu_1', name: 'ddic', arguments: '{"p":"EBAN"}' },
    { id: 'toolu_2', name: 'now', arguments: '{}' },
  ]);
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(result.usage, { prompt_tokens: 12, completion_tokens: 7 });
  assert.deepEqual(new Set(prepared), new Set([0, 1]));
  assert.deepEqual(
    deltas.map((d) => d.type),
    ['reasoning', 'text'],
  );
});

test('anthropic errors and unfinished streams are reported', async () => {
  await assert.rejects(
    streamChat(
      claude,
      'k',
      { messages: [] },
      {
        transport: frames({
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
      },
    ),
    /Overloaded/,
  );
  await assert.rejects(
    streamChat(
      claude,
      'k',
      { messages: [] },
      {
        transport: frames({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'x' },
        }),
      },
    ),
    /截断/,
  );
  const r = await streamChat(
    claude,
    'k',
    { messages: [] },
    {
      transport: frames(
        { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
        { type: 'message_stop' },
      ),
    },
  );
  assert.equal(r.finishReason, 'length');
});
