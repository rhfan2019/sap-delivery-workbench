import {loadVersion} from '../document/repository.mjs';
import {resolveDefaultModel} from '../../models/store.mjs';
import {promptVersion} from './executor.mjs';
export async function pinModel(db,organizationId){
  const model=await resolveDefaultModel(db,organizationId,['structured_output']);
  return {model_version_id:model.versionId,credential_ref:model.credentialId,prompt_version:promptVersion,schema_version:'1.0.0'};
}
export async function loadAgentContext(db,lease){
  const scope={organizationId:lease.organization_id,projectId:lease.project_id,workspaceId:lease.workspace_id};
  const {rows:[snapshot]}=await db.query('SELECT * FROM app.fs_context_snapshot WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',[scope.organizationId,scope.projectId,scope.workspaceId,lease.input_snapshot_id]);
  if(!snapshot)throw new Error('CONTEXT_UNAVAILABLE');
  if(snapshot.config_versions.prompt_version!==promptVersion)throw new Error('PROMPT_VERSION_UNAVAILABLE');
  const head=snapshot.version_manifest.find(e=>e.kind==='document');
  const document=await loadVersion(db,scope,head?.id);
  if(document.content_hash!==head.hash)throw new Error('CONTEXT_HASH_MISMATCH');
  const range=snapshot.message_range.find(r=>r.session_id===lease.session_id);
  if(!range)throw new Error('CONTEXT_UNAVAILABLE');
  const {rows:messages}=await db.query("SELECT id,role,body AS content,source_selection AS selection FROM app.fs_message WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND session_id=$4 AND seq BETWEEN $5::bigint AND $6::bigint ORDER BY seq",[scope.organizationId,scope.projectId,scope.workspaceId,lease.session_id,range.from,range.to]);
  const entities=[];
  for(const entry of document.entity_manifest){
    const {rows:[row]}=await db.query('SELECT r.payload,r.content_hash FROM app.fs_entity e JOIN app.fs_entity_revision r ON r.entity_id=e.id AND r.revision=$5 WHERE e.organization_id=$1 AND e.project_id=$2 AND e.workspace_id=$3 AND e.stable_id=$4',[scope.organizationId,scope.projectId,scope.workspaceId,entry.id,entry.revision]);
    if(!row||row.content_hash!==entry.hash)throw new Error('CONTEXT_HASH_MISMATCH');entities.push({...entry,content:row.payload});
  }
  const evidence=[];
  for(const entry of snapshot.version_manifest.filter(e=>e.kind==='evidence')){
    const {rows:[row]}=await db.query('SELECT id,locator,conclusion,hash,source_kind,source_id,scope,limitations FROM app.fs_evidence WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',[scope.organizationId,scope.projectId,scope.workspaceId,entry.id]);
    if(!row||row.hash!==entry.hash)throw new Error('CONTEXT_HASH_MISMATCH');evidence.push(row);
  }
  const materials=[];
  for(const entry of snapshot.version_manifest.filter(e=>e.kind==='attachment')){
    const {rows:[row]}=await db.query('SELECT p.*,a.scan_status FROM app.fs_parse_result p JOIN app.fs_attachment a ON a.id=p.attachment_id WHERE p.organization_id=$1 AND p.project_id=$2 AND p.workspace_id=$3 AND p.id=$4 AND a.id=$5 AND a.hash=$6',[scope.organizationId,scope.projectId,scope.workspaceId,entry.parse_id,entry.id,entry.hash]);
    if(!row||row.scan_status!=='clean'||row.hash!==entry.parse_hash||row.state!=='complete')throw new Error('ATTACHMENT_NOT_READY');
    materials.push({attachment_id:entry.id,regions:row.regions,coverage:row.coverage,warnings:row.warnings});
  }
  return {snapshot,context:{context:{...document.ast.context,workspace_id:lease.workspace_id,session_id:lease.session_id,run_id:lease.id,document_id:document.id,base_document_version:document.id,context_snapshot_id:snapshot.id},document:{ast:document.ast,template:document.template},entities,evidence,messages,materials,intent:lease.intent,budget:Math.min(64000,Number(snapshot.token_budget))},document};
}
