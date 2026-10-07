import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve, relative } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

export async function discoverTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'e2e') files.push(...(await discoverTests(path)));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(path);
  }
  return files.sort();
}

export function assertIsolatedDatabase(env) {
  if (env.NODE_ENV === 'production') throw new Error('FS tests refuse production mode');
  const check = (host, name) => {
    if (
      !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) ||
      !/^sap_fs_test_(?:[a-z0-9_]+_)?dev$/.test(name ?? '')
    ) {
      throw new Error('FS tests require a loopback database named sap_fs_test_*dev');
    }
  };
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash)
      throw new Error('Unsafe database URL');
    check(url.hostname, decodeURIComponent(url.pathname.slice(1)));
  }
  if (env.POSTGRES_HOST || !env.DATABASE_URL) check(env.POSTGRES_HOST, env.POSTGRES_DB);
  for (const name of ['PGHOST', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) {
    if (env[name]) throw new Error('Implicit PostgreSQL connection overrides are forbidden');
  }
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--unit', '--list'].includes(arg)))
    throw new Error('Supported options: --unit, --list');
  const directory = join(root, 'tests/fs-workspace', args.includes('--unit') ? 'unit' : '');
  const files = await discoverTests(directory);
  if (!files.length) throw new Error('No FS tests found');
  console.log(files.map((file) => relative(root, file)).join('\n'));
  if (args.includes('--list')) return;
  let env = { ...process.env };
  if (files.some((file) => !relative(join(root, 'tests/fs-workspace'), file).startsWith('unit'))) {
    // Never fall back to the primary .env or inherited database credentials.
    const isolated = parseEnv(await readFile(join(root, '.runtime/fs-tests.env'), 'utf8'));
    assertIsolatedDatabase(isolated);
    for (const key of Object.keys(env))
      if (/^(POSTGRES_|APP_DB_|DATABASE_URL$|PG|NODE_ENV$)/.test(key)) delete env[key];
    env = { ...env, ...isolated, NODE_ENV: 'test' };
  } else {
    for (const key of Object.keys(env))
      if (/^(POSTGRES_|APP_DB_|DATABASE_URL$|PG)/.test(key)) delete env[key];
    env.NODE_ENV = 'test';
  }
  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      error.code === 'ENOENT'
        ? 'Missing .runtime/fs-tests.env or FS test directory; no primary .env fallback.'
        : error.message,
    );
    process.exitCode = 1;
  });
}
