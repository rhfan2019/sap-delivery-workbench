import { randomUUID } from 'node:crypto';
import { failure } from '../../../platform/auth.mjs';
import { loadVersion } from '../document/repository.mjs';
import { appendRunEvent } from './events.mjs';
export const runDto = (row) => ({
  id: row.id,
  status: row.status,
  node_id: row.node_id,
  attempt: row.attempt,
  input_snapshot_id: row.input_snapshot_id,
  last_sequence: String(row.last_sequence ?? 0),
  error_code: row.budget_json?.error_code ?? null,
  updated_at: new Date(row.updated_at).toISOString(),
});

export async function enqueueParse(db, scope, workspace, attachmentId, regionIds) {
  const {
    rows: [attachment],
  } = await db.query(
    'SELECT * FROM app.fs_attachment WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, attachmentId],
  );
  if (!attachment) throw failure(404, '附件不存在或无权访问。');
  if (attachment.scan_status === 'rejected') throw failure(422, '安全扫描拒绝的附件不能解析。');
  if (
    regionIds.some((id) => !/^page:([1-9]|[1-9][0-9]|100)$/.test(id)) ||
    new Set(regionIds).size !== regionIds.length
  )
    throw failure(400, '解析区域无效。');
  if (regionIds.length) throw failure(422, '区域合并重试尚未启用，请重试整个附件。');
  const source = await loadVersion(db, scope, workspace.draft_head);
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO app.fs_run(id,organization_id,project_id,workspace_id,session_id,input_snapshot_id,principal_user_id,principal_session_id,intent,status,node_id,budget_json,is_write)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'attachment_parse','queued','scan_parse',$9,false) RETURNING *`,
    [
      randomUUID(),
      scope.organizationId,
      scope.projectId,
      scope.workspaceId,
      source.ast.context.session_id,
      source.ast.context.context_snapshot_id,
      scope.actorId,
      scope.sessionId,
      {
        attachment_id: attachment.id,
        attachment_hash: attachment.hash,
        region_ids: regionIds,
        max_attempts: 3,
      },
    ],
  );
  await appendRunEvent(db, row, 'run.queued', '附件处理任务已排队。');
  return runDto(row);
}
