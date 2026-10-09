import pg from 'pg';
import { databaseConfig } from '../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../apps/api/src/platform/auth.mjs';
import { claim } from '../../../apps/api/src/modules/design-assistant/repository.mjs';
import { executeRun } from '../../../apps/api/src/modules/design-assistant/worker.mjs';
import { assertIsolatedDatabase } from '../../../scripts/testing/run-tests.mjs';
assertIsolatedDatabase(process.env);
const pool = new pg.Pool(databaseConfig());
try {
  const lease = await transaction(pool, (db) => claim(db, 'chat-crash-child', process.argv[2]));
  if (!lease) throw Error('NO_LEASE');
  await executeRun(pool, lease, {
    streamModel: async ({ onDelta }) => {
      process.send({ modelCall: true });
      await onDelta('持久化');
      await onDelta('回复');
      return { text: '持久化回复', usage: { total_tokens: 4 } };
    },
    onBoundary: async (point, detail) => {
      if (point === process.argv[3]) {
        process.send({ point, ...detail });
        await new Promise(() => {});
      }
    },
  });
  process.send({ done: true });
} catch (error) {
  process.send({ error: error.code ?? error.message });
  process.exitCode = 1;
} finally {
  await pool.end();
  process.disconnect();
}
