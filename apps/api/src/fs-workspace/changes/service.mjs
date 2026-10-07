import { randomUUID } from 'node:crypto';
import { failure } from '../../auth.mjs';
import {
  validateProposal,
  validateChangeValue,
} from '../../../../../packages/contracts/fs-workspace/index.mjs';
import { contentHash, validateDocument } from '../document/ast.mjs';
import { loadVersion, insertVersion } from '../document/repository.mjs';
import { readWorkspace } from '../workspace/repository.mjs';
import { computeImpact, documentGraph, selectAtomicOperations } from './impact.mjs';
import { mapTemporaryIds, applyEntityOperations, snapshotContext } from './entities.mjs';
import { invalidateConfirmations } from '../document/confirmations.mjs';
import {bindCandidateEvidence} from '../evidence/bind-candidate.mjs';

export async function loadChange(db, scope, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw failure(404, '变更集不存在或无权访问。');
  const { rows } = await db.query(
    'SELECT * FROM app.fs_change_set WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!rows.length) throw failure(404, '变更集不存在或无权访问。');
  return rows[0];
}
export async function graphFor(db, scope, ast) {
  const { rows: entities } = await db.query(
    'SELECT id,stable_id,kind FROM app.fs_entity WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3',
    [scope.organizationId, scope.projectId, scope.workspaceId],
  );
  const { rows: edges } = await db.query(
    `SELECT s.stable_id AS source,t.stable_id AS target FROM app.fs_dependency d JOIN app.fs_entity s ON s.id=d.source_entity AND s.head_revision=d.source_revision JOIN app.fs_entity t ON t.id=d.target_entity WHERE d.organization_id=$1 AND d.project_id=$2 AND d.workspace_id=$3`,
    [scope.organizationId, scope.projectId, scope.workspaceId],
  );
  return documentGraph(ast, entities, edges);
}
export async function proposeManualEdit(db, scope, workspace, input) {
  if (input.base_document_version !== workspace.draft_head)
    throw failure(409, '选区基础版本已经变化。');
  const source = await loadVersion(db, scope, workspace.draft_head);
  const block = source.ast.sections.flatMap((s) => s.blocks).find((b) => b.id === input.block_id);
  if (!block || block.id !== input.new_block.id || contentHash(block) !== input.before_hash)
    throw failure(409, '内容块或前值哈希已经变化。');
  const id = randomUUID();
  const impacts = computeImpact(await graphFor(db, scope, source.ast), [block.id]);
  const proposal = {
    schema_version: '1.0.0',
    context: { ...source.ast.context, base_document_version: source.id },
    change_set_id: id,
    reason: input.reason,
    operations: [
      {
        op: 'replace',
        entity_type: 'block',
        target_id: block.id,
        expected_revision: source.ast.revision,
        before_hash: input.before_hash,
        value: input.new_block,
        reason: input.reason,
      },
    ],
    impacts,
    atomic_groups: [{ id: randomUUID(), operation_target_ids: [block.id], reason: input.reason }],
    new_issue_ids: [],
  };
  if (!validateProposal('ChangeSet', proposal).ok)
    throw failure(422, '人工编辑无法转换为合法变更。');
  await db.query(
    "INSERT INTO app.fs_change_set(id,organization_id,project_id,workspace_id,base_revision_id,proposal,hash,status) VALUES($1,$2,$3,$4,$5,$6,$7,'proposed')",
    [
      id,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      source.id,
      proposal,
      contentHash(proposal),
    ],
  );
  return proposal;
}

function applyAstOperations(ast, operations) {
  const next = structuredClone(ast);
  for (const op of operations) {
    if (!['block', 'section', 'test'].includes(op.entity_type)) continue;
    if (op.op !== 'remove' && !validateChangeValue(op.entity_type, op.value).ok)
      throw failure(422, '操作值与文档实体类型不符。');
    let container =
      op.entity_type === 'section'
        ? next.sections
        : op.entity_type === 'test'
          ? next.tests
          : next.sections.find((s) => s.blocks.some((b) => b.id === op.target_id))?.blocks;
    if (!container) throw failure(422, '内容块缺少明确的父章节，需通过章节变更表达。');
    const index = container.findIndex((item) => item.id === op.target_id),
      old = container[index];
    if (op.op === 'add') {
      if (
        old ||
        op.expected_revision !== null ||
        op.before_hash !== null ||
        !op.value ||
        op.value.id !== op.target_id
      )
        throw failure(422, '新增操作与目标不一致。');
      container.push(structuredClone(op.value));
    } else {
      if (!old || op.expected_revision !== ast.revision || contentHash(old) !== op.before_hash)
        throw failure(409, '变更前值或修订已过期。');
      if (op.op === 'remove') {
        if (op.value !== null) throw failure(422, '删除操作不能包含新值。');
        container.splice(index, 1);
      } else {
        if (op.value?.id !== op.target_id) throw failure(422, '变更目标与值 ID 不一致。');
        container[index] = structuredClone(op.value);
      }
    }
  }
  return next;
}

export async function acceptChange(db, scope, workspace, id, input) {
  const change = await loadChange(db, scope, id);
  if (
    change.status !== 'proposed' ||
    change.base_revision_id !== workspace.draft_head ||
    input.base_document_version !== workspace.draft_head
  )
    throw failure(409, '候选基础版本过期或已处理。');
  if (
    !validateProposal('ChangeSet', change.proposal).ok ||
    contentHash(change.proposal) !== change.hash
  )
    throw failure(422, '候选结构或哈希无效。');
  const source = await loadVersion(db, scope, workspace.draft_head);
  const graph = await graphFor(db, scope, source.ast);
  let operations;
  try {
    operations = selectAtomicOperations(change.proposal, input.accepted_group_ids, graph);
  } catch {
    throw failure(422, '必须接受完整的原子依赖组。');
  }
  operations = mapTemporaryIds(operations);
  const impacts = computeImpact(
    graph,
    operations.map((op) => op.target_id),
  );
  const changed = await applyEntityOperations(
    db,
    scope,
    applyAstOperations(source.ast, operations),
    operations,
    impacts.map((i) => i.entity_id),
  );
  const next = changed.ast;
  source.entity_manifest = changed.manifest;
  await bindCandidateEvidence(db,scope,source,change.proposal,operations,next);
  const contextId = await snapshotContext(db, scope, source, changed.manifest);
  next.context = { ...next.context, context_snapshot_id: contextId };
  const invalidated = await invalidateConfirmations(
    db,
    scope,
    impacts.map((i) => i.entity_id),
    contextId,
  );
  next.confirmation_refs = next.confirmation_refs.filter((id) => !invalidated.includes(id));
  const findings = validateDocument(next, source.template, {
    entities: source.entity_manifest,
    evidence: source.evidence_manifest,
  });
  if (findings.some((f) => f.blocking === 'review'))
    throw failure(422, '变更导致文档结构或引用不一致。');
  const row = await insertVersion(db, scope, workspace, source, next);
  await db.query(
    "UPDATE app.fs_change_set SET status='accepted',result_revision_id=$2 WHERE id=$1",
    [id, row.id],
  );
  await db.query(
    "UPDATE app.fs_review_request SET state='returned' WHERE workspace_id=$1 AND state IN ('open','approved')",
    [workspace.id],
  );
  await db.query('UPDATE app.fs_workspace SET review_head=NULL WHERE id=$1', [workspace.id]);
  return readWorkspace(db, scope);
}
