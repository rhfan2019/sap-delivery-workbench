import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ensureRuntimeRole } from '../../../scripts/database/runtime-role.mjs';

function fakeClient(roleExists) {
  const statements = [];
  return {
    statements,
    async query(text) {
      statements.push(text);
      return { rowCount: roleExists ? 1 : 0 };
    },
  };
}

test('the runtime role is created without a login only when it is missing', async () => {
  const empty = fakeClient(false);
  await ensureRuntimeRole(empty);
  assert.equal(empty.statements.at(-1), 'CREATE ROLE sap_workbench_app NOLOGIN');
  const existing = fakeClient(true);
  await ensureRuntimeRole(existing);
  assert.equal(existing.statements.length, 1);
});

test('an empty database gets the runtime role before the first migration', async () => {
  const source = await readFile(
    new URL('../../../scripts/database/migrate.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(source.indexOf('await ensureRuntimeRole') > 0);
  assert.ok(source.indexOf('await ensureRuntimeRole') < source.indexOf('await runner('));
});
