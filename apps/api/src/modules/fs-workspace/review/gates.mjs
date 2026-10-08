import { validateDocument, documentHash, canonicalJson } from '../document/ast.mjs';
import { validateDomain } from '@sap-delivery-workbench/contracts/fs-workspace';
export function evaluateReleaseGates(document, manifest, policy = {}) {
  const gates = validateDocument(document.ast, document.template, manifest).map((f) => ({
    rule_id: f.rule_id,
    passed: false,
    blocking: f.blocking,
    message: f.message,
    entity_ids: f.entity_ids,
  }));
  const add = (rule_id, passed, message, entity_ids = []) =>
    gates.push({ rule_id, passed, blocking: 'release', message, entity_ids });
  add(
    'CONTENT_HASH',
    documentHash(document.ast, document.template) === document.content_hash,
    '文档内容必须匹配固定版本哈希。',
  );
  add('CORE_RULES_PRESENT', document.ast.rule_refs.length > 0, '至少需要明确核心业务规则。');
  for (const id of [
    ...document.ast.requirement_refs,
    ...document.ast.rule_refs,
    ...document.ast.decision_refs,
  ]) {
    const entry = manifest.entities.find((e) => e.id === id);
    add(
      'BUSINESS_CONFIRMATION',
      Boolean(
        entry &&
        manifest.confirmations?.some(
          (c) =>
            c.subject_id === id &&
            String(c.subject_revision) === String(entry.revision) &&
            c.subject_hash === entry.hash,
        ),
      ),
      '业务对象须有当前修订的有效确认。',
      [id],
    );
  }
  for (const id of document.ast.rule_refs) {
    const detail = manifest.ruleDetails?.find((r) => r.id === id);
    add(
      'STRUCTURED_RULE_COMPLETE',
      Boolean(
        detail &&
        validateDomain('RuleDetail', detail).ok &&
        detail.algorithm_summary.trim() &&
        detail.input_refs.length &&
        detail.output_refs.length &&
        detail.authorization_refs.length &&
        detail.exception_refs.length &&
        detail.test_refs.length >= 2,
      ),
      '核心规则需要明确输入、输出、算法、权限、例外及正常/异常测试。',
      [id],
    );
  }
  for (const verification of document.ast.verifications) {
    const verified =
      verification.status === 'verified' &&
      verification.applicability === 'supported' &&
      verification.evidence_ids.length > 0 &&
      verification.valid_until &&
      Date.parse(verification.valid_until) > (policy.now ?? Date.now()) &&
      verification.evidence_ids.every((id) =>
        manifest.evidence.some(
          (e) =>
            e.id === id &&
            e.exists &&
            e.receipt?.complete === true &&
            e.receipt.scope === verification.scope &&
            canonicalJson(e.receipt.target) === canonicalJson(verification.target),
        ),
      );
    add('TECHNICAL_VERIFICATION', Boolean(verified), '技术事实需要适用且未过期的验证证据。', [
      verification.id,
    ]);
  }
  for (const evidence of manifest.evidence ?? [])
    add(
      'EVIDENCE_CURRENT',
      Boolean(
        evidence.exists &&
        (!evidence.expires_at || Date.parse(evidence.expires_at) > (policy.now ?? Date.now())),
      ),
      '证据必须存在于授权项目且未过期。',
      [evidence.id],
    );
  return gates;
}
