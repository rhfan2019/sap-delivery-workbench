import pg from 'pg';
import { databaseConfig } from '../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../apps/api/src/platform/auth.mjs';
import { claim,command,loadTask } from '../../../apps/api/src/modules/design-assistant/repository.mjs';
import { randomUUID } from 'node:crypto';
import { executeRun } from '../../../apps/api/src/modules/design-assistant/worker.mjs';
import { assertIsolatedDatabase } from '../../../scripts/testing/run-tests.mjs';
assertIsolatedDatabase(process.env);
const pool = new pg.Pool(databaseConfig());
if(process.argv[3]==='after_decision_commit_before_dispatch'){
 const row=(await pool.query('SELECT t.* FROM app.fsd_v1_task t JOIN app.fsd_v1_run r ON r.task_id=t.id WHERE r.id=$1',[process.argv[2]])).rows[0];
 const scope={organizationId:row.organization_id,projectId:row.project_id,itemId:row.item_id,actorId:row.actor_id};const task=await loadTask(pool,scope,row.id);
 await transaction(pool,db=>command(db,scope,task.id,{request_id:randomUUID(),revision:task.revision,command:'confirm',...task.wait,confirmed:true}));
 process.send({point:process.argv[3],run_id:process.argv[2]});await new Promise(()=>{});
}
const lease = await transaction(pool, (db) => claim(db, 'crash-child', process.argv[2]));
try {
  if (!lease) throw Error('NO_LEASE');
  await executeRun(pool, lease, {
    onBoundary: async (point, detail) => {
      if (
        point === process.argv[3] &&
        (!process.argv[4] || detail.step_id?.startsWith(process.argv[4]))
      ) {
        process.send({ point, ...detail });
        await new Promise(() => {});
      }
    },
  });
  process.send?.({ done: true });
} catch (e) {
  process.send?.({ error: e.code ?? e.message });
  process.exitCode = 1;
} finally {
  await pool.end();
  process.disconnect?.();
}
