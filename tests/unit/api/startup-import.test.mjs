import assert from 'node:assert/strict';
import test from 'node:test';

test('startup can load the API and its runtime contracts without connecting to the database', async () => {
  const { createApp } = await import('../../../apps/api/src/app.mjs');
  assert.equal(typeof createApp, 'function');
});
