import { parseResponseObject } from './response-json.mjs';
import { createHash } from 'node:crypto';
import { validateSpecContract } from '../../../../packages/contracts/abap-fsd-agent/fsd/v1/validate.mjs';
export function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
}
export const sha256 = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(canonical(value)))
    .digest('hex');
export function parseDraft(text) {
  return parseResponseObject(text);
}
export function validateDraft(spec, { sources } = {}) {
  const result = validateSpecContract(spec);
  const errors = [...result.errors];
  function checkStatus(v, path = '') {
    if (!v || typeof v !== 'object') return;
    if (v.status === 'consultant_confirmed')
      errors.push({
        code: 'untrusted_confirmation',
        path: path + '/status',
        expected: ['proposed', 'open'],
      });
    for (const [key, child] of Object.entries(v)) checkStatus(child, path + '/' + key);
  }
  checkStatus(spec);
  if (!result.valid) return { ...result, errors };
  if (
    sources &&
    spec.sources.some(
      (s) =>
        !sources.some((t) => t.id === s.id && t.kind === s.kind && t.reference === s.reference),
    )
  )
    errors.push({ code: 'unregistered_source' });
  if (spec.issues.some((i) => i.status === 'accepted'))
    errors.push({ code: 'untrusted_acceptance' });
  if (spec.riceType !== 'R') errors.push({ code: 'draft_type_not_enabled' });
  if (
    spec.evidence.length ||
    spec.systemContext.evidenceIds.length ||
    spec.sapObjects.some((o) => o.verificationStatus !== 'unverified' || o.evidenceIds.length)
  )
    errors.push({ code: 'untrusted_evidence' });
  if (spec.systemContext.identificationSource !== 'unknown')
    errors.push({ code: 'untrusted_system_profile' });
  return { ...result, errors, valid: errors.length === 0 };
}
export { renderConsultantMarkdown as renderMarkdown } from './consultant-renderer.mjs';
