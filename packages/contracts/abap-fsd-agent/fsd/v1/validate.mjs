import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const parse = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const validators = Object.fromEntries(
  ['R', 'I', 'C', 'E'].map((t) => [t, ajv.compile(parse(`${t.toLowerCase()}.schema.json`))]),
);
const reviewValidator = ajv.compile(parse('review-envelope.schema.json'));
const groups = [
  'sources',
  'requirements',
  'rules',
  'fields',
  'sapObjects',
  'evidence',
  'issues',
  'tests',
];
const targets = {
  sourceIds: 'sources',
  requirementIds: 'requirements',
  ruleIds: 'rules',
  calculationRuleIds: 'rules',
  mappingRuleIds: 'rules',
  behaviorRuleIds: 'rules',
  fieldIds: 'fields',
  selectionFieldIds: 'fields',
  inputFieldIds: 'fields',
  outputFieldIds: 'fields',
  sapObjectIds: 'sapObjects',
  sapObjectId: 'sapObjects',
  enhancementObjectId: 'sapObjects',
  evidenceIds: 'evidence',
  issueIds: 'issues',
  relatedIds: 'all',
};
// Pure structure/reference validation, never an authorization or provenance check.
export function validateSpecContract(spec) {
  const errors = [],
    qualityIssues = [];
  const validate = Object.hasOwn(validators, spec?.riceType) ? validators[spec.riceType] : null;
  if (!validate || !validate(spec))
    return {
      valid: false,
      errors: validate ? structuredClone(validate.errors) : [{ code: 'unsupported_type' }],
      qualityIssues,
      assurance: 'structure-and-references-only',
    };
  const indexes = Object.fromEntries(
    groups.map((g) => [g, new Map(spec[g].map((v) => [v.id, v]))]),
  );
  const all = new Set();
  for (const group of groups)
    for (const item of spec[group]) {
      if (all.has(item.id)) errors.push({ code: 'duplicate_id', id: item.id });
      all.add(item.id);
    }
  function walk(value, location = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (targets[key]) {
        const ids = Array.isArray(child) ? child : [child];
        const target = targets[key] === 'all' ? all : indexes[targets[key]];
        if (new Set(ids).size !== ids.length)
          errors.push({ code: 'duplicate_reference', path: `${location}/${key}` });
        for (const id of ids)
          if (!target.has(id))
            errors.push({
              code: 'missing_reference',
              path: `${location}/${key}`,
              id,
              target: targets[key],
            });
      }
      walk(child, `${location}/${key}`);
    }
  }
  walk(spec);
  for (const [key, direction] of [
    ['selectionFieldIds', 'input'],
    ['inputFieldIds', 'input'],
    ['outputFieldIds', 'output'],
  ]) {
    for (const id of spec.contract[key] || []) {
      const f = indexes.fields.get(id);
      if (f && ![direction, 'inout'].includes(f.direction))
        errors.push({ code: 'field_direction', id, path: `contract/${key}` });
    }
  }
  const paths = new Set();
  for (const item of spec.contract.messageStructure || []) {
    if (paths.has(item.path)) errors.push({ code: 'duplicate_message_path', path: item.path });
    paths.add(item.path);
  }
  const covered = new Set(spec.tests.flatMap((t) => t.requirementIds));
  for (const req of spec.requirements)
    if (!covered.has(req.id)) qualityIssues.push({ code: 'requirement_without_test', id: req.id });
  for (const t of spec.tests)
    if (/^(正确|成功|正常|符合要求|通过)[。.!！\s]*$/.test(t.expectedResult.trim()))
      qualityIssues.push({ code: 'vague_expected_result', id: t.id });
  return {
    valid: errors.length === 0,
    errors,
    qualityIssues,
    assurance: 'structure-and-references-only',
  };
}
export function unresolvedIssueIds(spec) {
  return spec.issues
    .filter((i) => i.status !== 'resolved')
    .map((i) => i.id)
    .sort();
}
export function validateReviewContract(spec, envelope, { contentSha256 } = {}) {
  const result = validateSpecContract(spec);
  const errors = [...result.errors];
  if (!reviewValidator(envelope))
    return {
      ...result,
      valid: false,
      errors: [...errors, ...structuredClone(reviewValidator.errors)],
    };
  const same = (a, b) =>
    a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  if (!result.valid) return result;
  if (envelope.specId !== spec.specId || envelope.revision !== spec.revision)
    errors.push({ code: 'review_version_mismatch' });
  const unresolved = unresolvedIssueIds(spec);
  if (!same(envelope.unresolvedIssueIds, unresolved))
    errors.push({ code: 'unresolved_snapshot_mismatch' });
  if (envelope.confirmation) {
    const c = envelope.confirmation;
    if (c.specId !== spec.specId || c.revision !== spec.revision)
      errors.push({ code: 'confirmation_version_mismatch' });
    if (!/^[a-f0-9]{64}$/.test(contentSha256 || '') || c.contentSha256 !== contentSha256)
      errors.push({ code: 'confirmation_hash_mismatch' });
    if (!same(c.acknowledgedIssueIds, unresolved))
      errors.push({ code: 'acknowledged_snapshot_mismatch' });
  }
  return { ...result, valid: errors.length === 0, errors };
}
