import { randomUUID } from 'node:crypto';
import { failure } from '../../auth.mjs';
import {
  validateCommand,
  validateDomain,
} from '../../../../../packages/contracts/fs-workspace/index.mjs';
import { findWorkspace, insertLegacyRevision, readWorkspace, scopeValues } from './repository.mjs';
import { convertLegacy, legacySlots, legacyHash } from './legacy.mjs';
import { documentHash } from '../document/ast.mjs';

// Caller owns the transaction and authenticated project scope. Never accept scope from a request body.
export async function createWorkspace(db, scope, command) {
  if (!validateCommand('createFsWorkspace', command).ok) throw failure(400, '无效工作区输入。');
  if (command.template_id !== 'traditional-abap-five' || command.template_version !== '1.0.0')
    throw failure(422, '模板版本不可用。');
  const { rows: items } = await db.query(
    'SELECT id FROM app.development_item WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND deleted_at IS NULL FOR UPDATE',
    scopeValues(scope),
  );
  if (!items.length) throw failure(404, '开发项不存在或无权访问。');
  if (await findWorkspace(db, scope)) return readWorkspace(db, scope);
  const { rows: drafts } = await db.query(
    'SELECT * FROM app.fs_draft WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 FOR UPDATE',
    scopeValues(scope),
  );
  if (!drafts.length) throw failure(409, '旧 FS 草稿不可用。');
  const draft = drafts[0];
  const { rows: versions } = await db.query(
    'SELECT * FROM app.fs_version WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 ORDER BY version_number',
    scopeValues(scope),
  );
  if (command.legacy_source_id && !versions.some((v) => v.id === command.legacy_source_id))
    throw failure(404, '历史版本不存在或无权访问。');
  if (draft.submitted_version_id && !versions.some((v) => v.id === draft.submitted_version_id))
    throw failure(409, '历史基线引用损坏，需修复后迁移。');
  const templateId = randomUUID();
  await db.query(
    `INSERT INTO app.fs_template_version(id,organization_id,template_key,version,schema_version,slots,ruleset_version,renderer_version,hash)
    VALUES($1,$2,'traditional-abap-five','1.0.0','1.0.0',$3,'1.0.0','1.0.0',$4) ON CONFLICT(organization_id,template_key,version) DO NOTHING`,
    [
      templateId,
      scope.organizationId,
      JSON.stringify(legacySlots),
      legacyHash({ slots: JSON.stringify(legacySlots) }),
    ],
  );
  const { rows: templates } = await db.query(
    "SELECT * FROM app.fs_template_version WHERE organization_id=$1 AND template_key='traditional-abap-five' AND version='1.0.0'",
    [scope.organizationId],
  );
  const workspace = {
    id: randomUUID(),
    fs_number: draft.fs_number,
    template_version_id: templates[0].id,
  };
  await db.query(
    `INSERT INTO app.fs_workspace(id,organization_id,project_id,item_id,fs_number,profile,template_version_id,legacy_source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      workspace.id,
      ...scopeValues(scope),
      workspace.fs_number,
      command.profile,
      workspace.template_version_id,
      command.legacy_source_id,
    ],
  );
  const context = { sessionId: randomUUID(), snapshotId: randomUUID(), runId: randomUUID() };
  await db.query(
    'INSERT INTO app.fs_session(id,organization_id,project_id,workspace_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',
    [
      context.sessionId,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      '历史 FS 导入',
      scope.actorId,
    ],
  );
  await db.query(
    `INSERT INTO app.fs_context_snapshot(id,organization_id,project_id,workspace_id,version_manifest,message_range,config_versions,input_hash,token_budget,coverage)
    VALUES($1,$2,$3,$4,$5,'[]',$6,$7,1,$8)`,
    [
      context.snapshotId,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      JSON.stringify(
        versions.map((version) => ({
          id: version.id,
          revision: String(version.version_number),
          hash: legacyHash(version.sections),
        })),
      ),
      {
        template_version: '1.0.0',
        schema_version: '1.0.0',
        migration_version: 'legacy-json-v1',
        model_version_id: null,
      },
      legacyHash(draft.sections),
      {
        source: 'legacy_database',
        complete: true,
        version_count: versions.length,
        draft_included: true,
      },
    ],
  );
  await db.query(
    `INSERT INTO app.fs_run(id,organization_id,project_id,workspace_id,session_id,input_snapshot_id,principal_user_id,principal_session_id,intent,status,node_id,budget_json,is_write)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'legacy_import','running','import',$9,false)`,
    [
      context.runId,
      scope.organizationId,
      scope.projectId,
      workspace.id,
      context.sessionId,
      context.snapshotId,
      scope.actorId,
      scope.sessionId,
      { external_calls: 0 },
    ],
  );
  let seq = 0,
    parentId = null,
    baselineId = null;
  const imported = new Map();
  for (const source of versions) {
    const revision = convertLegacy(
      { ...source, is_baseline: source.id === draft.submitted_version_id },
      workspace,
      scope,
      { seq: ++seq, parentId, formalNumber: source.version_number, context },
    );
    if (!validateDomain('FsDocument', revision.ast).ok)
      throw new Error('Legacy AST validation failed');
    revision.ast.content_hash = documentHash(revision.ast, templates[0]);
    await insertLegacyRevision(db, scope, workspace, revision);
    imported.set(source.id, revision.id);
    if (source.id === draft.submitted_version_id) baselineId = revision.id;
    parentId = revision.id;
  }
  const source = command.legacy_source_id
    ? versions.find((v) => v.id === command.legacy_source_id)
    : draft;
  const revision = convertLegacy(source, workspace, scope, {
    context,
    seq: ++seq,
    parentId: command.legacy_source_id ? imported.get(command.legacy_source_id) : parentId,
  });
  if (!validateDomain('FsDocument', revision.ast).ok)
    throw new Error('Legacy AST validation failed');
  revision.ast.content_hash = documentHash(revision.ast, templates[0]);
  await insertLegacyRevision(db, scope, workspace, revision);
  await db.query(
    'UPDATE app.fs_workspace SET draft_head=$2,baseline_head=$3,legacy_imported_at=now() WHERE id=$1',
    [workspace.id, revision.id, baselineId],
  );
  await db.query("UPDATE app.fs_run SET status='completed',updated_at=now() WHERE id=$1", [
    context.runId,
  ]);
  return readWorkspace(db, scope);
}

export { readWorkspace };
