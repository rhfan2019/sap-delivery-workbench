import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('HTTP client preserves old signature and passes concurrency headers and cancellation', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../../../apps/web/', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  const original = globalThis.fetch;
  try {
    const { api, ApiError } = await vite.ssrLoadModule('/src/services/session.ts');
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await api('/old', { value: 1 }, 'PATCH');
    const controller = new AbortController();
    await api('/new', { value: 2 }, 'POST', {
      headers: { 'If-Match': '"ws:1:1"' },
      signal: controller.signal,
    });
    assert.equal(calls[0].options.method, 'PATCH');
    assert.equal(new Headers(calls[1].options.headers).get('If-Match'), '"ws:1:1"');
    assert.equal(calls[1].options.signal, controller.signal);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 'VERSION_CONFLICT', message: '过期', details: [] }), {
        status: 409,
      });
    await assert.rejects(
      api('/new'),
      (error) =>
        error instanceof ApiError &&
        error.code === 'VERSION_CONFLICT' &&
        Array.isArray(error.details),
    );
    globalThis.fetch = async () => {
      throw new DOMException('Aborted', 'AbortError');
    };
    await assert.rejects(
      api('/new', undefined, undefined, { signal: controller.signal }),
      (error) => error.name === 'AbortError',
    );
  } finally {
    globalThis.fetch = original;
    await vite.close();
  }
});
