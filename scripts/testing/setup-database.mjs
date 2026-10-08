import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertIsolatedDatabase } from './run-tests.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Test setup failed: ${command} (${result.status})`);
}
run(process.execPath, ['scripts/testing/setup-fs-tests.mjs']);
const isolated = parseEnv(await readFile('.runtime/fs-tests.env', 'utf8'));
assertIsolatedDatabase(isolated);
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(POSTGRES_|APP_DB_|DATABASE_URL$|PG|NODE_ENV$)/.test(key)) delete env[key];
Object.assign(env, isolated, { NODE_ENV: 'test' });
run(
  'docker',
  ['compose', '-f', '.runtime/fs-tests.compose.yaml', 'up', '-d', '--wait', 'postgres'],
  env,
);
run(process.execPath, ['scripts/database/migrate.mjs'], env);
run(process.execPath, ['scripts/database/provision.mjs'], env);
console.log('Isolated test database ready. Primary application database unchanged.');
