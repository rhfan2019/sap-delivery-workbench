import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';

test('runtime can read business tables and append audit but cannot change audit or schema', async () => {
  const client = await connectDatabase({ runtime: true });
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM app.project LIMIT 1');
    await client.query(
      "INSERT INTO app.audit_event(action,outcome,request_id) VALUES('test.runtime','success',$1)",
      [randomUUID()],
    );
    for (const sql of [
      'CREATE TABLE app.forbidden_probe(id integer)',
      'CREATE TABLE public.forbidden_probe(id integer)',
      'CREATE TEMP TABLE forbidden_probe(id integer)',
      'UPDATE app.audit_event SET action=action WHERE false',
      'DELETE FROM app.audit_event WHERE false',
      'UPDATE app.fs_version SET note=note WHERE false',
      'DELETE FROM app.fs_version WHERE false',
      'UPDATE app.development_event SET action=action WHERE false',
      'DELETE FROM app.development_item WHERE false',
      'SELECT * FROM public.pgmigrations',
    ]) {
      await client.query('SAVEPOINT runtime_check');
      await assert.rejects(client.query(sql), (error) => error.code === '42501');
      await client.query('ROLLBACK TO SAVEPOINT runtime_check');
      await client.query('RELEASE SAVEPOINT runtime_check');
    }
    const result = await client.query(
      'SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user',
    );
    assert.deepEqual(result.rows[0], {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
    });
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
