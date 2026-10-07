import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTests, assertIsolatedDatabase } from '../../../scripts/test-fs.mjs';

test('discovers nested tests but never e2e or spec files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fs-discovery-'));
  try {
    for (const name of [
      'unit/deep/a.test.mjs',
      'api/b.test.mjs',
      'worker/c.test.mjs',
      'e2e/no.test.mjs',
      'unit/no.spec.ts',
    ]) {
      const path = join(dir, name);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, '');
    }
    assert.equal((await discoverTests(dir)).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('database gate rejects nonlocal hosts and non-test database names', () => {
  for (const url of [
    'postgres://u:p@db.example/sap_fs_test_dev',
    'postgres://u:p@127.0.0.1/sap_delivery',
    'postgres://u:p@127.0.0.1/sap_fs_test_dev?host=remote',
    'invalid',
  ]) {
    assert.throws(() => assertIsolatedDatabase({ DATABASE_URL: url }));
  }
  assert.doesNotThrow(() =>
    assertIsolatedDatabase({ DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/sap_fs_test_dev' }),
  );
  assert.doesNotThrow(() =>
    assertIsolatedDatabase({ POSTGRES_HOST: '127.0.0.1', POSTGRES_DB: 'sap_fs_test_dev' }),
  );
  assert.throws(() =>
    assertIsolatedDatabase({ POSTGRES_HOST: '127.0.0.1', POSTGRES_DB: 'sap_workbench_dev' }),
  );
  assert.throws(() =>
    assertIsolatedDatabase({
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_DB: 'sap_fs_test_dev',
      NODE_ENV: 'production',
    }),
  );
});
