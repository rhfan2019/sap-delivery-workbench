import { randomUUID } from 'node:crypto';
import { failure } from '../../auth.mjs';
import { loadVersion, insertVersion } from './repository.mjs';
import { readWorkspace } from '../workspace/repository.mjs';

export async function invalidateConfirmations(db, scope, stableIds, contextId) {
  const { rows } = await db.query(
    `SELECT c.* FROM app.fs_confirmation c JOIN app.fs_entity e ON e.id=c.subject_id
    WHERE c.organization_id=$1 AND c.project_id=$2 AND c.workspace_id=$3 AND e.stable_id=ANY($4::text[]) AND c.action='confirm'
    AND NOT EXISTS(SELECT 1 FROM app.fs_confirmation next WHERE next.supersedes_id=c.id)`,
    [scope.organizationId, scope.projectId, scope.workspaceId, stableIds],
  );
  for (const previous of rows)
    await db.query(
      "INSERT INTO app.fs_confirmation(organization_id,project_id,workspace_id,subject_id,subject_revision,subject_hash,action,supersedes_id,actor_id,context_snapshot_id,intent) VALUES($1,$2,$3,$4,$5,$6,'invalidate',$7,$8,$9,$10)",
      [
        scope.organizationId,
        scope.projectId,
        scope.workspaceId,
        previous.subject_id,
        previous.subject_revision,
        previous.subject_hash,
        previous.id,
        scope.actorId,
        contextId,
        { reason: 'dependency_changed' },
      ],
    );
  return rows.map((row) => row.id);
}

export async function confirmSubject(db, scope, workspace, input) {
  const {
    rows: [entity],
  } = await db.query(
    `SELECT e.id,e.head_revision,r.content_hash FROM app.fs_entity e JOIN app.fs_entity_revision r ON r.entity_id=e.id AND r.revision=e.head_revision WHERE e.organization_id=$1 AND e.project_id=$2 AND e.workspace_id=$3 AND e.stable_id=$4 AND e.kind IN ('requirement','rule','decision')`,
    [scope.organizationId, scope.projectId, scope.workspaceId, input.subject_id],
  );
  if (!entity) throw failure(404, '确认对象不存在或无权访问。');
  if (
    String(entity.head_revision) !== input.subject_revision ||
    entity.content_hash !== input.subject_hash
  )
    throw failure(409, '确认对象已经变化，请确认新的内容。');
  const {
    rows: [snapshot],
  } = await db.query(
    'SELECT version_manifest FROM app.fs_context_snapshot WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id=$4',
    [scope.organizationId, scope.projectId, scope.workspaceId, input.context_snapshot_id],
  );
  if (
    !snapshot ||
    !snapshot.version_manifest.some(
      (e) =>
        e.id === input.subject_id &&
        String(e.revision) === input.subject_revision &&
        e.hash === input.subject_hash,
    )
  )
    throw failure(409, '确认上下文不包含此对象修订。');
  const source = await loadVersion(db, scope, workspace.draft_head);
  if (
    !source.entity_manifest.some(
      (e) =>
        e.id === input.subject_id &&
        e.hash === input.subject_hash &&
        String(e.revision) === input.subject_revision,
    )
  )
    throw failure(409, '确认对象不是当前文档所引用修订。');
  const {
    rows: [previous],
  } = await db.query(
    'SELECT id FROM app.fs_confirmation WHERE workspace_id=$1 AND subject_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
    [workspace.id, entity.id],
  );
  const id = randomUUID();
  await db.query(
    "INSERT INTO app.fs_confirmation(id,organization_id,project_id,workspace_id,subject_id,subject_revision,subject_hash,action,supersedes_id,actor_id,context_snapshot_id,intent) VALUES($1,$2,$3,$4,$5,$6,$7,'confirm',$8,$9,$10,$11)",
    [
      id,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      entity.id,
      input.subject_revision,
      input.subject_hash,
      previous?.id ?? null,
      scope.actorId,
      input.context_snapshot_id,
      { choice_id: input.choice_id, decision_text: input.decision_text },
    ],
  );
  const next = {
    ...source.ast,
    confirmation_refs: [...source.ast.confirmation_refs.filter((ref) => ref !== previous?.id), id],
  };
  await insertVersion(db, scope, workspace, source, next);
  return { confirmation_id: id, workspace: await readWorkspace(db, scope) };
}
