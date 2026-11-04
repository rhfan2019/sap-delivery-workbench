import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const DATABASE = 'sap_fs_test_init_check_dev';
const connect = async (database) => {
  const client = new pg.Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database,
  });
  await client.connect();
  return client;
};
// Everything the script is meant to reproduce, in a form two databases can be compared by.
const shape = `SELECT 'column' AS kind, table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'') AS item
    FROM information_schema.columns WHERE table_schema='app'
  UNION ALL SELECT 'constraint', conrelid::regclass||' '||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='app'::regnamespace
  UNION ALL SELECT 'index', indexdef FROM pg_indexes WHERE schemaname='app'
  UNION ALL SELECT 'trigger', tgrelid::regclass||' '||tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'function', proname||' '||md5(prosrc) FROM pg_proc WHERE pronamespace='app'::regnamespace
  UNION ALL SELECT 'grant', grantee||' '||table_name||' '||privilege_type FROM information_schema.role_table_grants WHERE table_schema='app' AND grantee='sap_workbench_app'
  UNION ALL SELECT 'column grant', grantee||' '||table_name||'.'||column_name||' '||privilege_type FROM information_schema.column_privileges WHERE table_schema='app' AND grantee='sap_workbench_app'
  UNION ALL SELECT 'migration', name FROM public.pgmigrations
  ORDER BY 1,2`;

// A dump and restore keeps an expression's meaning but may print its casts and brackets differently.
const normalized = (rows) =>
  rows.map(({ kind, item }) => ({
    kind,
    item: item.replace(/::[a-z ]+(\[\])?/g, '').replace(/[()\s]/g, ''),
  }));
const sorted = (rows) =>
  normalized(rows).sort((a, b) => (a.kind + a.item).localeCompare(b.kind + b.item));

test('the init script builds the same database as the migrations and refuses a second run', async () => {
  const script = await readFile(
    new URL('../../../database/init/init-database.sql', import.meta.url),
    'utf8',
  );
  const admin = await connect('postgres');
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE}`);
  await admin.query(`CREATE DATABASE ${DATABASE}`);
  try {
    const built = await connect(DATABASE);
    const migrated = await connect(process.env.POSTGRES_DB);
    try {
      await built.query(script);
      assert.deepEqual(
        sorted((await built.query(shape)).rows),
        sorted((await migrated.query(shape)).rows),
      );
      await assert.rejects(built.query(script), /不是空的/);
      await built.query('ROLLBACK');
    } finally {
      await built.end();
      await migrated.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await admin.end();
  }
});
