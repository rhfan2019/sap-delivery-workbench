import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { databaseConfig } from './platform/database.mjs';
import { claimRun, expireExhaustedRuns } from './modules/fs-workspace/runs/queue.mjs';
import { transaction } from './platform/auth.mjs';
import { runOne } from './modules/fs-workspace/runs/worker.mjs';
import { startDesignWorker } from './modules/design-assistant/worker.mjs';
const organizationId = process.env.DEFAULT_ORGANIZATION_ID;
if (!organizationId) throw new Error('DEFAULT_ORGANIZATION_ID is required');
const pool = new pg.Pool({ ...databaseConfig({ runtime: true }), max: 4 });
const workerId = 'fs-worker-' + randomUUID();
let stopping = false;
const stopDesignWorker = startDesignWorker(pool);
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
try {
  while (!stopping) {
    await transaction(pool, (db) => expireExhaustedRuns(db, organizationId));
    const lease = await claimRun(pool, workerId, organizationId);
    if (!lease) {
      await delay(1000);
      continue;
    }
    try {
      await runOne(pool, lease);
    } catch (error) {
      // IDs and bounded categories only; never log inputs, files or provider responses.
      process.stderr.write(
        JSON.stringify({
          event: 'fs_worker_error',
          run_id: lease.id,
          category: error.statusCode === 409 ? 'lease_lost' : 'node_failed',
        }) + '\n',
      );
      await pool.query(
        "UPDATE app.fs_run SET status='failed',lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND fencing=$2 AND status='running'",
        [lease.id, lease.fencing],
      );
    }
  }
} finally {
  await stopDesignWorker();
  await pool.end();
}
