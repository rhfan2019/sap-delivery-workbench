import {randomUUID} from 'node:crypto';
import {contentHash} from '../document/ast.mjs';
import {validateProposal} from '../../../../../packages/contracts/fs-workspace/index.mjs';
import {graphFor} from '../changes/service.mjs';
import {computeImpact} from '../changes/impact.mjs';

export function proposalSummary(stage,value){
  const lines=[value.summary??value.reason??(stage==='generate'?'已生成文档修改候选，接受后才会更新草稿。':'候选已生成。')];
  for(const [label,items] of [['需求',value.requirements],['规则',value.rules],['问题',value.issues],['建议',value.decision_proposals]])for(const item of items??[])lines.push(`${label}：${item.text??item.question}`);
  for(const question of value.questions??[])lines.push(question.question??question.text??'',...(question.options??[]).map(option=>`${option.label??option.text??''}：${option.consequence??''}`));
  return lines.filter(Boolean).join('\n\n');
}
export async function saveCandidate(db,scope,source,context,stage,value){
  let operations=[];
  if(stage==='analyze'||stage==='clarify'){
    for(const [kind,items]of [['requirement',value.requirements],['rule',value.rules],['issue',value.issues],['verification_request',value.verification_requests],['decision',value.decision_proposals]]){
      for(const item of items??[]){
        if(!item.id.startsWith('tmp:'))throw new Error('EXISTING_ENTITY_REQUIRES_CHANGESET');
        operations.push({op:'add',entity_type:kind,target_id:item.id,expected_revision:null,before_hash:null,value:item,reason:'Agent候选，尚未人工接受'});
      }
    }
  }else if(stage==='generate'){
    if(value.sections.length!==source.ast.sections.length)throw new Error('TEMPLATE_MISMATCH');
    for(const section of value.sections){const old=source.ast.sections.find(s=>s.id===section.id&&s.template_slot===section.template_slot);if(!old)throw new Error('TEMPLATE_MISMATCH');operations.push({op:'replace',entity_type:'section',target_id:old.id,expected_revision:source.ast.revision,before_hash:contentHash(old),value:section,reason:'生成讨论稿章节'});}
    for(const item of value.tests){const old=source.ast.tests.find(t=>t.id===item.id);operations.push({op:old?'replace':'add',entity_type:'test',target_id:item.id,expected_revision:old?source.ast.revision:null,before_hash:old?contentHash(old):null,value:item,reason:'生成测试候选'});}
  }else if(stage==='revise')operations=value.operations;
  if(!operations.length)return null;
  const id=randomUUID(),proposal={schema_version:'1.0.0',context,change_set_id:id,reason:value.reason??'Agent生成的待审阅候选',operations,impacts:computeImpact(await graphFor(db,scope,source.ast),operations.map(op=>op.target_id)),atomic_groups:[{id:randomUUID(),operation_target_ids:operations.map(op=>op.target_id),reason:'本阶段候选整体审阅'}],new_issue_ids:operations.filter(op=>op.entity_type==='issue'&&op.op==='add').map(op=>op.target_id)};
  if(!validateProposal('ChangeSet',proposal).ok)throw new Error('CANDIDATE_INVALID');
  await db.query("INSERT INTO app.fs_change_set(id,organization_id,project_id,workspace_id,base_revision_id,proposal,hash,status) VALUES($1,$2,$3,$4,$5,$6,$7,'proposed')",[id,scope.organizationId,scope.projectId,scope.workspaceId,source.id,proposal,contentHash(proposal)]);
  return id;
}
