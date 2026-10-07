import { randomUUID } from 'node:crypto';
import { failure } from '../../auth.mjs';
import { validateChangeValue } from '../../../../../packages/contracts/fs-workspace/index.mjs';
import { contentHash } from '../document/ast.mjs';

export async function currentEntities(db, scope) {
  return (
    await db.query(
      `SELECT e.id,e.stable_id,e.kind,e.head_revision,r.payload,r.content_hash FROM app.fs_entity e JOIN app.fs_entity_revision r ON r.entity_id=e.id AND r.revision=e.head_revision WHERE e.organization_id=$1 AND e.project_id=$2 AND e.workspace_id=$3`,
      [scope.organizationId, scope.projectId, scope.workspaceId],
    )
  ).rows;
}

export function mapTemporaryIds(operations) {
  const mapping = new Map();
  for (const op of operations)
    if (op.op === 'add') {
      if (!op.target_id.startsWith('tmp:') || mapping.has(op.target_id))
        throw failure(422, '新增候选必须使用唯一的临时 ID。');
      mapping.set(op.target_id, randomUUID());
    }
  const declared = new Set();
  const declare = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) declare(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string' && value.id.startsWith('tmp:')) {
      if (declared.has(value.id)) throw failure(422, '临时 ID 声明必须唯一。');
      declared.add(value.id);
      if (!mapping.has(value.id)) mapping.set(value.id, randomUUID());
    }
    for (const [key, child] of Object.entries(value))
      if (key === 'blocks' || key === 'rows') declare(child);
  };
  for (const op of operations) {
    if (op.value?.id?.startsWith('tmp:') && (op.op !== 'add' || op.value.id !== op.target_id))
      throw failure(422, '操作根 ID 必须与新增目标一致。');
    declare(op.value);
  }
  const rewrite = (value, key = '') => {
    if (Array.isArray(value)) return value.map((v) => rewrite(v, key));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, k)]));
    if (
      typeof value === 'string' &&
      value.startsWith('tmp:') &&
      (key === 'id' || key === 'depends_on' || /_ids?$|_refs$/.test(key))
    ) {
      if (!mapping.has(value)) throw failure(422, '临时引用未在本原子变更中定义。');
      return mapping.get(value);
    }
    return value;
  };
  return operations.map((op) => rewrite(op));
}

export async function reviseEntity(db, scope, entity, payload) {
  const revision = Number(entity.head_revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw failure(409, '实体版本超出契约范围。');
  const data = { ...payload };
  if ('revision' in data) data.revision = revision;
  const hash = contentHash(data);
  await db.query(
    'INSERT INTO app.fs_entity_revision(organization_id,project_id,workspace_id,entity_id,revision,payload,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      scope.organizationId,
      scope.projectId,
      scope.workspaceId,
      entity.id,
      revision,
      data,
      hash,
      scope.actorId,
    ],
  );
  await db.query('UPDATE app.fs_entity SET head_revision=$2 WHERE id=$1', [entity.id, revision]);
  return { ...entity, head_revision: String(revision), payload: data, content_hash: hash };
}

export async function applyEntityOperations(db, scope, ast, operations, affectedIds = []) {
  const entities = await currentEntities(db, scope),
    map = new Map(entities.map((e) => [e.stable_id, e]));
  const next = structuredClone(ast),
    removed = new Set();
  for (const op of operations) {
    if (['section', 'block', 'test'].includes(op.entity_type)) continue;
    let entity = map.get(op.target_id);
    if (op.op === 'add') {
      if (entity || op.before_hash !== null || op.expected_revision !== null)
        throw failure(422, '实体新增目标无效。');
      entity = {
        id: randomUUID(),
        stable_id: op.target_id,
        kind: op.entity_type === 'verification_request' ? 'verification' : op.entity_type,
        head_revision: '0',
      };
      await db.query(
        'INSERT INTO app.fs_entity(id,organization_id,project_id,workspace_id,stable_id,kind) VALUES($1,$2,$3,$4,$5,$6)',
        [
          entity.id,
          scope.organizationId,
          scope.projectId,
          scope.workspaceId,
          entity.stable_id,
          entity.kind,
        ],
      );
    } else if (
      !entity ||
      Number(entity.head_revision) !== op.expected_revision ||
      entity.content_hash !== op.before_hash
    )
      throw failure(409, '实体修订或内容哈希已过期。');
    if (
      entity.kind !== (op.entity_type === 'verification_request' ? 'verification' : op.entity_type)
    )
      throw failure(422, '不能改变实体类型。');
    if (op.op === 'remove') {
      if (op.value !== null) throw failure(422, '删除操作必须有空值。');
      entity = await reviseEntity(db, scope, entity, { id: entity.stable_id, tombstone: true });
      removed.add(entity.stable_id);
    } else {
      if (!validateChangeValue(op.entity_type, op.value).ok || op.value.id !== op.target_id)
        throw failure(422, '操作值与实体类型或 ID 不符。');
      if (
        op.entity_type === 'issue' &&
        (op.value.status !== 'open' || op.value.resolution_ref !== null)
      )
        throw failure(422, '候选不能自行授予问题已解决状态。');
      for (const link of op.value.source_refs ?? []) {
        const result = await db.query(
          'SELECT id FROM app.fs_evidence WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND id::text=$4',
          [scope.organizationId, scope.projectId, scope.workspaceId, link.evidence_id],
        );
        if (!result.rowCount) throw failure(422, '来源证据不存在或不在授权范围内。');
      }
      entity = await reviseEntity(
        db,
        scope,
        entity,
        op.entity_type === 'verification_request'
          ? { ...op.value, status: 'unverified', applicability: 'pending' }
          : op.value,
      );
    }
    map.set(entity.stable_id, entity);
  }
  for (const entity of map.values()) {
    if (entity.payload.tombstone) continue;
    for (const id of entity.payload.depends_on ?? [])
      if (!map.has(id) || map.get(id).payload.tombstone)
        throw failure(422, '实体依赖缺失或仍被删除对象引用。');
    if (
      affectedIds.includes(entity.stable_id) &&
      entity.kind === 'verification' &&
      entity.payload.status === 'verified'
    )
      map.set(
        entity.stable_id,
        await reviseEntity(db, scope, entity, {
          ...entity.payload,
          status: 'unverified',
          applicability: 'pending',
        }),
      );
  }
  const changed = new Set(
    operations
      .filter((op) => !['section', 'block', 'test'].includes(op.entity_type))
      .map((op) => op.target_id),
  );
  for (const entity of map.values())
    if (changed.has(entity.stable_id) && !entity.payload.tombstone) {
      for (const id of entity.payload.depends_on ?? []) {
        const target = map.get(id);
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
    }
  const live = [...map.values()].filter((e) => !e.payload.tombstone);
  for (const [kind, field] of [
    ['requirement', 'requirement_refs'],
    ['rule', 'rule_refs'],
    ['decision', 'decision_refs'],
    ['issue', 'open_issue_ids'],
  ])
    next[field] = live
      .filter((e) => e.kind === kind)
      .map((e) => e.stable_id)
      .sort();
  next.verifications = live
    .filter((e) => e.kind === 'verification')
    .map((e) => ({
      id: e.stable_id,
      target: e.payload.target,
      claim: e.payload.claim,
      object_name: e.payload.candidate_name,
      scope: e.payload.scope,
      status: e.payload.status ?? 'unverified',
      evidence_ids: e.payload.evidence_ids ?? [],
      checked_at: e.payload.checked_at ?? null,
      valid_until: e.payload.valid_until ?? null,
      limitations: e.payload.limitations ?? [],
      applicability: e.payload.applicability ?? 'pending',
      applicability_reason: e.payload.applicability_reason ?? '尚未完成技术验证',
    }));
  return {
    ast: next,
    entities: live,
    manifest: live.map((e) => ({
      id: e.stable_id,
      revision: String(e.head_revision),
      hash: e.content_hash,
      kind: e.kind,
    })),
    changedIds: [...changed],
    removedIds: [...removed],
  };
}

export async function snapshotContext(db, scope, source, manifest) {
  const id = randomUUID();
  const result = await db.query(
    `INSERT INTO app.fs_context_snapshot(id,organization_id,project_id,workspace_id,version_manifest,message_range,config_versions,input_hash,token_budget,coverage)
    SELECT $1,organization_id,project_id,workspace_id,$2,message_range,config_versions,$3,token_budget,coverage FROM app.fs_context_snapshot WHERE organization_id=$4 AND project_id=$5 AND workspace_id=$6 AND id=$7`,
    [
      id,
      JSON.stringify(manifest),
      contentHash(manifest),
      scope.organizationId,
      scope.projectId,
      scope.workspaceId,
      source.ast.context.context_snapshot_id,
    ],
  );
  if (result.rowCount !== 1) throw failure(409, '来源上下文不存在或已超出授权范围。');
  return id;
}
