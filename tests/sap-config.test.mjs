import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open } from '../apps/api/src/sap/crypto.mjs';
import { resolveLayers, binding, publicConfig } from '../apps/api/src/sap/resolve.mjs';
const key = 'a'.repeat(64);
const systems = [
  { id: 's1', sapUrl: 'https://one.invalid', language: 'EN' },
  { id: 's2', sapUrl: 'https://two.invalid', language: 'ZH' },
];
const base = {
  systemId: 's1',
  client: '000',
  username: 'DEVELOPER',
  language: null,
  passwordMode: 'override',
  passwordCipher: 'cipher',
  credentialContext: 'context',
};
base.credentialBinding = binding({ ...base, sapUrl: systems[0].sapUrl });
test('AES-GCM hides secrets and rejects altered ciphertext, context and key', () => {
  const encrypted = seal('secret-password', 'org/project/DEV', key);
  assert.ok(!encrypted.includes('secret-password'));
  assert.equal(open(encrypted, 'org/project/DEV', key), 'secret-password');
  assert.throws(() => open(encrypted, 'other/project/DEV', key));
  assert.throws(() => open(encrypted, 'org/project/DEV', 'b'.repeat(64)));
});
test('project defaults, personal overrides, temporary overrides resolve in order', () => {
  const config = resolveLayers(systems, base, { language: 'ZH' }, { language: 'DE' });
  assert.equal(config.client, '000');
  assert.equal(config.language, 'DE');
  assert.equal(config.passwordCipher, 'cipher');
  assert.equal(config.sources.language, 'temporary');
  assert.equal(publicConfig(config).hasPassword, true);
  assert.ok(!JSON.stringify(publicConfig(config)).includes('cipher'));
});
test('system switch resets inherited identity and uses new system language', () => {
  const config = resolveLayers(systems, base, { systemId: 's2' }, null);
  assert.equal(config.client, null);
  assert.equal(config.username, null);
  assert.equal(config.passwordCipher, null);
  assert.equal(config.language, 'ZH');
});
test('Client or username change and system URL change invalidate old password', () => {
  for (const delta of [{ client: '100' }, { username: 'OTHER' }])
    assert.equal(resolveLayers(systems, base, delta).passwordCipher, null);
  assert.equal(
    resolveLayers([{ ...systems[0], sapUrl: 'https://moved.invalid' }], base).passwordCipher,
    null,
  );
});
test('explicit none blocks password inheritance and one-time password is never public', () => {
  assert.equal(resolveLayers(systems, base, { passwordMode: 'none' }).passwordCipher, null);
  const result = resolveLayers(systems, base, null, {
    passwordMode: 'override',
    password: 'one-time',
  });
  assert.equal(result.password, 'one-time');
  assert.ok(!JSON.stringify(publicConfig(result)).includes('one-time'));
});
