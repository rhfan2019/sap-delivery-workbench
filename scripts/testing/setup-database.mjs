import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { postgresTool } from '../database/postgres-tools.mjs';
import { assertIsolatedDatabase } from './run-tests.mjs';

// The isolated test database is its own native PostgreSQL cluster under .runtime, not a database on
// the development server: roles are server-wide, and provisioning the test database would otherwise
// overwrite the password the development API logs in with.
const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = join(root, '.runtime');
const cluster = join(runtime, 'fs-test-pg');
process.chdir(root);

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Test setup failed: ${command} (${result.status})`);
}

const running = () => spawnSync(postgresTool('pg_ctl'), ['-D', cluster, 'status']).status === 0;

if (process.argv.includes('--stop')) {
  if (existsSync(cluster) && running())
    run(postgresTool('pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop']);
  console.log('Isolated test database stopped. Its data is kept.');
} else {
  run(process.execPath, ['scripts/testing/setup-fs-tests.mjs']);
  const isolated = parseEnv(await readFile('.runtime/fs-tests.env', 'utf8'));
  assertIsolatedDatabase(isolated);
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(POSTGRES_|APP_DB_|DATABASE_URL$|PG|NODE_ENV$)/.test(key)) delete env[key];
  // On macOS the postmaster refuses to start under an invalid locale inherited from the shell.
  env.LC_ALL = 'C';
  if (!existsSync(join(cluster, 'PG_VERSION'))) {
    const passwordFile = join(runtime, 'fs-test-pg.password');
    await writeFile(passwordFile, isolated.POSTGRES_PASSWORD, { mode: 0o600 });
    try {
      run(
        postgresTool('initdb'),
        [
          '-D',
          cluster,
          '-U',
          isolated.POSTGRES_USER,
          `--pwfile=${passwordFile}`,
          '--auth=scram-sha-256',
          '--encoding=UTF8',
          '--locale-provider=icu',
          '--icu-locale=en-US',
          '--locale=C',
        ],
        env,
      );
    } finally {
      await rm(passwordFile, { force: true });
    }
    await appendFile(
      join(cluster, 'postgresql.conf'),
      [
        '',
        `port = ${isolated.POSTGRES_PORT}`,
        "listen_addresses = '127.0.0.1'",
        "unix_socket_directories = ''",
        "timezone = 'UTC'",
        '',
      ].join('\n'),
    );
  }
  if (!running())
    run(
      postgresTool('pg_ctl'),
      ['-D', cluster, '-l', join(runtime, 'fs-test-pg.log'), '-w', 'start'],
      env,
    );
  const admin = new pg.Client({
    host: isolated.POSTGRES_HOST,
    port: Number(isolated.POSTGRES_PORT),
    database: 'postgres',
    user: isolated.POSTGRES_USER,
    password: isolated.POSTGRES_PASSWORD,
  });
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
      isolated.POSTGRES_DB,
    ]);
    if (!found.rowCount)
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(isolated.POSTGRES_DB)}`);
  } finally {
    await admin.end();
  }
  Object.assign(env, isolated, { NODE_ENV: 'test' });
  run(process.execPath, ['scripts/database/migrate.mjs'], env);
  run(process.execPath, ['scripts/database/provision.mjs'], env);
  console.log('Isolated test database ready. Primary application database unchanged.');
}
