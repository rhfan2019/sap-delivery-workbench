import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { databaseConfig } from '@sap-delivery-workbench/api/platform/database';

// Development only: makes the local PostgreSQL service hold this project's role and database.
// Safe to repeat; an existing role, password or database is never changed.
if (process.env.NODE_ENV === 'production') throw new Error('db:setup is for development only.');
const config = databaseConfig();

async function connectionError(settings) {
  const client = new pg.Client(settings);
  try {
    await client.connect();
    return null;
  } catch (error) {
    return error;
  } finally {
    await client.end().catch(() => {});
  }
}

function startService() {
  if (process.platform !== 'darwin') return;
  const started = spawnSync('brew', ['services', 'start', 'postgresql@17'], { stdio: 'inherit' });
  if (started.error) console.warn('Homebrew is not available to start PostgreSQL.');
}

async function reachedServer() {
  let error = await connectionError(config);
  if (error?.code !== 'ECONNREFUSED') return error;
  startService();
  for (let attempt = 0; attempt < 30 && error?.code === 'ECONNREFUSED'; attempt++) {
    await delay(1000);
    error = await connectionError(config);
  }
  if (error?.code === 'ECONNREFUSED')
    throw new Error(
      `PostgreSQL is not running on ${config.host}:${config.port}. Install PostgreSQL 17 and start ` +
        'its service (macOS: brew install postgresql@17; Windows: the official installer).',
    );
  return error;
}

const missing = await reachedServer();
if (!missing) {
  console.log(`Database ${config.database} is ready.`);
} else {
  // 28000: no such role; 28P01: password rejected; 3D000: no such database.
  if (!['28000', '28P01', '3D000'].includes(missing.code)) throw missing;
  const admin = new pg.Client({
    host: config.host,
    port: config.port,
    database: process.env.POSTGRES_ADMIN_DB || 'postgres',
    user:
      process.env.POSTGRES_ADMIN_USER ||
      (process.platform === 'win32' ? 'postgres' : userInfo().username),
    password: process.env.POSTGRES_ADMIN_PASSWORD || undefined,
    connectionTimeoutMillis: 5000,
  });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Cannot create the project database as PostgreSQL administrator (${error.code ?? error.message}). ` +
        'Set POSTGRES_ADMIN_USER and POSTGRES_ADMIN_PASSWORD in .env, then run this again.',
    );
  }
  try {
    const owner = admin.escapeIdentifier(config.user);
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [config.user]);
    // Provisioning sets role attributes and PostgreSQL leaves those to superusers.
    if (!role.rowCount)
      await admin.query(
        `CREATE ROLE ${owner} LOGIN SUPERUSER PASSWORD ${admin.escapeLiteral(config.password)}`,
      );
    const database = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [
      config.database,
    ]);
    if (!database.rowCount) {
      const name = admin.escapeIdentifier(config.database);
      // ICU gives the same sort order on every operating system, unlike OS locale names.
      await admin.query(
        `CREATE DATABASE ${name} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8' ` +
          `LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C'`,
      );
      await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
    }
  } finally {
    await admin.end();
  }
  const remaining = await connectionError(config);
  if (remaining)
    throw new Error(
      `Database ${config.database} exists but rejects the POSTGRES_USER and POSTGRES_PASSWORD in ` +
        `.env (${remaining.code ?? remaining.message}).`,
    );
  console.log(`Created database ${config.database} on ${config.host}:${config.port}.`);
}
