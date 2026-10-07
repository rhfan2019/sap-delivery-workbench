import test from 'node:test';
import assert from 'node:assert/strict';
import { streamText } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';
const config = {
  protocol: 'openai_chat',
  modelId: 'synthetic',
  maxOutputTokens: 500,
  timeoutSeconds: 5,
  temperature: null,
};
const frame = (data, event) =>
  `${event ? 'event: ' + event + '\r\n' : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`;
async function* bytes(text) {
  for (const b of Buffer.from(text)) yield Buffer.from([b]);
}
const run = async (protocol, text) => {
  const deltas = [];
  await streamText({ ...config, protocol }, 'synthetic', 'hello', {
    onDelta: (t) => deltas.push(t),
    transport: () => bytes(text),
  });
  return deltas.join('');
};
test('chat stream delivers split UTF8 immediately and requires normal terminal', async () => {
  const text =
    frame({ choices: [{ delta: { content: '你好' }, finish_reason: null }] }) +
    frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
    frame('[DONE]');
  assert.equal(await run('openai_chat', text), '你好');
  await assert.rejects(run('openai_chat', text.replace(frame('[DONE]'), '')), /结束|完成/);
  await assert.rejects(run('openai_chat', text.replace('stop', 'length')), /截断|完成/);
});
test('responses and anthropic stream normalize text and terminal', async () => {
  assert.equal(
    await run(
      'openai_responses',
      frame({ type: 'response.output_text.delta', delta: '回复' }) +
        frame({ type: 'response.completed', response: { status: 'completed' } }),
    ),
    '回复',
  );
  assert.equal(
    await run(
      'anthropic_messages',
      frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: '文字' } }) +
        frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) +
        frame({ type: 'message_stop' }),
    ),
    '文字',
  );
});
test('provider errors, tool calls, empty output and oversized events do not become success', async () => {
  await assert.rejects(
    run('openai_responses', frame({ type: 'error', message: 'secret provider body' })),
    /模型|服务/,
  );
  await assert.rejects(
    run('openai_chat', frame({ choices: [{ delta: { tool_calls: [{}] } }] })),
    /工具/,
  );
  await assert.rejects(run('anthropic_messages', frame({ type: 'message_stop' })), /完成|文本/);
  await assert.rejects(run('openai_chat', 'data: ' + 'a'.repeat(270000)), /上限|过大/);
});
test('first delta arrives before supplier completes; cancellation stops upstream iteration', async () => {
  const controller = new AbortController();
  let observed = false;
  async function* provider() {
    yield Buffer.from(frame({ choices: [{ delta: { content: 'first' } }] }));
    assert.equal(observed, true);
    controller.abort();
    controller.signal.throwIfAborted();
  }
  await assert.rejects(
    streamText(config, 'synthetic', 'hello', {
      signal: controller.signal,
      transport: () => provider(),
      onDelta: () => {
        observed = true;
      },
    }),
  );
  assert.equal(observed, true);
});
