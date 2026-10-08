import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {databaseConfig} from '../../../../../apps/api/src/platform/database.mjs';
import {apiFixture} from '../../../../fixtures/fs-workspace/api.mjs';
import {saveModel,listModels} from '../../../../../apps/api/src/modules/models/store.mjs';
import {claimRun} from '../../../../../apps/api/src/modules/fs-workspace/runs/queue.mjs';
import {runOne} from '../../../../../apps/api/src/modules/fs-workspace/runs/worker.mjs';
import {startFsWorker} from '../../../../../apps/api/src/modules/fs-workspace/runs/runner.mjs';

test('real worker persists orchestration checkpoint then assistant candidate without changing head',async()=>{
  const prior=process.env.LLM_CREDENTIAL_KEY;process.env.LLM_CREDENTIAL_KEY='a'.repeat(64);
  const f=await apiFixture(),pool=new pg.Pool(databaseConfig({runtime:true}));
  try{
    const model=await saveModel(f.db,f.scope.organizationId,f.scope.actorId,{name:'Synthetic stage test',provider:'Synthetic',protocol:'openai_chat',baseUrl:'https://api.example.com/v1',modelId:'test',apiKey:'synthetic-not-live',maxOutputTokens:4000,temperature:null,timeoutSeconds:30});
    await f.db.query('INSERT INTO app.llm_default(organization_id,model_id,version_id) VALUES($1,$2,$3)',[f.scope.organizationId,model.id,model.versionId]);
    await f.db.query("INSERT INTO app.llm_test_run(id,organization_id,model_id,version_id,status,adapter_version,capabilities,expires_at,finished_at,created_by) VALUES(gen_random_uuid(),$1,$2,$3,'passed','structured-json-v1','[\"structured_output\"]',now()+interval '30 minutes',now(),$4)",[f.scope.organizationId,model.id,model.versionId,f.scope.actorId]);
    const session=(await f.request('POST','/sessions',{title:'Agent test'},{'idempotency-key':randomUUID()})).json().data;
    const listed=(await listModels(f.db,f.scope.organizationId)).items[0];
    assert.equal(listed.test,null,'structured receipt must not replace text receipt');
    assert.equal(listed.structuredTest.adapter,'structured-json-v1');
    const sent=await f.request('POST',`/sessions/${session.id}/messages`,{client_message_id:randomUUID(),content:'分析清账范围，不允许自动确认。',attachment_ids:[],selection:null,intent:'analyze'},{'idempotency-key':randomUUID()});
    assert.equal(sent.statusCode,202,sent.body);assert.equal(sent.json().data.run.status,'queued');
    let calls=0;
    const agentInfer=async input=>{
      calls++;const data=JSON.parse(input.input);
      if(calls===1)return {value:{schema_version:'1.0.0',context:data.context,summary:'分析业务',next_action:'analyze',reason:'提取需求',required_entity_ids:[],issue_ids:[]}};
      return {value:{schema_version:'1.0.0',context:data.context,summary:'仍需确认公司与币种范围。',requirements:[],rules:[],issues:[],verification_requests:[],source_coverage:data.evidence.map(e=>({evidence_id:e.id,covered_locators:[e.locator],unread_locators:[],limitations:['用户陈述']}))}};
    };
    const first=await claimRun(pool,'agent-test',f.scope.organizationId);
    assert.equal((await runOne(pool,first,{agentInfer})).status,'queued');
    const second=await claimRun(pool,'agent-test',f.scope.organizationId);
    assert.equal((await runOne(pool,second,{agentInfer})).status,'completed');
    assert.equal(calls,2);
    const artifacts=await f.request('GET',`/sessions/${session.id}/artifacts`);
    assert.equal(artifacts.statusCode,200,artifacts.body);
    assert.equal(artifacts.json().data.items[0].stage,'analyze');
    assert.equal(artifacts.json().data.items[0].run_id,first.id);
    const messages=(await f.request('GET',`/sessions/${session.id}/messages`)).json().data.items;
    assert.equal(messages.filter(m=>m.role==='assistant').length,1);assert.match(messages.at(-1).content,/公司与币种/);
    assert.equal((await f.request('GET')).json().data.workspace.draft_head.id,f.workspace.draft_head.id);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM app.fs_run_checkpoint WHERE run_id=$1',[first.id])).rows[0].n,2);
    const generation=await f.request('POST',`/sessions/${session.id}/messages`,{client_message_id:randomUUID(),content:'生成有来源标识的讨论稿',attachment_ids:[],selection:null,intent:'generate'},{'idempotency-key':randomUUID()});
    assert.equal(generation.statusCode,202,generation.body);
    const stop=startFsWorker(pool,f.scope.organizationId,{pollMs:10,agentInfer:async input=>{
      const data=JSON.parse(input.input);
      if(input.schema.title==='OrchestratorPlan')return {value:{schema_version:'1.0.0',context:data.context,summary:'生成讨论稿',next_action:'generate',reason:'用户请求',required_entity_ids:[],issue_ids:[]}};
      const sections=structuredClone(data.document.ast.sections),block=sections[0].blocks[0],evidence=data.evidence.at(-1);
      block.text='Agent生成的有来源讨论稿';block.evidence_refs=[{evidence_id:evidence.id,locator:evidence.locator,conclusion:'用户请求生成讨论稿'}];
      return {value:{schema_version:'1.0.0',context:data.context,title:'讨论稿',sections,tests:[],open_issue_ids:[],decision_refs:[],verification_refs:[],mode:'discussion'}};
    }});
    try{
      let status;
      for(let i=0;i<100;i++){status=(await f.request('GET','/runs/'+generation.json().data.run.id)).json().data;if(['completed','waiting_evidence','failed'].includes(status.status))break;await new Promise(r=>setTimeout(r,25));}
      assert.equal(status.status,'completed',JSON.stringify(status));
    }finally{await stop();}
    const artifact=(await f.request('GET',`/sessions/${session.id}/artifacts`)).json().data.items[0];
    assert.ok(artifact.change_set_id);
    const proposal=(await f.request('GET','/changes/'+artifact.change_set_id)).json().data;
    const workspace=(await f.request('GET')).json().data.workspace;
    const accepted=await f.request('POST','/changes/'+artifact.change_set_id+'/accept',{base_document_version:proposal.context.base_document_version,accepted_group_ids:proposal.atomic_groups.map(g=>g.id)},{'idempotency-key':randomUUID(),'if-match':`"ws:${workspace.id}:${workspace.revision}"`});
    assert.equal(accepted.statusCode,200,accepted.body);
    const document=(await f.request('GET','/versions/'+accepted.json().data.draft_head.id)).json().data;
    assert.equal(document.sections[0].blocks[0].text,'Agent生成的有来源讨论稿');
    assert.ok(document.evidence_manifest_ids.includes(document.sections[0].blocks[0].evidence_refs[0].evidence_id));
    assert.equal((await f.request('GET',`/sessions/${session.id}/artifacts`)).json().data.items[0].change_set_id,null);
    const stale=await f.request('POST',`/sessions/${session.id}/messages`,{client_message_id:randomUUID(),content:'分析后续',attachment_ids:[],selection:null,intent:'analyze'},{'idempotency-key':randomUUID()});
    const staleLease=await claimRun(pool,'stale-agent',f.scope.organizationId);
    const staleResult=await runOne(pool,staleLease,{agentInfer:async input=>{
      const newer=await f.request('POST',`/sessions/${session.id}/messages`,{client_message_id:randomUUID(),content:'补充新要求',attachment_ids:[],selection:null,intent:'analyze'},{'idempotency-key':randomUUID()});
      assert.equal(newer.statusCode,202,newer.body);
      const data=JSON.parse(input.input);
      return {value:{schema_version:'1.0.0',context:data.context,summary:'旧分析',next_action:'analyze',reason:'旧上下文',required_entity_ids:[],issue_ids:[]}};
    }});
    assert.equal(staleResult.status,'waiting_user');
    assert.equal((await f.request('GET','/runs/'+stale.json().data.run.id)).json().data.error_code,'CONTEXT_STALE');
  }finally{await pool.end();await f.close();if(prior===undefined)delete process.env.LLM_CREDENTIAL_KEY;else process.env.LLM_CREDENTIAL_KEY=prior;}
});
