import {randomUUID} from 'node:crypto';
import {transaction} from '../../auth.mjs';
import {commitNode} from '../runs/checkpoints.mjs';
import {appendRunEvent} from '../runs/events.mjs';
import {contentHash} from '../document/ast.mjs';
import {loadAgentContext,pinModel} from './context.mjs';
import {executeStage,stages} from './executor.mjs';
import {saveCandidate,proposalSummary} from './candidates.mjs';

async function assertCurrent(db,lease,document,snapshot){
  const {rows:[workspace]}=await db.query('SELECT draft_head FROM app.fs_workspace WHERE id=$1',[lease.workspace_id]);
  const range=snapshot.message_range.find(r=>r.session_id===lease.session_id);
  const newer=await db.query("SELECT 1 FROM app.fs_message WHERE session_id=$1 AND role='user' AND seq>$2::bigint LIMIT 1",[lease.session_id,range.to]);
  if(workspace.draft_head!==document.id||newer.rowCount)throw new Error('CONTEXT_STALE');
}
export async function executeAgent(pool,lease,{infer,signal}={}){
  let loaded;
  try{
    loaded=await loadAgentContext(pool,lease);
    const {snapshot,context,document}=loaded;
    if(!snapshot.config_versions.model_version_id){
      const pinned=await pinModel(pool,lease.organization_id);
      return await transaction(pool,db=>commitNode(db,lease,{inputHash:contentHash({bind:snapshot.id,pinned}),outputRefs:[],configVersions:pinned,nextStatus:'queued'},async db=>{
        const id=randomUUID(),config={...snapshot.config_versions,...pinned};
        await db.query('INSERT INTO app.fs_context_snapshot(id,organization_id,project_id,workspace_id,version_manifest,message_range,config_versions,input_hash,token_budget,coverage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,lease.organization_id,lease.project_id,lease.workspace_id,JSON.stringify(snapshot.version_manifest),JSON.stringify(snapshot.message_range),config,contentHash({source:snapshot.input_hash,config}),snapshot.token_budget,snapshot.coverage]);
        await db.query("UPDATE app.fs_run SET input_snapshot_id=$2,node_id='orchestrate',budget_json=budget_json-'error_code' WHERE id=$1",[lease.id,id]);
      }));
    }
    await assertCurrent(pool,lease,document,snapshot);
    const stage=lease.node_id==='orchestrate'?'orchestrate':lease.node_id.replace(/^stage_/,'');
    const value=await executeStage(stage,context,{infer,db:pool,organizationId:lease.organization_id,modelVersion:snapshot.config_versions.model_version_id,credentialRef:snapshot.config_versions.credential_ref,signal});
    const next=stage==='orchestrate'?value.next_action:null;
    const waiting=next==='wait'||next==='verify';
    if(next&&!waiting&&!stages[next])throw new Error('STAGE_UNAVAILABLE');
    return await transaction(pool,db=>commitNode(db,lease,{inputHash:contentHash({input:snapshot.input_hash,stage}),outputRefs:[],configVersions:snapshot.config_versions,nextStatus:waiting?'waiting_evidence':next?'queued':'completed'},async(db,run)=>{
      await assertCurrent(db,run,document,snapshot);
      if(next&&!waiting){
        await db.query("UPDATE app.fs_run SET node_id=$2,budget_json=(budget_json-'error_code')||jsonb_build_object('plan',$3::jsonb) WHERE id=$1",[run.id,'stage_'+next,JSON.stringify(value)]);return;
      }
      const scope={organizationId:run.organization_id,projectId:run.project_id,workspaceId:run.workspace_id,actorId:run.principal_user_id};
      const changeId=waiting?null:await saveCandidate(db,scope,document,context.context,stage,value);
      const id=randomUUID(),summary=proposalSummary(stage,value),artifact={id,run_id:run.id,stage,summary,change_set_id:changeId};
      await db.query("INSERT INTO app.fs_message(id,organization_id,project_id,workspace_id,session_id,seq,client_message_id,role,body,created_by,request_json,run_id) SELECT $1,$2,$3,$4,$5,coalesce(max(seq),0)+1,$6,'assistant',$7,$8,$9,$10 FROM app.fs_message WHERE session_id=$5",[id,run.organization_id,run.project_id,run.workspace_id,run.session_id,randomUUID(),summary,run.principal_user_id,{artifact,proposal:value},run.id]);
      await db.query("UPDATE app.fs_run SET budget_json=(budget_json-'error_code')||jsonb_build_object('artifact_id',$2::text,'error_code',$3::text) WHERE id=$1",[run.id,id,waiting?(next==='verify'?'SAP_EVIDENCE_REQUIRED':'AGENT_NEEDS_INPUT'):null]);
      await appendRunEvent(db,run,'artifact.proposed','Agent结果已校验并保存；候选尚未应用。',{entity_ids:changeId?[changeId]:[id]});
    }));
  }catch(error){
    if(error.statusCode===409&&error.message.includes('租约'))throw error;
    const safe=new Set(['CONTEXT_STALE','CONTEXT_UNAVAILABLE','CONTEXT_HASH_MISMATCH','CONTEXT_BUDGET_EXCEEDED','MODEL_CONFIGURATION_UNAVAILABLE','MODEL_CAPABILITY_REQUIRED','MODEL_REFUSAL','OUTPUT_TRUNCATED','PROVIDER_INCOMPLETE','MODEL_AUTH_FAILED','MODEL_RATE_LIMITED','MODEL_PROVIDER_ERROR','SCHEMA_INVALID','JSON_INVALID','REFERENCE_INVALID','CONTEXT_MISMATCH','SOURCE_COVERAGE_INCOMPLETE','ATTACHMENT_NOT_READY','TEMPLATE_MISMATCH','PROTOCOL_NOT_VERIFIED','PROMPT_VERSION_UNAVAILABLE']);
    const code=error.statusCode===409?'MODEL_CONFIGURATION_REQUIRED':safe.has(error.message)?error.message:['AbortError','TimeoutError'].includes(error.name)?'MODEL_TIMEOUT':'AGENT_EXECUTION_FAILED';
    return transaction(pool,db=>commitNode(db,lease,{inputHash:contentHash({error:code,attempt:lease.attempt}),outputRefs:[],configVersions:loaded?.snapshot.config_versions??{},nextStatus:code==='CONTEXT_STALE'?'waiting_user':'waiting_evidence'},async(db,run)=>{
      await db.query("UPDATE app.fs_run SET budget_json=budget_json||jsonb_build_object('error_code',$2::text) WHERE id=$1",[run.id,code]);
      await appendRunEvent(db,run,'run.waiting','Agent暂停，需要处理运行条件。',{error_code:code,retryable:code!=='CONTEXT_STALE'});
    }));
  }
}
