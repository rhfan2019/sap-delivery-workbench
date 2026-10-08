import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
test('production startup validates canonical origin and credential keys', async () => {
  const file = new URL('../../../apps/api/src/platform/production.mjs', import.meta.url);
  assert.ok(existsSync(file), 'production startup validation must exist');
  const { validateProduction } = await import(file);
  const valid = {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://workbench.example.com',
    SAP_CREDENTIAL_KEY: 'a'.repeat(64),
    LLM_CREDENTIAL_KEY: 'b'.repeat(64),
  };
  assert.doesNotThrow(() => validateProduction(valid));
  for (const APP_ORIGIN of [
    'http://workbench.example.com',
    'https://x.example/path',
    'https://user:secret@x.example',
    'https://x.example?key=a',
  ])
    assert.throws(() => validateProduction({ ...valid, APP_ORIGIN }));
  assert.throws(() => validateProduction({ ...valid, LLM_CREDENTIAL_KEY: '' }));
  assert.throws(() => validateProduction({ ...valid, SAP_CREDENTIAL_KEY: 'a' }));
});
