import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { failure } from '../../../platform/auth.mjs';
import { loadVersion } from '../document/repository.mjs';
import { contentHash } from '../document/ast.mjs';
import { toRenderModel } from './render-model.mjs';
import { appendRunEvent } from '../runs/events.mjs';
import { getReview } from '../review/service.mjs';
export const exportDto = (row) => ({
  id: row.id,
  document_version_id: row.document_revision_id,
  format: row.format,
  status: row.status,
  manifest_hash: row.manifest_hash,
  content_hash: row.hash,
  error_code: row.error_code,
});
export async function getExport(db, scope, id) {
  const {
    rows: [row],
  } = await db.query(
    'SELECT * FROM app.fs_export WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!row) throw failure(404, '导出不存在或无权访问。');
  return row;
}
export async function createExport(db, scope, workspace, input) {
  const document = await loadVersion(db, scope, input.document_version_id),
    model = toRenderModel(document.ast, document.template);
  const watermark = await exportWatermark(db, scope, workspace, document);
  let fontVersion = 'unconfigured';
  if (process.env.FS_FONT_FILE)
    fontVersion = createHash('sha256')
      .update(await readFile(process.env.FS_FONT_FILE))
      .digest('hex');
  const fixed = {
    document_version_id: document.id,
    content_hash: document.content_hash,
    template_version: document.template.version,
    renderer_version: document.template.renderer_version,
    font_pack_version: fontVersion,
    format: input.format,
    render_model_hash: contentHash(model),
    evidence_manifest_hash: contentHash(document.evidence_manifest),
    watermark_policy: watermark,
  };
  const hash = contentHash(fixed);
  const {
    rows: [existing],
  } = await db.query(
    'SELECT * FROM app.fs_export WHERE workspace_id=$1 AND document_revision_id=$2 AND format=$3 AND manifest_hash=$4',
    [workspace.id, document.id, input.format, hash],
  );
  if (existing) return exportDto(existing);
  const id = randomUUID(),
    manifest = { id, ...fixed, created_by: scope.actorId, created_at: new Date().toISOString() };
  const {
    rows: [row],
  } = await db.query(
    "INSERT INTO app.fs_export(id,organization_id,project_id,workspace_id,document_revision_id,format,manifest_hash,status,requested_by,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9) RETURNING *",
    [
      id,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      document.id,
      input.format,
      hash,
      scope.actorId,
      manifest,
    ],
  );
  const {
    rows: [run],
  } = await db.query(
    `INSERT INTO app.fs_run(organization_id,project_id,workspace_id,session_id,input_snapshot_id,principal_user_id,principal_session_id,intent,status,node_id,budget_json,is_write)
    VALUES($1,$2,$3,$4,$5,$6,$7,'export','queued','render_export',$8,false) RETURNING *`,
    [
      scope.organizationId,
      scope.projectId,
      workspace.id,
      document.ast.context.session_id,
      document.ast.context.context_snapshot_id,
      scope.actorId,
      scope.sessionId,
      { export_id: id, max_attempts: 3 },
    ],
  );
  await appendRunEvent(db, run, 'run.queued', '固定版本导出已排队。', { entity_ids: [id] });
  return exportDto(row);
}

async function exportWatermark(db, scope, workspace, document) {
  let watermark = 'discussion';
  const {
    rows: [publication],
  } = await db.query(
    'SELECT action FROM app.fs_publication WHERE workspace_id=$1 AND document_revision_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
    [workspace.id, document.id],
  );
  if (publication?.action === 'withdraw') watermark = 'withdrawn';
  else if (publication && workspace.baseline_head !== document.id) watermark = 'superseded';
  else if (document.legacy_manifest?.approval_source) watermark = 'legacy_submission';
  else {
    const {
      rows: [review],
    } = await db.query(
      "SELECT id FROM app.fs_review_request WHERE workspace_id=$1 AND document_revision_id=$2 AND state='approved' ORDER BY created_at DESC LIMIT 1",
      [workspace.id, document.id],
    );
    if (review) {
      const result = await getReview(db, scope, review.id);
      if (
        result.technical_approved &&
        result.business_approved &&
        result.gates.every((g) => g.passed || g.blocking === 'none')
      )
        watermark = 'approved';
    }
  }
  return watermark;
}
export async function assertCurrentExport(db, scope, entry) {
  const {
    rows: [workspace],
  } = await db.query(
    'SELECT * FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND active',
    [scope.organizationId, scope.projectId, scope.workspaceId],
  );
  if (!workspace) throw failure(404, '工作区不可访问。');
  const document = await loadVersion(db, scope, entry.document_revision_id);
  if ((await exportWatermark(db, scope, workspace, document)) !== entry.manifest.watermark_policy)
    throw new Error('EXPORT_AUTHORITY_CHANGED');
}
