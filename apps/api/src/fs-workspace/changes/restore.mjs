import { failure } from '../../auth.mjs';
import { loadVersion, insertVersion } from '../document/repository.mjs';
import { readWorkspace } from '../workspace/repository.mjs';
import { currentEntities, reviseEntity, snapshotContext } from './entities.mjs';
import { invalidateConfirmations } from '../document/confirmations.mjs';

export async function restoreVersion(db, scope, workspace, input) {
  if (input.base_document_version !== workspace.draft_head)
    throw failure(409, '当前文档已经变化。');
  const source = await loadVersion(db, scope, input.source_version_id);
  const current = await currentEntities(db, scope),
    restored = [];
  for (const entity of current) {
    const target = source.entity_manifest.find((e) => e.id === entity.stable_id);
    if (!target) {
      if (!entity.payload.tombstone)
        await reviseEntity(db, scope, entity, { id: entity.stable_id, tombstone: true });
      continue;
    }
    const {
      rows: [previous],
    } = await db.query(
      'SELECT payload,content_hash FROM app.fs_entity_revision WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND entity_id=$4 AND revision=$5',
      [scope.organizationId, scope.projectId, scope.workspaceId, entity.id, target.revision],
    );
    if (!previous || previous.content_hash !== target.hash)
      throw failure(422, '历史实体清单不完整，无法恢复。');
    const payload =
      entity.kind === 'verification'
        ? { ...previous.payload, status: 'unverified', applicability: 'pending' }
        : previous.payload;
    restored.push(await reviseEntity(db, scope, entity, payload));
  }
  if (restored.length !== source.entity_manifest.length) throw failure(422, '历史实体引用缺失。');
  const map = new Map(restored.map((e) => [e.stable_id, e]));
  for (const entity of restored)
    for (const id of entity.payload.depends_on ?? []) {
      const target = map.get(id);
      if (!target) throw failure(422, '历史依赖不完整。');
      await db.query(
        "INSERT INTO app.fs_dependency(organization_id,project_id,workspace_id,source_entity,source_revision,target_entity,target_revision,relation) VALUES($1,$2,$3,$4,$5,$6,$7,'depends_on')",
        [
          scope.organizationId,
          scope.projectId,
          scope.workspaceId,
          entity.id,
          entity.head_revision,
          target.id,
          target.head_revision,
        ],
      );
    }
  source.entity_manifest = restored.map((e) => ({
    id: e.stable_id,
    revision: String(e.head_revision),
    hash: e.content_hash,
    kind: e.kind,
  }));
  const contextId = await snapshotContext(db, scope, source, source.entity_manifest);
  await invalidateConfirmations(
    db,
    scope,
    current.map((e) => e.stable_id),
    contextId,
  );
  const next = {
    ...structuredClone(source.ast),
    confirmation_refs: [],
    review_refs: [],
    approval_refs: [],
  };
  next.context = { ...next.context, context_snapshot_id: contextId };
  next.verifications = next.verifications.map((v) => ({
    ...v,
    status: 'unverified',
    applicability: 'pending',
    checked_at: null,
    valid_until: null,
    applicability_reason: '历史恢复后需要重新验证',
  }));
  await insertVersion(db, scope, workspace, source, next, {
    legacyManifest: source.legacy_manifest,
  });
  await db.query(
    "UPDATE app.fs_review_request SET state='returned' WHERE workspace_id=$1 AND state IN ('open','approved')",
    [workspace.id],
  );
  await db.query(
    'UPDATE app.fs_workspace SET review_head=NULL,template_version_id=$2 WHERE id=$1',
    [workspace.id, source.template_version_id],
  );
  return readWorkspace(db, scope);
}
