import test from 'node:test';
import assert from 'node:assert/strict';
import { streamAssistant } from '../../../apps/api/src/abap-fsd-agent/generation.mjs';
test('every continuation logs its actual payload and attempt-specific output', async () => {
  const events = [];
  let n = 0;
  await streamAssistant(
    { protocol: 'openai_chat', modelId: 'synthetic' },
    'DO_NOT_RECORD_KEY',
    'x',
    {
      context: { messages: [{ role: 'user', content: 'x' }], manifest: { task: 'draft' } },
      onDelta() {},
      onAttempt: (type, data) => events.push({ type, data }),
      transport: async function* () {
        n++;
        yield Buffer.from(
          'data: ' +
            JSON.stringify({
              choices: [
                {
                  delta: { content: n === 1 ? '{"x":' : '1}' },
                  finish_reason: n === 1 ? 'length' : 'stop',
                },
              ],
              usage: { prompt_tokens: 3, completion_tokens: 2 },
            }) +
            '\n\ndata: [DONE]\n\n',
        );
      },
    },
  );
  assert.equal(events.filter((e) => e.type === 'started').length, 2);
  assert.ok(
    events[2].data.payload.messages.some((m) => m.role === 'assistant' && m.content === '{"x":'),
  );
  assert.equal(events[1].data.output, '{"x":');
  assert.equal(events[3].data.output, '1}');
  assert.ok(!JSON.stringify(events).includes('DO_NOT_RECORD_KEY'));
});
