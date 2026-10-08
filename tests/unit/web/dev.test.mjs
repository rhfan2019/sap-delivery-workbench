import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('development URL uses the same loopback origin as authentication', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../../../apps/web/', import.meta.url)),
    server: { port: 0, strictPort: false },
  });
  try {
    await server.listen();
    assert.ok(server.resolvedUrls.local.every((url) => url.startsWith('http://127.0.0.1:')));
  } finally {
    await server.close();
  }
});
