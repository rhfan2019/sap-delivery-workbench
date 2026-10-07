import { randomUUID } from 'node:crypto';
import { failure } from '../auth.mjs';
import { findWorkspace } from '../fs-workspace/workspace/repository.mjs';
import { createWorkspace } from '../fs-workspace/workspace/service.mjs';
import {
  validDocument,
  renderDocument,
} from '../../../../packages/contracts/item-workspace/document.mjs';
import { sha256 } from '../abap-fsd-agent/specification.mjs';

export const viewVersion = (r) =>
  r
    ? {
        id: r.id,
        revision: r.revision,
        document: r.document,
        markdown: r.markdown,
        contentHash: r.content_hash,
        designVersionId: r.design_version_id,
        sourceArtifactId: r.source_artifact_id,
        createdAt: r.created_at,
      }
    : null;
export async function head(db, workspaceId, stage) {
  return (
    (
      await db.query(
        'SELECT * FROM app.item_work_version WHERE workspace_id=$1 AND stage=$2 ORDER BY revision DESC LIMIT 1',
        [workspaceId, stage],
      )
    ).rows[0] ?? null
  );
}
export async function version(db, workspaceId, id, stage) {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw failure(400, '版本标识无效。');
  const r = (
    await db.query(
      'SELECT * FROM app.item_work_version WHERE workspace_id=$1 AND stage=$2 AND id=$3',
      [workspaceId, stage, id],
    )
  ).rows[0];
  if (!r) throw failure(404, '版本不存在或不属于本开发项与阶段。');
  return r;
}
export async function appendVersion(db, scope, workspace, stage, input, initial = false) {
  await db.query('SELECT id FROM app.fs_workspace WHERE id=$1 FOR UPDATE', [workspace.id]);
  const old = await head(db, workspace.id, stage);
  if (!initial && (!old || old.id !== input.baseVersionId))
    throw failure(409, '草稿已被更新，请保留本地修改并读取最新版本后合并。');
  if (initial && old) return old;
  const document = input.document;
  if (!validDocument(document, stage))
    throw failure(422, '内容不符合阶段文档合同，请检查字段与引用。');
  const designId =
    stage === 'development'
      ? input.designVersionId === undefined
        ? (old?.design_version_id ?? null)
        : input.designVersionId
      : null;
  if (designId) await version(db, workspace.id, designId, 'design');
  const id = randomUUID();
  const { rows } = await db.query(
    'INSERT INTO app.item_work_version(id,workspace_id,stage,revision,document,markdown,content_hash,design_version_id,source_artifact_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [
      id,
      workspace.id,
      stage,
      (old?.revision ?? 0) + 1,
      document,
      renderDocument(document),
      sha256(document),
      designId,
      input.sourceArtifactId ?? null,
      scope.actorId,
    ],
  );
  return rows[0];
}
export async function initialize(db, scope, stage, item) {
  let workspace = await findWorkspace(db, scope);
  if (!workspace) {
    await createWorkspace(db, scope, {
      template_id: 'traditional-abap-five',
      template_version: '1.0.0',
      profile: 'report',
      legacy_source_id: null,
    });
    workspace = await findWorkspace(db, scope);
  }
  if (!(await head(db, workspace.id, stage))) {
    let document;
    let sourceArtifactId = null;
    if (stage === 'design') {
      const legacy = (
        await db.query('SELECT ast FROM app.fs_document_revision WHERE id=$1', [
          workspace.draft_head,
        ])
      ).rows[0]?.ast;
      const notes =
        legacy?.sections
          .filter((s) => !/权限|authorization/i.test(s.title + s.template_slot))
          .map(
            (s) =>
              s.title + '\n' + s.blocks.map((b) => b.text ?? JSON.stringify(b.rows)).join('\n'),
          )
          .join('\n\n') ?? '';
      document = { kind: stage, spec: null, notes: workspace.assistant_reset_at ? '' : notes };
    } else
      document = {
        kind: stage,
        title: item.name + ' · 开发工作稿',
        overview: '',
        technicalDesign: '',
        code: '',
        tests: '',
        notes: '',
      };
    await appendVersion(db, scope, workspace, stage, { document, sourceArtifactId }, true);
  }
  return workspace;
}
export async function snapshot(db, scope, stage, item, canEdit) {
  const workspace = await findWorkspace(db, scope);
  const current = workspace && (await head(db, workspace.id, stage));
  const design = workspace && (await head(db, workspace.id, 'design'));
  const basis = current?.design_version_id
    ? await version(db, workspace.id, current.design_version_id, 'design')
    : null;
  const versions = workspace
    ? (
        await db.query(
          'SELECT id,revision,created_at FROM app.item_work_version WHERE workspace_id=$1 AND stage=$2 ORDER BY revision DESC',
          [workspace.id, stage],
        )
      ).rows
    : [];
  return {
    stage,
    canEdit,
    workspaceId: workspace?.id ?? null,
    project: { id: scope.projectId, name: scope.projectName ?? '' },
    item: {
      id: item.id,
      code: item.code,
      name: item.name,
      module: item.module,
      kind: item.kind,
      summary: item.summary,
      acceptance: item.acceptance,
      rowVersion: String(item.row_version),
    },
    head: viewVersion(current),
    versions,
    designHead: viewVersion(design),
    designBasis: viewVersion(basis),
    designChanged: !!basis && basis.id !== design?.id,
  };
}
