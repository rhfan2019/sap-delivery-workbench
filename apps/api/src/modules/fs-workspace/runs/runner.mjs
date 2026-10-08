import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction} from '../../../platform/auth.mjs';
import {claimRun,expireExhaustedRuns,assertLease} from './queue.mjs';
import {runOne} from './worker.mjs';
import {appendRunEvent} from './events.mjs';

export function startFsWorker(pool,organizationId,{pollMs=500,agentInfer}={}){
  const controller=new AbortController(),workerId='fs-worker-'+randomUUID();
  let stopping=false;
  const done=(async()=>{
    while(!stopping){
      let lease;
      try{
        await transaction(pool,db=>expireExhaustedRuns(db,organizationId));
        lease=await claimRun(pool,workerId,organizationId);
        if(lease){
          await transaction(pool,async db=>{await assertLease(db,lease);await appendRunEvent(db,lease,'run.started','正在执行任务节点。');});
          await runOne(pool,lease,{agentInfer,signal:controller.signal});
        }
      }catch{
        // No inputs, credential details, or provider bodies enter logs.
        if(lease&&!stopping)await transaction(pool,async db=>{
          const {rows:[row]}=await db.query("UPDATE app.fs_run SET status='failed',lease_owner=NULL,lease_until=NULL,budget_json=budget_json||jsonb_build_object('error_code','WORKER_NODE_FAILED'),updated_at=clock_timestamp() WHERE id=$1 AND fencing=$2 AND status='running' RETURNING *",[lease.id,lease.fencing]);
          if(row)await appendRunEvent(db,row,'run.failed','任务节点失败，可以检查配置后重试。',{error_code:'WORKER_NODE_FAILED',retryable:true});
        }).catch(()=>{});
      }
      if(!stopping)await delay(lease?10:pollMs,undefined,{signal:controller.signal}).catch(()=>{});
    }
  })();
  return async()=>{stopping=true;controller.abort();await done;};
}
