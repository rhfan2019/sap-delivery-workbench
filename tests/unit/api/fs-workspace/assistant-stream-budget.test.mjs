import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { streamText } from '../../../../apps/api/src/modules/agent-runtime/model-stream.mjs';
import { requestModelStream } from '../../../../apps/api/src/modules/models/transport.mjs';
import { classifyFailure } from '../../../../apps/api/src/modules/agent-runtime/errors.mjs';

const frame = (data) => Buffer.from(`data: ${JSON.stringify(data)}\n\n`);
const config = {
  protocol: 'openai_chat',
  baseUrl: 'https://stream.example.com/v1',
  modelId: 'reasoning-model',
  timeoutSeconds: 0.04,
  maxOutputTokens: 8192,
};

test('active reasoning survives the connection budget without a hidden total deadline', async (t) => {
  t.mock.method(AbortSignal, 'timeout', () => {
    throw Error('Streaming must not create a total deadline');
  });
  const previous = process.env.LLM_ALLOWED_HOSTS;
  process.env.LLM_ALLOWED_HOSTS = 'stream.example.com';
  let text = '',
    closed = false;
  const progress = [];
  try {
    const result = await streamText(config, 'fake', 'request', {
      onDelta: (delta) => {
        text += delta;
      },
      onProgress: (value) => progress.push(value),
      transport: (c, key, payload, options) =>
        requestModelStream(c, key, payload, {
          ...options,
          connectionTimeoutMs: 40,
          resolve: async () => [{ address: '8.8.8.8', family: 4 }],
          request: (_url, options, callback) => {
            const req = new EventEmitter(),
              response = new PassThrough();
            response.statusCode = 200;
            response.headers = { 'content-type': 'text/event-stream' };
            const timer = setTimeout(() => {
              response.end(
                Buffer.concat([
                  frame({ choices: [{ delta: { content: '完成' }, finish_reason: 'stop' }] }),
                  Buffer.from('data: [DONE]\n\n'),
                ]),
              );
            }, 100);
            req.end = () => {
              callback(response);
              response.write(
                frame({ choices: [{ delta: { reasoning_content: 'private reasoning' } }] }),
              );
            };
            req.destroy = () => {
              closed = true;
              clearTimeout(timer);
              response.destroy();
            };
            options.signal.addEventListener(
              'abort',
              () => response.destroy(options.signal.reason),
              { once: true },
            );
            return req;
          },
        }),
    });
    assert.equal(text, '完成');
    assert.equal(result.diagnostics.reasoningCharacters, 17);
    assert.equal(progress[0].phase, 'reasoning');
    assert.equal(progress[0].reasoningCharacters, 17);
    assert.ok(!JSON.stringify(progress).includes('private reasoning'));
    assert.equal(closed, true);
  } finally {
    if (previous === undefined) delete process.env.LLM_ALLOWED_HOSTS;
    else process.env.LLM_ALLOWED_HOSTS = previous;
  }
});

test('a terminal SSE marker completes without waiting for supplier TCP close', async () => {
  let advanced = false;
  await streamText(config, 'fake', 'request', {
    onDelta() {},
    transport: async function* () {
      yield Buffer.concat([
        frame({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }),
        Buffer.from('data: [DONE]\n\n'),
      ]);
      advanced = true;
      throw Error('supplier kept socket open');
    },
  });
  assert.equal(advanced, false);
});

test('external timeout is reported without inventing a generation budget', async () => {
  await assert.rejects(
    streamText(config, 'fake', 'request', {
      onDelta() {},
      transport: async function* () {
        yield frame({ choices: [{ delta: { reasoning_content: 'thinking' } }] });
        throw new DOMException('deadline', 'TimeoutError');
      },
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_TIMEOUT');
      assert.equal(classifyFailure(error, 'generate').code, 'MODEL_TIMEOUT');
      return true;
    },
  );
});

test('connection budget includes a DNS lookup that never returns', async () => {
  const previous = process.env.LLM_ALLOWED_HOSTS;
  process.env.LLM_ALLOWED_HOSTS = 'stream.example.com';
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await assert.rejects(
      async () => {
        for await (const chunk of requestModelStream(
          config,
          'fake',
          {},
          {
            connectionTimeoutMs: 40,
            resolve: () => new Promise(() => {}),
            request: () => {
              throw Error('DNS must finish first');
            },
          },
        ))
          assert.fail(String(chunk));
      },
      (error) => error.code === 'MODEL_TIMEOUT',
    );
  } finally {
    clearTimeout(keepAlive);
    if (previous === undefined) delete process.env.LLM_ALLOWED_HOSTS;
    else process.env.LLM_ALLOWED_HOSTS = previous;
  }
});
