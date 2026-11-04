import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { migrationNames, sourceHash } from '../../../scripts/database/init-sql-source.mjs';

const script = await readFile(
  new URL('../../../database/init/init-database.sql', import.meta.url),
  'utf8',
);

test('the database init script follows the migrations and grants', () => {
  assert.ok(
    script.includes('-- Source hash: ' + sourceHash()),
    'Migrations or provision.mjs changed: run npm run test:setup, then npm run db:export-init.',
  );
  let position = 0;
  for (const name of migrationNames()) {
    position = script.indexOf(`'${name}'`, position);
    assert.ok(position > 0, name + ' is missing from the migration history');
  }
});

test('the database init script is safe to hand to a server', () => {
  assert.match(script, /^BEGIN;$/m);
  assert.match(script, /^COMMIT;\s*$/m);
  assert.match(script, /RAISE EXCEPTION/);
  // Works with any client, and carries no password or account.
  assert.doesNotMatch(script, /^\\/m);
  assert.doesNotMatch(script, /\bPASSWORD\s+'/i);
  assert.doesNotMatch(script, /INSERT INTO app\./);
});
