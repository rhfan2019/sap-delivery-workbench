import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open } from '../../../apps/api/src/modules/sap/crypto.mjs';
import {
  binding,
  credentialFor,
  forgetForSession,
  maySave,
  rememberForSession,
  DEFAULT_POLICY,
} from '../../../apps/api/src/modules/sap/credentials.mjs';
import { systemInput, credentialInput } from '../../../apps/api/src/modules/sap/validation.mjs';

const key = 'a'.repeat(64);
const system = { id: 's1', projectId: 'p', sapUrl: 'https://one.invalid', client: '100' };
// A database with no saved credentials.
const empty = { query: async () => ({ rows: [], rowCount: 0 }) };

test('AES-GCM hides secrets and rejects altered ciphertext, context and key', () => {
  const encrypted = seal('secret-password', 'user/system/DEV', key);
  assert.ok(!encrypted.includes('secret-password'));
  assert.equal(open(encrypted, 'user/system/DEV', key), 'secret-password');
  assert.throws(() => open(encrypted, 'other/system/DEV', key));
  assert.throws(() => open(encrypted, 'user/system/DEV', 'b'.repeat(64)));
});

test('a credential is bound to the system address, client and SAP user', () => {
  const b = binding(system, 'DEV01');
  assert.notEqual(binding({ ...system, client: '200' }, 'DEV01'), b);
  assert.notEqual(binding({ ...system, sapUrl: 'https://moved.invalid' }, 'DEV01'), b);
  assert.notEqual(binding(system, 'DEV02'), b);
  assert.equal(binding({ ...system }, 'DEV01'), b);
});

test('this-login credentials belong to one login, one person and one system, and expire', async () => {
  const actor = { userId: 'u1', sessionId: 'login-1' };
  rememberForSession('login-1', 'u1', system, 'DEV01', 'secret');
  const found = await credentialFor(empty, 'o', actor, system, DEFAULT_POLICY);
  assert.deepEqual([found.username, found.password, found.source], ['DEV01', 'secret', 'session']);
  assert.equal(
    await credentialFor(empty, 'o', { ...actor, sessionId: 'login-2' }, system, DEFAULT_POLICY),
    null,
  );
  assert.equal(
    await credentialFor(empty, 'o', { ...actor, userId: 'u2' }, system, DEFAULT_POLICY),
    null,
  );
  // A changed client invalidates the remembered credential.
  assert.equal(
    await credentialFor(empty, 'o', actor, { ...system, client: '200' }, DEFAULT_POLICY),
    null,
  );
  rememberForSession('login-1', 'u1', system, 'DEV01', 'secret', Date.now() - 9 * 3600 * 1000);
  assert.equal(await credentialFor(empty, 'o', actor, system, DEFAULT_POLICY), null);
  rememberForSession('login-1', 'u1', system, 'DEV01', 'secret');
  forgetForSession('login-1', 's1');
  assert.equal(await credentialFor(empty, 'o', actor, system, DEFAULT_POLICY), null);
});

test('the policy decides who may save passwords', () => {
  assert.equal(maySave(DEFAULT_POLICY, 'employee'), true);
  assert.equal(maySave(DEFAULT_POLICY, 'subcontractor'), false);
  assert.equal(maySave({ ...DEFAULT_POLICY, subcontractorSave: true }, 'subcontractor'), true);
  assert.equal(maySave({ ...DEFAULT_POLICY, allowSave: false }, 'employee'), false);
});

test('a project system never carries credentials and is development or test only', () => {
  const input = systemInput({
    name: 'S/4 开发',
    purpose: 'development',
    sid: 's4d',
    sapUrl: 'https://sap.example:44300',
    client: '100',
    username: 'IGNORED',
    password: 'IGNORED',
  });
  assert.deepEqual(Object.keys(input).sort(), [
    'client',
    'description',
    'language',
    'name',
    'purpose',
    'sapUrl',
    'sid',
    'status',
  ]);
  assert.equal(input.sid, 'S4D');
  assert.throws(() => systemInput({ ...input, purpose: 'production' }));
  assert.throws(() => systemInput({ ...input, sid: 'S4' }));
  assert.throws(() => systemInput({ ...input, client: '1000' }));
  assert.throws(() => credentialInput({ username: 'X', password: '' }));
  assert.equal(credentialInput({ username: 'X', password: 'p' }).mode, 'saved');
});
