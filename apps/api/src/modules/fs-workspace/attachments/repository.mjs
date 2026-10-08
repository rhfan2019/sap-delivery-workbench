import { failure } from '../../../platform/auth.mjs';
export async function shouldDiscardUpload(db, id) {
  try {
    return (await db.query('SELECT id FROM app.fs_attachment WHERE id=$1', [id])).rowCount === 0;
  } catch {
    return false;
  }
}
export const attachmentDto = (row) => ({
  id: row.id,
  name: row.name,
  size_bytes: row.size,
  mime: row.mime,
  sha256: row.hash,
  scan_state: row.scan_status,
  parse_result: null,
  created_at: new Date(row.created_at).toISOString(),
});
export async function persistUpload(db, scope, uploadId, blob) {
  const args = [scope.organizationId, scope.projectId, scope.workspaceId];
  const {
    rows: [old],
  } = await db.query(
    'SELECT * FROM app.fs_attachment WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND client_upload_id=$4',
    [...args, uploadId],
  );
  if (old) {
    if (
      old.hash !== blob.sha256 ||
      old.name !== blob.name ||
      old.mime !== blob.mime ||
      old.size !== blob.size_bytes
    )
      throw failure(409, '同一上传 ID 不能提交不同文件。');
    return attachmentDto(old);
  }
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO app.fs_attachment(id,organization_id,project_id,workspace_id,client_upload_id,blob_key,hash,size,mime,name,scan_status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'quarantined',$11) RETURNING *`,
    [
      blob.id,
      ...args,
      uploadId,
      blob.blob_key,
      blob.sha256,
      blob.size_bytes,
      blob.mime,
      blob.name,
      scope.actorId,
    ],
  );
  return attachmentDto(row);
}

export async function readAttachments(db, scope) {
  return await db.query(
    `SELECT a.id,a.name,a.size AS size_bytes,a.mime,a.hash AS sha256,a.scan_status AS scan_state,a.created_at,
    (SELECT jsonb_build_object('id',p.id,'attachment_id',p.attachment_id,'revision',p.revision::text,'parser_version',p.parser_version,'state',p.state,'regions',p.regions,'unread_regions',p.coverage->'unread_regions','warnings',p.warnings,'created_at',p.created_at) FROM app.fs_parse_result p WHERE p.organization_id=a.organization_id AND p.project_id=a.project_id AND p.workspace_id=a.workspace_id AND p.attachment_id=a.id ORDER BY revision DESC LIMIT 1) AS parse_result
    FROM app.fs_attachment a WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 ORDER BY created_at,id`,
    [scope.organizationId, scope.projectId, scope.workspaceId],
  );
}
