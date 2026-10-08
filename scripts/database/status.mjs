import { connectDatabase } from '@sap-delivery-workbench/api/platform/database';

const client = await connectDatabase();
try {
  const info = await client.query(
    "SELECT current_database() AS database, current_setting('server_version') AS version",
  );
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  const migrations = await client.query('SELECT name, run_on FROM public.pgmigrations ORDER BY id');
  console.log(
    JSON.stringify(
      {
        ...info.rows[0],
        businessTableCount: tables.rowCount,
        tables: tables.rows.map((row) => row.table_name),
        migrations: migrations.rows,
      },
      null,
      2,
    ),
  );
  if (tables.rowCount !== 20) process.exitCode = 1;
} finally {
  await client.end();
}
