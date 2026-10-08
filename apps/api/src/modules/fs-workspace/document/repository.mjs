import { randomUUID } from 'node:crypto';
import { failure } from '../../../platform/auth.mjs';
import { documentHash } from './ast.mjs';

export async function loadVersion(db, scope, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? ''))
    throw failure(404, '文档版本不存在或无权访问。');
  const { rows } = await db.query(
    `SELECT d.*,to_jsonb(t) AS template FROM app.fs_document_revision d JOIN app.fs_template_version t ON t.id=d.template_version_id AND t.organization_id=d.organization_id
    WHERE d.organization_id=$1 AND d.project_id=$2 AND d.workspace_id=$3 AND d.id=$4`,
    [scope.organizationId, scope.projectId, scope.workspaceId, id],
  );
  if (!rows.length) throw failure(404, '文档版本不存在或无权访问。');
  return rows[0];
}
export function versionHead(row) {
  return {
    id: row.id,
    revision: String(row.seq),
    formal_number: row.formal_number,
    content_hash: row.content_hash,
  };
}

// Requires the workspace row lock held by executeCommand. All new content is immutable.
export async function insertVersion(
  db,
  scope,
  workspace,
  source,
  ast,
  { formal = false, legacyManifest = null } = {},
) {
  const {
    rows: [max],
  } = await db.query(
    'SELECT coalesce(max(seq),0)::text AS seq,coalesce(max(formal_number),0) AS formal FROM app.fs_document_revision WHERE workspace_id=$1',
    [workspace.id],
  );
  const seq = BigInt(max.seq) + 1n;
  if (seq > BigInt(Number.MAX_SAFE_INTEGER) || max.formal >= 2147483647)
    throw failure(409, '版本序列超出当前契约范围。');
  const id = randomUUID(),
    number = formal ? max.formal + 1 : null;
  const next = {
    ...structuredClone(ast),
    id,
    revision: Number(seq),
    version_number: number ?? 0,
    lifecycle: 'draft',
    created_by: scope.actorId,
    created_at: new Date().toISOString(),
    approval_refs: [],
    review_refs: [],
  };
  next.context = { ...next.context, document_id: id, base_document_version: source.id };
  next.content_hash = documentHash(next, source.template);
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO app.fs_document_revision(id,organization_id,project_id,workspace_id,seq,formal_number,parent_id,template_version_id,ast,entity_manifest,evidence_manifest,content_hash,created_by,legacy_manifest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      id,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      seq.toString(),
      number,
      workspace.draft_head,
      source.template_version_id,
      next,
      JSON.stringify(source.entity_manifest),
      JSON.stringify(source.evidence_manifest),
      next.content_hash,
      scope.actorId,
      legacyManifest,
    ],
  );
  await db.query(
    'UPDATE app.fs_workspace SET draft_head=$2,row_version=row_version+1 WHERE id=$1',
    [workspace.id, id],
  );
  return row;
}
