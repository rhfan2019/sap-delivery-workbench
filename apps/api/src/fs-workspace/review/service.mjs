import { randomUUID } from 'node:crypto';
import { failure } from '../../auth.mjs';
import { loadVersion } from '../document/repository.mjs';
import { contentHash } from '../document/ast.mjs';
import { evaluateReleaseGates } from './gates.mjs';
import { approvalProjection } from './decisions.mjs';
export const policyVersion = 'fs-review-v1';
async function manifestFor(db, scope, document) {
  const { rows: confirmations } = await db.query(
    `SELECT e.stable_id AS subject_id,c.subject_revision,c.subject_hash FROM app.fs_confirmation c JOIN app.fs_entity e ON e.id=c.subject_id WHERE c.workspace_id=$1 AND c.action='confirm' AND NOT EXISTS(SELECT 1 FROM app.fs_confirmation n WHERE n.supersedes_id=c.id)`,
    [scope.workspaceId],
  );
  const evidence = [];
  for (const entry of document.evidence_manifest) {
    const {
      rows: [row],
    } = await db.query(
      'SELECT id,expires_at,hash FROM app.fs_evidence WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id::text=$4',
      [scope.organizationId, scope.projectId, scope.workspaceId, entry.id],
    );
    evidence.push({
      ...entry,
      exists: Boolean(row && (!entry.hash || row.hash === entry.hash)),
      expires_at: row?.expires_at,
    });
  }
  const ruleDetails = [];
  for (const entry of document.entity_manifest.filter((e) => e.kind === 'rule')) {
    const {
      rows: [row],
    } = await db.query(
      'SELECT r.payload FROM app.fs_entity e JOIN app.fs_entity_revision r ON r.entity_id=e.id AND r.revision=$2 WHERE e.workspace_id=$1 AND e.stable_id=$3',
      [scope.workspaceId, entry.revision, entry.id],
    );
    if (row?.payload.detail) ruleDetails.push(row.payload.detail);
  }
  return { entities: document.entity_manifest, evidence, confirmations, ruleDetails };
}
export async function getReview(db, scope, id) {
  const {
    rows: [review],
  } = await db.query(
    'SELECT * FROM app.fs_review_request WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!review) throw failure(404, '评审不存在或无权访问。');
  const document = await loadVersion(db, scope, review.document_revision_id);
  const { rows: approvals } = await db.query(
    'SELECT * FROM app.fs_approval WHERE review_request_id=$1 ORDER BY created_at,id',
    [id],
  );
  return {
    id: review.id,
    document_version_id: document.id,
    document_hash: document.content_hash,
    state: review.state,
    policy_version: review.policy_version,
    gates: evaluateReleaseGates(document, await manifestFor(db, scope, document)),
    ...approvalProjection(approvals, {
      document_revision_id: document.id,
      document_hash: document.content_hash,
      manifest_hash: contentHash(document.evidence_manifest),
      policy_version: review.policy_version,
    }),
  };
}
export async function submitReview(db, scope, workspace, input) {
  const document = await loadVersion(db, scope, input.document_version_id);
  if (document.id !== workspace.draft_head || document.content_hash !== input.document_hash)
    throw failure(409, '送审版本或哈希已变化。');
  const manifest = await manifestFor(db, scope, document),
    gates = evaluateReleaseGates(document, manifest);
  if (gates.some((g) => !g.passed && g.blocking === 'review'))
    throw failure(422, '文档结构错误，不能提交评审。');
  const active = await db.query(
    "SELECT id FROM app.fs_review_request WHERE workspace_id=$1 AND state='open'",
    [workspace.id],
  );
  if (active.rowCount) throw failure(409, '已有进行中的评审。');
  const id = randomUUID();
  await db.query(
    "INSERT INTO app.fs_review_request(id,organization_id,project_id,workspace_id,document_revision_id,state,policy_version,created_by) VALUES($1,$2,$3,$4,$5,'open',$6,$7)",
    [
      id,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      document.id,
      policyVersion,
      scope.actorId,
    ],
  );
  await db.query(
    "INSERT INTO app.fs_review(organization_id,project_id,workspace_id,document_revision_id,document_hash,ruleset_version,evidence_manifest_hash,kind,findings,coverage,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,'rule',$8,$9,$10)",
    [
      scope.organizationId,
      scope.projectId,
      workspace.id,
      document.id,
      document.content_hash,
      policyVersion,
      contentHash(document.evidence_manifest),
      JSON.stringify(gates),
      { source: 'deterministic', ai_review: false },
      scope.actorId,
    ],
  );
  await db.query(
    'UPDATE app.fs_workspace SET review_head=$2,row_version=row_version+1 WHERE id=$1',
    [workspace.id, document.id],
  );
  return getReview(db, scope, id);
}
export async function recordApproval(db, scope, workspace, id, input) {
  const review = await getReview(db, scope, id);
  if (
    !['open', 'approved', 'returned'].includes(review.state) ||
    workspace.review_head !== review.document_version_id ||
    input.document_version_id !== review.document_version_id ||
    input.document_hash !== review.document_hash ||
    review.policy_version !== policyVersion
  )
    throw failure(409, '评审版本、状态或政策已变化。');
  if (input.action === 'approve' && review.gates.some((g) => !g.passed && g.blocking !== 'none'))
    throw failure(422, '发布门禁尚未满足，不能批准。');
  const document = await loadVersion(db, scope, review.document_version_id);
  const published = await db.query(
    'SELECT 1 FROM app.fs_publication WHERE workspace_id=$1 AND document_revision_id=$2',
    [workspace.id, document.id],
  );
  if (published.rowCount) throw failure(409, '已发布版本的审批历史不可改写；请建立新评审。');
  await db.query(
    'INSERT INTO app.fs_approval(organization_id,project_id,workspace_id,review_request_id,document_revision_id,document_hash,manifest_hash,policy_version,role,actor_id,action,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [
      scope.organizationId,
      scope.projectId,
      workspace.id,
      id,
      document.id,
      document.content_hash,
      contentHash(document.evidence_manifest),
      policyVersion,
      input.review_role,
      scope.actorId,
      input.action,
      input.reason,
    ],
  );
  const updated = await getReview(db, scope, id);
  const state =
    input.action === 'reject'
      ? 'returned'
      : updated.technical_approved && updated.business_approved
        ? 'approved'
        : 'open';
  await db.query('UPDATE app.fs_review_request SET state=$2 WHERE id=$1', [id, state]);
  await db.query('UPDATE app.fs_workspace SET row_version=row_version+1 WHERE id=$1', [
    workspace.id,
  ]);
  return { ...updated, state };
}
