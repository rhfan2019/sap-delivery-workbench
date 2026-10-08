import { randomUUID } from 'node:crypto';
import { failure } from '../../../platform/auth.mjs';
import { getReview, policyVersion } from './service.mjs';
import { loadVersion } from '../document/repository.mjs';
import { contentHash } from '../document/ast.mjs';
import { readWorkspace } from '../workspace/repository.mjs';

async function appendPublication(db, scope, workspace, documentId, action, reason = '') {
  const {
    rows: [previous],
  } = await db.query(
    'SELECT id FROM app.fs_publication WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
    [workspace.id],
  );
  await db.query(
    'INSERT INTO app.fs_publication(id,organization_id,project_id,workspace_id,document_revision_id,previous_id,actor_id,action,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      randomUUID(),
      scope.organizationId,
      scope.projectId,
      workspace.id,
      documentId,
      previous?.id ?? null,
      scope.actorId,
      action,
      reason,
    ],
  );
  await db.query(
    'UPDATE app.fs_workspace SET baseline_head=$2,row_version=row_version+1 WHERE id=$1',
    [workspace.id, action === 'publish' ? documentId : null],
  );
  await db.query(
    'UPDATE app.development_item SET stage=$2,row_version=row_version+1,updated_at=clock_timestamp() WHERE id=$1',
    [scope.itemId, action === 'publish' ? 'ready' : 'fs_draft'],
  );
  return readWorkspace(db, scope);
}

// executeCommand owns project/workspace locks, authorization, ETag and idempotent audit.
export async function publishBaseline(db, scope, workspace, input) {
  if (input.expected_baseline_id !== workspace.baseline_head)
    throw failure(409, '当前发布基线已变化。');
  const review = await getReview(db, scope, input.review_id);
  if (
    input.document_version_id !== review.document_version_id ||
    workspace.review_head !== review.document_version_id ||
    review.policy_version !== policyVersion
  )
    throw failure(409, '发布版本或政策与送审版本不一致。');
  if (
    review.state !== 'approved' ||
    !review.technical_approved ||
    !review.business_approved ||
    review.gates.some((g) => !g.passed && g.blocking !== 'none')
  )
    throw failure(422, '需满足全部发布门禁及两角色批准。');
  const document = await loadVersion(db, scope, review.document_version_id);
  const { rows: approvals } = await db.query(
    'SELECT DISTINCT ON(role) * FROM app.fs_approval WHERE review_request_id=$1 ORDER BY role,created_at DESC,id DESC',
    [review.id],
  );
  if (
    approvals.length !== 2 ||
    approvals.some(
      (a) =>
        a.action !== 'approve' ||
        a.document_revision_id !== document.id ||
        a.document_hash !== document.content_hash ||
        a.manifest_hash !== contentHash(document.evidence_manifest) ||
        a.policy_version !== policyVersion,
    )
  )
    throw failure(422, '审批未绑定当前文档、证据或政策。');
  return appendPublication(db, scope, workspace, document.id, 'publish');
}

export async function withdrawBaseline(db, scope, workspace, input) {
  if (!workspace.baseline_head || workspace.baseline_head !== input.document_version_id)
    throw failure(409, '待撤回版本不是当前发布基线。');
  if (!input.reason.trim()) throw failure(400, '请填写撤回原因。');
  return appendPublication(
    db,
    scope,
    workspace,
    input.document_version_id,
    'withdraw',
    input.reason.trim(),
  );
}
