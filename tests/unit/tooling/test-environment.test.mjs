import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('test environment setup confines secrets to runtime and preserves existing configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-env-'));
  try {
    await mkdir(join(root, 'scripts/testing'), { recursive: true });
    const script = join(root, 'scripts/testing/setup-fs-tests.mjs');
    await copyFile(new URL('../../../scripts/testing/setup-fs-tests.mjs', import.meta.url), script);
    await writeFile(join(root, '.env'), 'DO_NOT_CHANGE=primary');
    const run = () => assert.equal(spawnSync(process.execPath, [script], { cwd: root }).status, 0);
    run();
    assert.equal((await readdir(root)).includes('fs-tests.env'), false);
    const first = await readFile(join(root, '.runtime/fs-tests.env'), 'utf8');
    run();
    assert.equal(await readFile(join(root, '.runtime/fs-tests.env'), 'utf8'), first);
    assert.equal(await readFile(join(root, '.env'), 'utf8'), 'DO_NOT_CHANGE=primary');
    assert.match(first, /POSTGRES_DB=sap_fs_test_dev/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
