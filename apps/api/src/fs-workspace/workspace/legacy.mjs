import { createHash, randomUUID } from 'node:crypto';

// Stable key ordering is part of legacy-json-v1; preserve the original object too.
export function legacyHash(sections) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(sections).sort(([a], [b]) => a.localeCompare(b, 'en'))),
      ),
    )
    .digest('hex');
}
export const legacySlots = [
  { stable_slot: 'overview', title: '开发概述与范围', keys: ['background', 'scope'] },
  { stable_slot: 'io', title: '输入选择与输出', keys: ['inputs', 'outputs'] },
  { stable_slot: 'logic', title: '核心处理逻辑', keys: ['rules', 'exceptions'] },
  { stable_slot: 'authorization', title: '权限设计', keys: ['authorization'] },
  { stable_slot: 'validation', title: '测试验收与技术验证', keys: ['acceptance', 'cases'] },
];

export function convertLegacy(
  source,
  workspace,
  scope,
  { seq, parentId = null, formalNumber = null, context } = {},
) {
  const id = randomUUID();
  const sections = source.sections;
  if (
    !sections ||
    typeof sections !== 'object' ||
    Array.isArray(sections) ||
    Object.values(sections).some((v) => typeof v !== 'string')
  )
    throw new Error('Legacy sections must be text');
  const known = new Set(legacySlots.flatMap((slot) => slot.keys));
  const slots = legacySlots.map((slot) => ({ ...slot, keys: [...slot.keys] }));
  // Preserve unexpected historic keys without silently dropping content.
  slots[0].keys.push(
    ...Object.keys(sections)
      .filter((key) => !known.has(key))
      .sort(),
  );
  const manifest = {
    source_id: source.id ?? scope.itemId,
    source_kind: source.id ? 'fs_version' : 'fs_draft',
    source_version: source.version_number ?? null,
    hash_algorithm: 'legacy-json-v1/sha256',
    sha256: legacyHash(sections),
    sections,
    approval_source: source.is_baseline ? 'legacy_submission' : null,
  };
  const ast = {
    schema_version: '1.0.0',
    context: {
      workspace_id: workspace.id,
      session_id: context.sessionId,
      run_id: context.runId,
      document_id: id,
      base_document_version: parentId,
      context_snapshot_id: context.snapshotId,
      template_id: 'traditional-abap-five',
      template_version: '1.0.0',
    },
    id,
    revision: seq,
    version_number: formalNumber ?? 0,
    title: workspace.fs_number,
    content_hash: manifest.sha256,
    lifecycle: 'draft',
    sections: slots.map((slot) => ({
      id: `legacy-section-${slot.stable_slot}`,
      template_slot: slot.stable_slot,
      title: slot.title,
      blocks: slot.keys
        .filter((key) => key in sections)
        .map((key) => ({
          id: `legacy-${key}`,
          kind: key === 'exceptions' ? 'callout' : 'paragraph',
          text: sections[key],
          columns: [],
          rows: [],
          classification: 'pending',
          requirement_ids: [],
          rule_ids: [],
          decision_ids: [],
          evidence_refs: [],
        })),
    })),
    tests: [],
    requirement_refs: [],
    rule_refs: [],
    decision_refs: [],
    open_issue_ids: [],
    verifications: [],
    confirmation_refs: [],
    review_refs: [],
    approval_refs: [],
    evidence_manifest_ids: [],
    created_at: new Date().toISOString(),
    created_by: scope.actorId,
  };
  return { id, seq, parentId, formalNumber, ast, manifest };
}
