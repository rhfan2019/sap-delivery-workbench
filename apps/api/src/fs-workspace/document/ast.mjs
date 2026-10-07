import { createHash } from 'node:crypto';
import { validateDomain } from '../../../../../packages/contracts/fs-workspace/index.mjs';

import { canonicalJson } from '../../../../../packages/contracts/fs-workspace/canonical.mjs';
export { canonicalJson };
export const contentHash = (value) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export function documentContent(ast, template) {
  const keys = [
    'title',
    'sections',
    'tests',
    'requirement_refs',
    'rule_refs',
    'decision_refs',
    'open_issue_ids',
    'verifications',
    'confirmation_refs',
    'evidence_manifest_ids',
  ];
  return {
    hash_algorithm: 'fs-content-v1',
    template: {
      key: template.template_key,
      version: template.version,
      hash: template.hash,
      renderer_version: template.renderer_version,
    },
    ...Object.fromEntries(keys.map((key) => [key, ast[key]])),
  };
}
export const documentHash = (ast, template) => contentHash(documentContent(ast, template));

export function validateDocument(ast, template, manifest = {}) {
  const findings = [];
  const add = (rule_id, path, message, blocking = 'review', entity_ids = []) =>
    findings.push({ rule_id, path, message, blocking, entity_ids });
  if (!validateDomain('FsDocument', ast).ok) {
    add('INVALID_DOCUMENT', '', '文档不符合 AST 契约。');
    return findings;
  }
  if (!Number.isSafeInteger(ast.revision) || !Number.isSafeInteger(ast.version_number))
    add('UNSAFE_INTEGER', '/revision', '版本整数超出安全范围。');
  for (const [field, kind] of [
    ['requirement_refs', 'requirement'],
    ['rule_refs', 'rule'],
    ['decision_refs', 'decision'],
    ['open_issue_ids', 'issue'],
  ])
    for (const id of ast[field]) {
      if (!manifest.entities?.some((e) => e.id === id && e.kind === kind))
        add('REF_NOT_FOUND', '/' + field, '引用不在固定版本清单中或实体类型不符。', 'review', [id]);
    }
  for (const id of ast.evidence_manifest_ids)
    if (!manifest.evidence?.some((e) => e.id === id))
      add('EVIDENCE_REF_NOT_FOUND', '/evidence_manifest_ids', '证据不在授权清单中。', 'review', [
        id,
      ]);
  const seen = new Set(),
    sectionIds = new Set(ast.sections.map((s) => s.id));
  const identify = (item, path) => {
    if (!item.id || seen.has(item.id))
      add('DUPLICATE_STABLE_ID', path, '稳定 ID 缺失或重复。', 'review', [item.id]);
    seen.add(item.id);
  };
  for (const slot of template.slots) {
    if (slot.required !== false && !ast.sections.some((s) => s.template_slot === slot.stable_slot))
      add('TEMPLATE_SLOT_REQUIRED', '/sections', '缺少模板章节：' + slot.stable_slot);
  }
  const slots = new Set();
  for (const [i, section] of ast.sections.entries()) {
    const path = `/sections/${i}`;
    identify(section, path);
    const slot = template.slots.find((s) => s.stable_slot === section.template_slot);
    if (!slot || slots.has(section.template_slot))
      add('INVALID_TEMPLATE_SLOT', path, '章节槽未知或重复。');
    slots.add(section.template_slot);
    for (const [j, block] of section.blocks.entries()) {
      const p = path + `/blocks/${j}`;
      identify(block, p);
      if (slot?.allowed_block_kinds && !slot.allowed_block_kinds.includes(block.kind))
        add('BLOCK_KIND_FORBIDDEN', p, '模板不允许此内容块。');
      if (block.kind === 'table') {
        if (
          !block.columns.length ||
          block.rows.some((row) => row.cells.length !== block.columns.length)
        )
          add('TABLE_SHAPE_MISMATCH', p, '表格列数与单元格数量不符。');
        for (const row of block.rows) identify(row, p + '/rows');
      } else if (typeof block.text !== 'string' || block.columns.length || block.rows.length)
        add('BLOCK_SHAPE_MISMATCH', p, '段落/提示块必须是纯文本且没有表格数据。');
      if (block.classification === 'pending')
        add('PENDING_CONTENT', p, '待确认内容不能用于正式发布。', 'release', [block.id]);
      for (const [field, kind] of [
        ['requirement_ids', 'requirement'],
        ['rule_ids', 'rule'],
        ['decision_ids', 'decision'],
      ])
        for (const id of block[field]) {
          if (!manifest.entities?.some((e) => e.id === id && (!e.kind || e.kind === kind)))
            add('REF_NOT_FOUND', p + '/' + field, '内容引用不在固定版本清单中。', 'review', [id]);
        }
      for (const link of block.evidence_refs)
        if (!manifest.evidence?.some((e) => e.id === link.evidence_id))
          add('EVIDENCE_REF_NOT_FOUND', p + '/evidence_refs', '证据不在授权清单中。', 'review', [
            link.evidence_id,
          ]);
    }
  }
  for (const [i, t] of ast.tests.entries()) {
    identify(t, `/tests/${i}`);
    for (const [field, kind] of [
      ['requirement_ids', 'requirement'],
      ['rule_ids', 'rule'],
    ])
      for (const id of t[field])
        if (!manifest.entities?.some((e) => e.id === id && e.kind === kind))
          add('REF_NOT_FOUND', `/tests/${i}/${field}`, '测试引用不在固定版本清单中。', 'review', [
            id,
          ]);
    for (const link of t.evidence_refs)
      if (!manifest.evidence?.some((e) => e.id === link.evidence_id))
        add(
          'EVIDENCE_REF_NOT_FOUND',
          `/tests/${i}/evidence_refs`,
          '测试证据不在授权清单中。',
          'review',
          [link.evidence_id],
        );
    if (t.section_ids.some((id) => !sectionIds.has(id)))
      add('TEST_SECTION_NOT_FOUND', `/tests/${i}`, '测试引用了不存在的章节。');
    if (!t.steps.length || !t.expected.length)
      add('INCOMPLETE_TEST', `/tests/${i}`, '测试需要步骤和明确预期。', 'release', [t.id]);
  }
  if (ast.open_issue_ids.length)
    add('OPEN_ISSUES', '/open_issue_ids', '仍有未决问题。', 'release', ast.open_issue_ids);
  return findings;
}
