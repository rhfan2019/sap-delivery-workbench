import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../../../apps/api/src/platform/auth.mjs';
import { databaseConfig } from '../../../../../apps/api/src/platform/database.mjs';
import { assertIsolatedDatabase } from '../../../../../scripts/testing/run-tests.mjs';

test('bounded save times out waiting for a database lock and releases the transaction', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool({ ...databaseConfig(), max: 2 });
  const holder = await pool.connect();
  const key = randomUUID();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const started = Date.now();
    await assert.rejects(
      transaction(
        pool,
        async (db) => {
          const {
            rows: [settings],
          } = await db.query(
            "SELECT current_setting('transaction_timeout') AS total,current_setting('statement_timeout') AS statement",
          );
          assert.equal(settings.total, '15s');
          assert.equal(settings.statement, '10s');
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
        },
        { boundedSave: true },
      ),
      (error) => error.code === '55P03',
    );
    assert.ok(Date.now() - started < 8000);
    assert.equal((await pool.query('SELECT 1 AS ok')).rows[0].ok, 1);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
    await pool.end();
  }
});
