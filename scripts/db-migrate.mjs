import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { databaseConfig } from './lib/database.mjs';

try {
  const migrations = await runner({
    databaseUrl: databaseConfig(),
    dir: fileURLToPath(new URL('../database/migrations', import.meta.url)),
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
