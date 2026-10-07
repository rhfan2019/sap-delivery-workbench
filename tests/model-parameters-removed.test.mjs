import test from 'node:test';
import assert from 'node:assert/strict';
import { modelInput } from '../apps/api/src/models/validation.mjs';
import { probePayload } from '../apps/api/src/models/transport.mjs';
import { structuredPayload } from '../apps/api/src/models/inference.mjs';
import { streamPayload } from '../apps/api/src/abap-fsd-agent/model-stream.mjs';
import { generateText } from '../apps/api/src/models/text.mjs';
import { requestModel, requestModelStream } from '../apps/api/src/models/transport.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const base = {
  name: 'test',
  provider: 'test',
  protocol: 'openai_chat',
  baseUrl: 'https://api.example.com/v1',
  modelId: 'test',
  maxOutputTokens: 1,
  timeoutSeconds: 1,
  temperature: 0,
};
const absent = (payload) => {
  for (const key of ['max_tokens', 'max_output_tokens', 'max_completion_tokens', 'temperature'])
    assert.equal(Object.hasOwn(payload, key), false, key);
};
test('model persistence accepts only connection fields and discards removed legacy parameters', () => {
  assert.deepEqual(
    Object.keys(modelInput(base)).sort(),
    ['name', 'provider', 'protocol', 'baseUrl', 'modelId'].sort(),
  );
});

test('Anthropic buffered and streaming requests use provider-reported maximum', async () => {
  const old = process.env.LLM_ALLOWED_HOSTS;
  process.env.LLM_ALLOWED_HOSTS = 'api.example.com';
  try {
    for (const streaming of [false, true]) {
      const calls = [];
      const options = {
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        request: (url, opts, callback) => {
          const req = new EventEmitter();
          req.destroy = () => {};
          req.end = (bytes) => {
            calls.push({
              path: url.pathname,
              method: opts.method,
              payload: bytes.length ? JSON.parse(bytes) : null,
            });
            const res = new PassThrough();
            res.statusCode = 200;
            res.headers = {
              'content-type':
                streaming && opts.method === 'POST' ? 'text/event-stream' : 'application/json',
            };
            callback(res);
            res.end(
              opts.method === 'GET'
                ? JSON.stringify({ id: 'claude-test', max_tokens: 128000 })
                : streaming
                  ? 'data: [DONE]\n\n'
                  : JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
            );
          };
          return req;
        },
      };
      const c = { ...base, protocol: 'anthropic_messages', modelId: 'claude-test' };
      if (streaming) {
        for await (const chunk of requestModelStream(c, 'fake', streamPayload(c, 'hello'), options))
          assert.ok(chunk.length);
      } else await requestModel(c, 'fake', probePayload(c), options);
      assert.equal(calls[0].method, 'GET');
      assert.equal(calls[0].path, '/v1/models/claude-test');
      assert.equal(calls[1].payload.max_tokens, 128000);
      assert.equal(Object.hasOwn(calls[1].payload, 'temperature'), false);
    }
  } finally {
    if (old === undefined) delete process.env.LLM_ALLOWED_HOSTS;
    else process.env.LLM_ALLOWED_HOSTS = old;
  }
});
test('probe, dialogue, structured and text requests omit optional generation controls', async () => {
  for (const protocol of ['openai_chat', 'openai_responses']) {
    const c = { ...base, protocol };
    absent(probePayload(c));
    absent(streamPayload(c, 'hello'));
    absent(structuredPayload(c, {}, 'policy', 'input'));
    await generateText(c, 'fake', 'hello', async (_c, _k, payload) => {
      absent(payload);
      return {
        status: 200,
        data:
          protocol === 'openai_chat'
            ? { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }
            : {
                status: 'completed',
                output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
              },
      };
    });
  }
});
