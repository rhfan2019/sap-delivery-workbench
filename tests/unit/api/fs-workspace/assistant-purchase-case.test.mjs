import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { requestModelStream } from '../../../../apps/api/src/modules/models/transport.mjs';
import { streamPayload } from '../../../../apps/api/src/modules/agent-runtime/model-stream.mjs';
test('stalled provider stream is bounded by idle timeout and keeps its distinct cause', async () => {
  const old = process.env.LLM_ALLOWED_HOSTS;
  process.env.LLM_ALLOWED_HOSTS = 'stream.example.com';
  let destroyed = false;
  try {
    await assert.rejects(
      async () => {
        for await (const chunk of requestModelStream(
          { protocol: 'openai_chat', baseUrl: 'https://stream.example.com', timeoutSeconds: 2 },
          'fake',
          {},
          {
            idleTimeoutMs: 20,
            resolve: async () => [{ address: '8.8.8.8', family: 4 }],
            request: (_url, options, callback) => {
              const req = new EventEmitter(),
                response = new PassThrough();
              response.statusCode = 200;
              response.headers = { 'content-type': 'text/event-stream' };
              const keepAlive = setTimeout(() => {}, 300);
              response.on('close', () => clearTimeout(keepAlive));
              req.end = () => {
                callback(response);
                response.write(': connected\n\n');
              };
              req.destroy = () => {
                destroyed = true;
                response.destroy();
              };
              options.signal.addEventListener(
                'abort',
                () => response.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })),
                { once: true },
              );
              return req;
            },
          },
        ))
          assert.ok(chunk);
      },
      (e) => e.code === 'STREAM_IDLE_TIMEOUT',
    );
    assert.equal(destroyed, true);
  } finally {
    if (old === undefined) delete process.env.LLM_ALLOWED_HOSTS;
    else process.env.LLM_ALLOWED_HOSTS = old;
  }
});
test('Qwen Flash interactive payload requests direct answers without changing unrelated providers', () => {
  const config = {
    protocol: 'openai_chat',
    provider: 'QianWen',
    modelId: 'qwen3.8-flash',
    maxOutputTokens: 8192,
  };
  assert.equal(streamPayload(config, 'hello').enable_thinking, false);
  assert.equal(
    streamPayload({ ...config, provider: 'Other', modelId: 'other-model' }, 'hello')
      .enable_thinking,
    undefined,
  );
  assert.equal(
    streamPayload({ ...config, protocol: 'anthropic_messages' }, 'hello').enable_thinking,
    undefined,
  );
});
test('idle timeout after SSE headers preserves its cause instead of socket ECONNRESET', async () => {
  let reachedHeaders = false;
  const old = process.env.LLM_ALLOWED_HOSTS;
  process.env.LLM_ALLOWED_HOSTS = 'stream.example.com';
  try {
    await assert.rejects(
      async () => {
        for await (const c of requestModelStream(
          {
            protocol: 'openai_chat',
            baseUrl: 'https://stream.example.com/v1',
          },
          'test-key',
          { stream: true },
          {
            idleTimeoutMs: 20,
            resolve: async () => [{ address: '8.8.8.8', family: 4 }],
            request: (url, options, callback) => {
              reachedHeaders = true;
              const req = new EventEmitter();
              const response = new PassThrough();
              const keepAlive = setTimeout(() => {}, 100);
              response.on('close', () => clearTimeout(keepAlive));
              response.statusCode = 200;
              response.headers = { 'content-type': 'text/event-stream' };
              req.end = () => {
                callback(response);
                response.write(': pending\n\n');
              };
              req.destroy = () => {
                response.destroy();
              };
              options.signal.addEventListener(
                'abort',
                () => response.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })),
                { once: true },
              );
              return req;
            },
          },
        )) {
          assert.ok(c);
        }
      },
      (e) => e.code === 'STREAM_IDLE_TIMEOUT',
    );
    assert.equal(reachedHeaders, true, 'must test abort after headers, not DNS timeout');
  } finally {
    if (old === undefined) delete process.env.LLM_ALLOWED_HOSTS;
    else process.env.LLM_ALLOWED_HOSTS = old;
  }
});
