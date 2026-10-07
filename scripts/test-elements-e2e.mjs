import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { assertIsolatedDatabase } from './test-fs.mjs';
const isolated = parseEnv(await readFile('.runtime/fs-tests.env', 'utf8'));
assertIsolatedDatabase(isolated);
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(POSTGRES_|APP_DB_|DATABASE_URL$|PG|NODE_ENV$)/.test(key)) delete env[key];
const result = spawnSync(process.execPath, [process.argv[2], ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: { ...env, ...isolated, NODE_ENV: 'test' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
