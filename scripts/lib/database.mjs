import pg from 'pg';
import { readFileSync } from 'node:fs';

export function databaseConfig({ runtime = false } = {}) {
  const required = [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
    runtime ? 'APP_DB_USER' : 'POSTGRES_USER',
    runtime ? 'APP_DB_PASSWORD' : 'POSTGRES_PASSWORD',
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error('Missing environment variable: ' + key);
  }
  const port = Number(process.env.POSTGRES_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT must be a valid TCP port.');
  }
  const production = process.env.NODE_ENV === 'production';
  if (!production && !['127.0.0.1', 'localhost', '::1'].includes(process.env.POSTGRES_HOST)) {
    throw new Error('Development scripts require a loopback database host.');
  }
  if (!production && !process.env.POSTGRES_DB.endsWith('_dev')) {
    throw new Error('Development scripts require a database name ending in _dev.');
  }
  let ssl;
  if (production) {
    if (!['verify-full', 'disable'].includes(process.env.POSTGRES_SSL_MODE))
      throw new Error('Production requires explicit POSTGRES_SSL_MODE: verify-full or disable.');
    if (process.env.POSTGRES_SSL_MODE === 'verify-full')
      ssl = {
        rejectUnauthorized: true,
        ...(process.env.POSTGRES_SSL_CA_FILE
          ? { ca: readFileSync(process.env.POSTGRES_SSL_CA_FILE, 'utf8') }
          : {}),
      };
    else if (process.env.POSTGRES_HOST !== 'postgres')
      throw new Error(
        'Unencrypted production database is restricted to the private Compose postgres service.',
      );
  }
  return {
    ssl,
    host: process.env.POSTGRES_HOST,
    port,
    database: process.env.POSTGRES_DB,
    user: process.env[runtime ? 'APP_DB_USER' : 'POSTGRES_USER'],
    password: process.env[runtime ? 'APP_DB_PASSWORD' : 'POSTGRES_PASSWORD'],
    connectionTimeoutMillis: 5000,
    application_name: 'sap-delivery-workbench-tooling',
    options: '-c timezone=UTC',
  };
}

export async function connectDatabase(options) {
  const client = new pg.Client(databaseConfig(options));
  await client.connect();
  return client;
}
