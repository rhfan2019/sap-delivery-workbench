import { randomUUID } from 'node:crypto';
import { contentHash } from '../../../apps/api/src/fs-workspace/document/ast.mjs';
export async function candidate(f, workspace, operations, groups) {
  const {
    rows: [document],
  } = await f.db.query('SELECT ast FROM app.fs_document_revision WHERE id=$1', [
    workspace.draft_head.id,
  ]);
  const id = randomUUID();
  const proposal = {
    schema_version: '1.0.0',
    context: { ...document.ast.context, base_document_version: workspace.draft_head.id },
    change_set_id: id,
    reason: 'synthetic candidate',
    operations,
    impacts: [],
    atomic_groups: groups ?? [
      { id: 'all', operation_target_ids: operations.map((o) => o.target_id), reason: 'atomic' },
    ],
    new_issue_ids: [],
  };
  await f.db.query(
    "INSERT INTO app.fs_change_set(id,organization_id,project_id,workspace_id,base_revision_id,proposal,hash,status) VALUES($1,$2,$3,$4,$5,$6,$7,'proposed')",
    [
      id,
      f.scope.organizationId,
      f.scope.projectId,
      workspace.id,
      workspace.draft_head.id,
      proposal,
      contentHash(proposal),
    ],
  );
  return proposal;
}
