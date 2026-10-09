import pg from 'pg';
import { databaseConfig } from '../../platform/database.mjs';
import { setupCheckpoints } from './checkpointer.mjs';
const pool = new pg.Pool(databaseConfig());
try {
  await setupCheckpoints(pool);
  console.log('FSD PostgreSQL checkpointer schema ready; no business records removed.');
} finally {
  await pool.end();
}
