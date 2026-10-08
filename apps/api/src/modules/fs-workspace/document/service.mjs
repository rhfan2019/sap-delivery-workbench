import { failure } from '../../../platform/auth.mjs';
import { loadVersion, insertVersion, versionHead } from './repository.mjs';
import { validateDocument } from './ast.mjs';

export async function getDocument(db, scope, id) {
  return (await loadVersion(db, scope, id)).ast;
}
export async function snapshotVersion(db, scope, workspace, input) {
  if (input.base_document_version !== workspace.draft_head) throw failure(409, '基础文档已过期。');
  const source = await loadVersion(db, scope, workspace.draft_head);
  const findings = validateDocument(source.ast, source.template, {
    entities: source.entity_manifest,
    evidence: source.evidence_manifest,
  });
  if (findings.some((f) => f.blocking === 'review'))
    throw failure(422, '文档结构或引用错误，不能保存正式编号版本。');
  const row = await insertVersion(db, scope, workspace, source, source.ast, {
    formal: true,
    legacyManifest: source.legacy_manifest,
  });
  return versionHead(row);
}
