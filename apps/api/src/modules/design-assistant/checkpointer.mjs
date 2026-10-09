import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { guard } from './repository.mjs';

// The package uses its own transactions. Fence INSIDE that transaction so a
// paused/replaced worker cannot advance a durable cursor after losing ownership.
export function durableSaver(pool, lease) {
  const guardedPool = {
    query: (...args) => pool.query(...args),
    async connect() {
      const db = await pool.connect();
      return {
        release: () => db.release(),
        async query(sql, ...args) {
          const result = await db.query(sql, ...args);
          if (sql === 'BEGIN') await guard(db, lease, { allowWaiting: true });
          return result;
        },
      };
    },
  };
  return new PostgresSaver(guardedPool, undefined, { schema: 'fsd_checkpoint' });
}
export async function setupCheckpoints(pool) {
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended('fsd-checkpoint-setup',0))");
    await new PostgresSaver(pool, undefined, { schema: 'fsd_checkpoint' }).setup();
    await lock.query(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA fsd_checkpoint TO sap_workbench_app',
    );
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended('fsd-checkpoint-setup',0))");
    lock.release();
  }
}
