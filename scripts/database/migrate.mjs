import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { connectDatabase, databaseConfig } from '@sap-delivery-workbench/api/platform/database';
import { ensureRuntimeRole } from './runtime-role.mjs';

try {
  // Migrations grant to this role, and provisioning (which logs it in) needs the migrated tables,
  // so an empty database has to get the role, without a login, before the first migration.
  const client = await connectDatabase();
  try {
    await ensureRuntimeRole(client);
  } finally {
    await client.end();
  }
  const migrations = await runner({
    databaseUrl: databaseConfig(),
    dir: fileURLToPath(new URL('../../database/migrations/', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    migrationsSchema: 'public',
    checkOrder: true,
    singleTransaction: true,
    verbose: false,
  });
  console.log('Applied migrations: ' + migrations.length);
} catch (error) {
  console.error('Migration failed: ' + error.message);
  process.exitCode = 1;
}
