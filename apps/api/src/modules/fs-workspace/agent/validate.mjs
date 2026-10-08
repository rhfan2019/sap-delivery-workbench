import {validateProposal} from '@sap-delivery-workbench/contracts/fs-workspace';
import {canonicalJson} from '../document/ast.mjs';
export function validateCandidate(kind,context,proposal){
  if(!validateProposal(kind,proposal).ok)throw new Error('SCHEMA_INVALID');
  if(canonicalJson(proposal.context)!==canonicalJson(context.context))throw new Error('CONTEXT_MISMATCH');
  const known=new Set(context.entities.map(e=>e.id));
  for(const section of context.document.ast.sections){known.add(section.id);for(const block of section.blocks)known.add(block.id);}
  for(const item of context.document.ast.tests)known.add(item.id);
  const evidence=new Map(context.evidence.map(e=>[e.id,e]));
  const declared=new Set();
  function collect(value){
    if(Array.isArray(value)){value.forEach(collect);return;}if(!value||typeof value!=='object')return;
    if(typeof value.id==='string'){
      if(declared.has(value.id))throw new Error('DUPLICATE_CANDIDATE_ID');declared.add(value.id);
      if(!known.has(value.id)&&!value.id.startsWith('tmp:'))throw new Error('REFERENCE_INVALID');
    }
    for(const [key,item]of Object.entries(value))if(key!=='context')collect(item);
  }
  collect(proposal);
  function inspect(value,key=''){
    if(Array.isArray(value)){value.forEach(v=>inspect(v,key));return;}
    if(value&&typeof value==='object'){
      if(value.evidence_id){const source=evidence.get(value.evidence_id);if(!source||(value.locator&&value.locator!==source.locator))throw new Error('REFERENCE_INVALID');}
      for(const [k,item]of Object.entries(value))if(k!=='context')inspect(item,k);return;
    }
    if(typeof value==='string'&&(/^(requirement_ids|rule_ids|decision_ids|section_ids|depends_on|required_entity_ids|issue_ids|open_issue_ids|deferred_issue_ids|decision_refs|verification_refs|related_ids|entity_ids|operation_target_ids|target_id|decision_subject_id)$/.test(key))&&!known.has(value)&&!declared.has(value))throw new Error('REFERENCE_INVALID');
  }
  inspect(proposal);
  if(kind==='RequirementAnalysis'&&context.evidence.some(e=>!proposal.source_coverage.some(c=>c.evidence_id===e.id)))throw new Error('SOURCE_COVERAGE_INCOMPLETE');
  return proposal;
}
