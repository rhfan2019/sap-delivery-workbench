import {failure} from '../../../platform/auth.mjs';

// Only evidence already pinned in the candidate's authorized input may enter a new version.
export async function bindCandidateEvidence(db,scope,source,proposal,operations,ast){
  const links=[];
  function visit(value){
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    if(typeof value.evidence_id==='string')links.push(value);
    Object.values(value).forEach(visit);
  }
  operations.forEach(visit);
  if(!links.length)return;
  const {rows:[snapshot]}=await db.query('SELECT version_manifest FROM app.fs_context_snapshot WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',[scope.organizationId,scope.projectId,scope.workspaceId,proposal.context.context_snapshot_id]);
  if(!snapshot)throw failure(422,'候选证据上下文不存在。');
  const manifest=new Map(source.evidence_manifest.map(e=>[e.id,e]));
  for(const link of links){
    const pinned=snapshot.version_manifest.find(e=>e.id===link.evidence_id);
    if(!pinned)throw failure(422,'候选来源不在固定上下文中。');
    const {rows:[row]}=await db.query('SELECT id,hash,source_revision,locator FROM app.fs_evidence WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',[scope.organizationId,scope.projectId,scope.workspaceId,link.evidence_id]);
    if(!row||row.hash!==pinned.hash||row.locator!==link.locator)throw failure(422,'候选来源或定位无效。');
    manifest.set(row.id,{id:row.id,hash:row.hash,revision:row.source_revision,kind:'evidence'});
  }
  source.evidence_manifest=[...manifest.values()];
  ast.evidence_manifest_ids=[...new Set([...ast.evidence_manifest_ids,...links.map(l=>l.evidence_id)])];
}
