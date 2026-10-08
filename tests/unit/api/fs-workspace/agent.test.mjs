import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStage} from '../../../../apps/api/src/modules/fs-workspace/agent/executor.mjs';
import {document} from '../../../fixtures/fs-workspace/document.mjs';
const context={context:document().context,document:{ast:document()},entities:[],evidence:[],messages:[],materials:[],budget:16000};
const analysis={schema_version:'1.0.0',context:context.context,summary:'待澄清币种',requirements:[],rules:[],issues:[],verification_requests:[],source_coverage:[]};
test('agent stages enforce bound context and separate untrusted input from system policy',async()=>{
  let request;
  const result=await executeStage('analyze',context,{infer:async input=>{request=input;return {value:analysis};}});
  assert.equal(result.summary,analysis.summary);assert.ok(request.policy.includes('不能'));
  assert.deepEqual(JSON.parse(request.input).context,context.context);
  await assert.rejects(executeStage('analyze',context,{infer:async()=>({value:{...analysis,context:{...analysis.context,workspace_id:'another'}}})}),/CONTEXT_MISMATCH/);
  await assert.rejects(executeStage('analyze',context,{infer:async()=>({value:{...analysis,approved:true}})}),/SCHEMA_INVALID/);
});
test('agent rejects invented evidence, uncovered materials and oversized context without provider call',async()=>{
  const bad={...analysis,requirements:[{id:'tmp:r',revision:0,text:'statement',classification:'source_fact',source_refs:[{evidence_id:'invented',locator:'p1',conclusion:'x'}],depends_on:[]}]};
  await assert.rejects(executeStage('analyze',context,{infer:async()=>({value:bad})}),/REFERENCE_INVALID/);
  await assert.rejects(executeStage('analyze',{...context,messages:[{content:'中'.repeat(17000)}]},{infer:async()=>{throw new Error('must not call');}}),/CONTEXT_BUDGET_EXCEEDED/);
});
