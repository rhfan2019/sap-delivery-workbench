import { readAttachments } from '../attachments/repository.mjs';
export const scopeValues = (scope) => [scope.organizationId, scope.projectId, scope.itemId];

export async function findWorkspace(db, scope) {
  return (
    (
      await db.query(
        'SELECT * FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND active',
        scopeValues(scope),
      )
    ).rows[0] ?? null
  );
}

export async function insertLegacyRevision(db, scope, workspace, revision) {
  const { id, seq, parentId, formalNumber, ast, manifest } = revision;
  await db.query(
    `INSERT INTO app.fs_document_revision(id,organization_id,project_id,workspace_id,seq,formal_number,parent_id,template_version_id,ast,entity_manifest,evidence_manifest,content_hash,legacy_manifest,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]','[]',$10,$11,$12)`,
    [
      id,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      seq,
      formalNumber,
      parentId,
      workspace.template_version_id,
      ast,
      ast.content_hash,
      manifest,
      scope.actorId,
    ],
  );
}

export async function readWorkspace(db, scope) {
  const workspace = await findWorkspace(db, scope);
  if (!workspace) return null;
  const { rows } = await db.query(
    'SELECT id,seq::text AS revision,formal_number,content_hash FROM app.fs_document_revision WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=ANY($4::uuid[])',
    [
      scope.organizationId,
      scope.projectId,
      workspace.id,
      [workspace.draft_head, workspace.review_head, workspace.baseline_head].filter(Boolean),
    ],
  );
  const head = (id) => rows.find((row) => row.id === id) ?? null;
  const {
    rows: [template],
  } = await db.query(
    'SELECT template_key,version FROM app.fs_template_version WHERE organization_id=$1 AND id=$2',
    [scope.organizationId, workspace.template_version_id],
  );
  return {
    id: workspace.id,
    fs_number: workspace.fs_number,
    profile: workspace.profile,
    template_id: template.template_key,
    template_version: template.version,
    draft_head: head(workspace.draft_head),
    review_head: head(workspace.review_head),
    baseline_head: head(workspace.baseline_head),
    revision: String(workspace.row_version),
  };
}

export async function readCollections(db, scope, workspaceId) {
  if (!workspaceId) return { sessions: [], active_runs: [], attachments: [], issues: [] };
  const values = [scope.organizationId, scope.projectId, workspaceId];
  const sessions = await db.query(
    'SELECT id,title,created_at,(archived_at IS NOT NULL) AS archived FROM app.fs_session WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 ORDER BY created_at,id LIMIT 30',
    values,
  );
  const runs = await db.query(
    "SELECT r.id,r.status,r.node_id,r.attempt,r.input_snapshot_id,coalesce((SELECT max(e.sequence) FROM app.fs_run_event e WHERE e.run_id=r.id),0)::text AS last_sequence,r.budget_json->>'error_code' AS error_code,r.updated_at FROM app.fs_run r WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND status IN ('queued','running','waiting_user','waiting_evidence','cancel_requested') ORDER BY created_at,id",
    values,
  );
  const attachments = await readAttachments(db, { ...scope, workspaceId });
  const issues = await db.query(
    "SELECT r.payload FROM app.fs_entity e JOIN app.fs_entity_revision r ON r.entity_id=e.id AND r.revision=e.head_revision AND r.organization_id=e.organization_id AND r.project_id=e.project_id AND r.workspace_id=e.workspace_id WHERE e.organization_id=$1 AND e.project_id=$2 AND e.workspace_id=$3 AND e.kind='issue' ORDER BY e.stable_id",
    values,
  );
  return {
    sessions: sessions.rows,
    active_runs: runs.rows,
    attachments: attachments.rows,
    issues: issues.rows.map((row) => row.payload),
  };
}
