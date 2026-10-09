import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../../scripts/testing/run-tests.mjs';
import {
  createTask,
  loadTask,
  claim,
  command,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../../apps/api/src/modules/design-assistant/worker.mjs';
import { registeredTarget } from '../../../../apps/api/src/modules/design-assistant/sap.mjs';

test('FSD_SAP_MODE=off runs analysis, plan, FSD and delivery without any SAP tool call', async () => {
  assertIsolatedDatabase(process.env);
  const previous = process.env.FSD_SAP_MODE;
  process.env.FSD_SAP_MODE = 'off';
  const pool = new pg.Pool(databaseConfig());
  let toolCalls = 0;
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture);
    const target = await registeredTarget(scope);
    assert.equal(target.sap_disabled, true);
    let task = await transaction(pool, async (db) =>
      createTask(
        db,
        scope,
        { request_id: randomUUID(), text: 'ZPOC 无 SAP 报表', mode: 'SYNTHETIC', target },
        await assetManifest(),
      ),
    );
    const run = async () => {
      const lease = await transaction(pool, (db) => claim(db, 'no-sap', task.active_run_id));
      await executeRun(pool, lease, {
        tool: async () => {
          toolCalls++;
          throw Error('SAP must not be called');
        },
      });
      task = await loadTask(pool, scope, task.id);
    };
    const confirm = async () => {
      task = await transaction(pool, (db) =>
        command(db, scope, task.id, {
          request_id: randomUUID(),
          revision: task.revision,
          command: 'confirm',
          ...task.wait,
          confirmed: true,
        }),
      );
    };
    await run();
    assert.equal(task.wait_reason, 'PLAN_CONFIRM');
    await confirm();
    await run();
    assert.equal(task.wait_reason, 'FSD_CONFIRM');
    await confirm();
    await run();
    assert.equal(task.status, 'DELIVERED');
    assert.equal(toolCalls, 0);
    assert.deepEqual(task.artifacts.at(-1).evidence_refs, []);
  } finally {
    if (previous === undefined) delete process.env.FSD_SAP_MODE;
    else process.env.FSD_SAP_MODE = previous;
    await pool.end();
  }
});
