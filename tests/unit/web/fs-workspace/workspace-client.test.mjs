import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
test('workspace client retains an idempotency key after uncertain delivery', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../../../../apps/web/', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  const original = globalThis.fetch;
  try {
    const { createWorkspaceClient } = await vite.ssrLoadModule('/src/features/fs-workspace/api.ts');
    const client = createWorkspaceClient('project', 'item'),
      keys = [];
    let fail = true;
    globalThis.fetch = async (url, options) => {
      keys.push(new Headers(options.headers).get('Idempotency-Key'));
      if (fail) {
        fail = false;
        throw new Error('connection lost');
      }
      return new Response(JSON.stringify({ data: { id: 'saved' }, meta: {} }));
    };
    const body = { base_document_version: 'v', note: '中文' };
    await assert.rejects(client.command('/versions', body, '"ws:w:1"'));
    await client.command('/versions', body, '"ws:w:1"');
    assert.equal(keys[0], keys[1]);
    await client.command('/versions', body, '"ws:w:1"');
    assert.notEqual(keys[1], keys[2]);
  } finally {
    globalThis.fetch = original;
    await vite.close();
  }
});
