import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig } from '../scripts/lib/database.mjs';

test('production database policy preserves development guardrails and verifies remote TLS', () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      POSTGRES_HOST: 'remote.example.com',
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'production',
      POSTGRES_USER: 'owner',
      POSTGRES_PASSWORD: 'test',
      APP_DB_USER: 'runtime',
      APP_DB_PASSWORD: 'runtime-test',
      NODE_ENV: 'development',
    });
    assert.throws(() => databaseConfig(), /loopback/);
    process.env.POSTGRES_HOST = '127.0.0.1';
    assert.throws(() => databaseConfig(), /_dev/);
    process.env.NODE_ENV = 'production';
    delete process.env.POSTGRES_SSL_MODE;
    assert.throws(() => databaseConfig(), /explicit/);
    process.env.POSTGRES_HOST = 'remote.example.com';
    process.env.POSTGRES_SSL_MODE = 'disable';
    assert.throws(() => databaseConfig(), /private Compose/);
    process.env.POSTGRES_SSL_MODE = 'verify-full';
    const config = databaseConfig({ runtime: true });
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(config.user, 'runtime');
    assert.equal(config.database, 'production');
    process.env.POSTGRES_HOST = 'postgres';
    process.env.POSTGRES_SSL_MODE = 'disable';
    assert.equal(databaseConfig().ssl, undefined);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
