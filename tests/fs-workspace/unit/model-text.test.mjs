import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../../../apps/api/src/models/text.mjs';
test('text generation sends the supplied question and returns provider text for all configured protocols', async () => {
  for (const protocol of ['openai_chat', 'openai_responses', 'anthropic_messages']) {
    const result = await generateText(
      { protocol, modelId: 'configured-model', temperature: null, maxOutputTokens: 1000 },
      'secret',
      '你好，请问你的模型是什么？',
      async (config, key, payload) => {
        assert.equal(key, 'secret');
        assert.equal(payload.model, 'configured-model');
        assert.equal(
          protocol === 'openai_responses' ? payload.input : payload.messages[0].content,
          '你好，请问你的模型是什么？',
        );
        return {
          status: 200,
          data:
            protocol === 'openai_chat'
              ? { choices: [{ finish_reason: 'stop', message: { content: '真实返回文本' } }] }
              : protocol === 'openai_responses'
                ? {
                    status: 'completed',
                    output: [
                      { type: 'message', content: [{ type: 'output_text', text: '真实返回文本' }] },
                    ],
                  }
                : { stop_reason: 'end_turn', content: [{ type: 'text', text: '真实返回文本' }] },
        };
      },
    );
    assert.equal(result.text, '真实返回文本');
  }
});
test('provider errors and incomplete results are safe failures', async () => {
  const config = {
    protocol: 'openai_chat',
    modelId: 'configured',
    temperature: null,
    maxOutputTokens: 1000,
  };
  await assert.rejects(
    generateText(config, 'secret', 'hello', async () => ({
      status: 401,
      data: { error: 'secret' },
    })),
    (e) => e.statusCode === 502 && !e.message.includes('secret'),
  );
  await assert.rejects(
    generateText(config, 'secret', 'hello', async () => ({
      status: 200,
      data: { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
    })),
    /截断/,
  );
});
