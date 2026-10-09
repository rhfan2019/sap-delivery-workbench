import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from '../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../scripts/testing/run-tests.mjs';
import { createTask,loadTask,claim,command } from '../../../apps/api/src/modules/design-assistant/repository.mjs';
import { assetManifest } from '../../../apps/api/src/modules/design-assistant/assets.mjs';
import { setupCheckpoints } from '../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../apps/api/src/modules/design-assistant/worker.mjs';
export async function workflow(){
 assertIsolatedDatabase(process.env);const pool=new pg.Pool(databaseConfig());await setupCheckpoints(pool);const scope=await transaction(pool,fixture);
 const w={pool,scope,task:await transaction(pool,async db=>createTask(db,scope,{request_id:randomUUID(),text:'ZPOC report fixture',mode:'SYNTHETIC',target:{target_ref:'synthetic',client:'000'}},await assetManifest()))};
 w.refresh=async()=>w.task=await loadTask(pool,scope,w.task.id);
 w.command=async body=>w.task=await transaction(pool,db=>command(db,scope,w.task.id,{request_id:randomUUID(),revision:w.task.revision,...body}));
 w.run=async options=>{const lease=await transaction(pool,db=>claim(db,'workflow-test',w.task.active_run_id));if(!lease)throw Error('NO_LEASE');try{await executeRun(pool,lease,options);}finally{await w.refresh();}};
 w.close=()=>pool.end();await w.run();await w.command({command:'answer',question_id:w.task.wait.questions[0].id,option_id:'remaining'});await w.command({command:'complete_batch'});return w;
}
