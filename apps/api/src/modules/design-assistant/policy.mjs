import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import {
  DEFAULT_BUDGET,
  outputSchemas,
} from '@sap-delivery-workbench/contracts/design-assistant/protocol';
export { DEFAULT_BUDGET };
export function fault(code, origin = 'INPUT', statusCode = 422, details = []) {
  return Object.assign(new Error(code), { code, error_origin: origin, statusCode, details });
}
const errorCodes = new Set(
  'DEPENDENCY_REVIEW_REQUIRED BUSY CONNECTION_ERROR REVIEW_NOT_APPLIED REPLAY_DATA_MISSING UNKNOWN TIMEOUT CANCELLED PERSISTENCE_ERROR OUTCOME_UNKNOWN AUTH_DENIED UNSUPPORTED UNKNOWN_CAUSE TOOL_DENIED INVALID_TOOL_INPUT PARTIAL_RESULT RESULT_EXPIRED NOT_FOUND_UNCONFIRMED BUDGET_EXHAUSTED NO_PROGRESS COMPATIBILITY CHECKPOINT_CORRUPT CHECKPOINT_MISSING LEASE_LOST USER_PAUSED RUN_CANCELLED INVALID_OUTPUT OUTPUT_TRUNCATED MODEL_RESPONSE_ERROR MODEL_AUTH_FAILED MODEL_NOT_CONFIGURED RATE_LIMIT STALE_INPUT STALE_EVIDENCE UNKNOWN_REFERENCE OUT_OF_SCOPE VERSION_CONFLICT IDEMPOTENCY_CONFLICT INVALID_TRANSITION DELIVERY_BLOCKED INCOMPLETE_ARTIFACT REPLAY_PUBLICATION_DENIED BUSINESS_GATE_UNCONFIRMED'.split(
    ' ',
  ),
);
const errorOrigins = new Set(
  'UNKNOWN INPUT MODEL OUTPUT_VALIDATION RETRIEVAL SAP_ADAPTER SAP SAP_REMOTE BUSINESS_COMMIT CHECKPOINT AUTH OBSERVABILITY'.split(
    ' ',
  ),
);
export function safeError(error = {}) {
  const code = errorCodes.has(error.code) ? error.code : 'UNKNOWN';
  const retryable = [
    'TIMEOUT',
    'OUTCOME_UNKNOWN',
    'CONNECTION_ERROR',
    'RATE_LIMIT',
    'BUSY',
    'PARTIAL_RESULT',
    'RESULT_EXPIRED',
  ].includes(code);
  const actions = {
    DEPENDENCY_REVIEW_REQUIRED: ['REVIEW_DEPENDENTS', 'SUPPLY_MATERIAL'],
    AUTH_DENIED: ['RESTORE_ACCESS', 'SUPPLY_MATERIAL'],
    UNSUPPORTED: ['SUPPLY_MATERIAL', 'REVIEW_CAPABILITIES'],
    NOT_FOUND_UNCONFIRMED: ['VERIFY_TARGET_AND_COVERAGE', 'SUPPLY_MATERIAL'],
    BUDGET_EXHAUSTED: ['INSPECT_BUDGET', 'REQUEST_EXPLICIT_AUTHORIZATION'],
    COMPATIBILITY: ['RESTORE_PINNED_ASSETS', 'INSPECT'],
    CHECKPOINT_CORRUPT: ['INSPECT_CHECKPOINT_AND_LEDGER', 'REPLAY'],
  };
  return {
    code,
    error_origin: errorOrigins.has(error.error_origin) ? error.error_origin : 'UNKNOWN',
    retryable,
    next_actions:
      actions[code] ??
      (retryable ? ['RECOVER_WITHIN_BUDGET', 'INSPECT'] : ['INSPECT', 'SUPPLY_MATERIAL']),
    ...(Number.isSafeInteger(error.read_progress?.received_characters) &&
    Number.isSafeInteger(error.read_progress?.expected_characters) &&
    error.read_progress.received_characters >= 0 &&
    error.read_progress.expected_characters >= error.read_progress.received_characters &&
    error.read_progress.expected_characters <= 4194304
      ? {
          read_progress: {
            received_characters: error.read_progress.received_characters,
            expected_characters: error.read_progress.expected_characters,
          },
        }
      : {}),
    ...(['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(error.remote_outcome)
      ? { remote_outcome: error.remote_outcome }
      : {}),
  };
}
export function canonical(value) {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
export const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : canonical(value))
    .digest('hex');
const ajv = new Ajv({ allErrors: true, strict: true });
const validators = Object.fromEntries(
  Object.entries(outputSchemas).map(([k, v]) => [k, ajv.compile(v)]),
);
export function validateOutput(value, context) {
  if (context.expectedKind && value?.kind !== context.expectedKind)
    throw fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION');
  const check = validators[value?.kind];
  if (!check || !check(value))
    throw fault(
      'INVALID_OUTPUT',
      'OUTPUT_VALIDATION',
      422,
      (check?.errors ?? []).map((e) => ({ path: e.instancePath, keyword: e.keyword })),
    );
  if (value.input_snapshot_id !== context.snapshotId)
    throw fault('STALE_INPUT', 'OUTPUT_VALIDATION');
  if (value.base_artifact_version !== (context.artifactVersion ?? null))
    throw fault('STALE_INPUT', 'OUTPUT_VALIDATION');
  const known = new Set(context.evidenceIds ?? []);
  if (
    value.kind === 'EvidenceAssessment' &&
    value.assessments.some((a) => !known.has(a.evidence_ref))
  )
    throw fault('UNKNOWN_REFERENCE', 'OUTPUT_VALIDATION');
  if (
    value.unresolved_issues.some((i) => i.evidence_refs.some((id) => !known.has(id))) ||
    (value.kind === 'ReviewResult' &&
      value.issues.some((i) => i.evidence_refs.some((id) => !known.has(id))))
  )
    throw fault('UNKNOWN_REFERENCE', 'OUTPUT_VALIDATION');
  if (value.evidence_refs.some((r) => !known.has(r)))
    throw fault('UNKNOWN_REFERENCE', 'OUTPUT_VALIDATION');
  if (
    value.kind === 'AnalysisResult' &&
    value.claims.some(
      (c) =>
        c.basis === 'FACT' &&
        (!c.evidence_refs.length || c.evidence_refs.some((r) => !known.has(r))),
    )
  )
    throw fault('UNKNOWN_REFERENCE', 'OUTPUT_VALIDATION');
  if (
    value.kind === 'ChangeProposal' &&
    value.changes.some(
      (c) =>
        !value.allowed_scope.includes(c.object_id) ||
        (context.allowedScope &&
          !context.allowedScope.includes(c.object_id) &&
          !(
            context.allowNewDomainObjects &&
            /^(scenario|rule|field)-[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(c.object_id)
          )),
    )
  )
    throw fault('OUT_OF_SCOPE', 'OUTPUT_VALIDATION');
  if (value.kind === 'ClarificationBatch') {
    if (new Set(value.questions.map((q) => q.id)).size !== value.questions.length)
      throw fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION');
    for (const q of value.questions)
      if (
        new Set(q.options.map((o) => o.id)).size !== q.options.length ||
        !q.options.at(-1).other ||
        q.options.filter((o) => o.other).length !== 1 ||
        q.options.filter((o) => o.recommended).length !== 1
      )
        throw fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION');
  }
  return value;
}
export function validateAnswer(question, answer, attachments) {
  const option = question.options.find((o) => o.id === answer?.option_id);
  if (!option || (option.other && !answer.text?.trim()) || (answer.text?.length ?? 0) > 20000)
    throw fault('INVALID_ANSWER');
  const ids = answer.attachment_ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.some((id) => !attachments.some((a) => a.id === id && a.state === 'ready')) ||
    (option.requires_material && !ids.length)
  )
    throw fault('INVALID_ANSWER');
  return {
    question_id: question.id,
    option_id: option.id,
    // The successor run only sees the snapshot; bare ids made the model re-ask the same questions.
    question: question.question,
    answer: option.label,
    text: answer.text?.trim() ?? '',
    attachment_ids: ids,
  };
}
export function validateBudget(budget) {
  for (const [key, max] of Object.entries(DEFAULT_BUDGET))
    if (!Number.isSafeInteger(budget?.[key]) || budget[key] <= 0 || budget[key] > max)
      throw fault('INVALID_BUDGET');
  return structuredClone(budget);
}
export function assertConfirmation(wait, input) {
  if (
    wait.status !== 'OPEN' ||
    wait.artifact_id !== input.artifact_id ||
    wait.artifact_version !== input.artifact_version
  )
    throw fault('STALE_CONFIRMATION');
  if (
    input.confirmed !== true ||
    input.condition ||
    canonical(wait.scope) !== canonical(input.scope)
  )
    throw fault('INVALID_CONFIRMATION');
}
const toolFields = {
  adtDiscovery: [],
  adtCoreDiscovery: [],
  objectTypes: [],
  loadTypes: [],
  searchObject: ['query', 'objType', 'max'],
  findObjectPath: ['objectUrl'],
  objectStructure: ['objectUrl', 'version'],
  getObjectSource: ['objectSourceUrl', 'startLine', 'maxLines'],
  classIncludes: ['clas'],
  classComponents: ['url'],
  ddicElement: ['path', 'getTargetForAssociation', 'getExtensionViews', 'getSecondaryObjects'],
  ddicRepositoryAccess: ['path'],
  configurationTemplate: ['template_id', 'filters'],
};
const requiredToolFields = {
  searchObject: ['query'],
  findObjectPath: ['objectUrl'],
  objectStructure: ['objectUrl'],
  getObjectSource: ['objectSourceUrl'],
  classIncludes: ['clas'],
  classComponents: ['url'],
  ddicElement: ['path'],
  ddicRepositoryAccess: ['path'],
  configurationTemplate: ['template_id'],
};
export const modelOutputLimit = (kind, budget) =>
  kind === 'ChangeProposal' ? budget.model_output_limit : Math.min(6000, budget.model_output_limit);
export const ddicTableUrl = (name) =>
  '/sap/bc/adt/ddic/tables/' + encodeURIComponent(name.toLowerCase());
// What a QueryPlan may contain for this target; mirrors validateTool exactly.
export function toolCatalog(target) {
  return {
    target_ref: target.target_ref,
    tools: Object.fromEntries(
      Object.entries(toolFields).map(([name, fields]) => [
        name,
        { arguments: fields, required: requiredToolFields[name] ?? [] },
      ]),
    ),
    allowed_urls: target.allowed_urls ?? [],
    configuration_templates: Object.keys(target.templates ?? {}),
    rules:
      '每个 item 的 target_ref 字段必须逐字填写上面的 target_ref 值，不是 URL。' +
      '读取表字段用 ddicElement，path 填大写表名（如 VBAP，其 /sap/bc/adt/ddic/tables/vbap 须在 allowed_urls 中），required_properties 填需要核实的大写字段名，结果只返回这些字段和主键。' +
      '其他 objectUrl/objectSourceUrl/url/path 只能逐字使用 allowed_urls 中的值；query/objType/clas 为大写对象名，不得为 *；max≤100，maxLines≤200；configurationTemplate 只能用列出的模板且不得带 filters。',
  };
}
export function validateTool(item, target) {
  const fields = toolFields[item?.tool_name];
  if (!fields) throw fault('TOOL_DENIED', 'SAP_ADAPTER');
  const args = item.arguments;
  if (
    item.target_ref !== target.target_ref ||
    !args ||
    Array.isArray(args) ||
    Object.keys(args).some((k) => !fields.includes(k))
  )
    throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
  if ((requiredToolFields[item.tool_name] ?? []).some((k) => args[k] === undefined))
    throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
  for (const [k, v] of Object.entries(args)) {
    // ddicElement only returns fields for a bare DDIC name (an ADT URI yields an empty
    // element); the name is allowed exactly when its table URI is approved.
    if (
      item.tool_name === 'ddicElement' &&
      k === 'path' &&
      typeof v === 'string' &&
      /^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]{0,29}$/.test(v) &&
      target.allowed_urls?.includes(ddicTableUrl(v))
    )
      continue;
    if (
      ['objectUrl', 'objectSourceUrl', 'url', 'path'].includes(k) &&
      (typeof v !== 'string' ||
        !v.startsWith('/sap/bc/adt/') ||
        !target.allowed_urls?.includes(v) ||
        /(?:\.\.|%2e|%2f|\\|[?#])/i.test(v))
    )
      throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
    if (
      ['query', 'objType', 'clas', 'template_id'].includes(k) &&
      (typeof v !== 'string' || !/^[A-Z0-9_/* .-]{1,100}$/i.test(v) || v === '*')
    )
      throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
    if (
      ['max', 'maxLines', 'startLine'].includes(k) &&
      (!Number.isSafeInteger(v) ||
        v < 1 ||
        (k === 'max' && v > 100) ||
        (k === 'maxLines' && v > 200))
    )
      throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
    if (k === 'version' && !['active', 'inactive'].includes(v))
      throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
    if (
      ['getTargetForAssociation', 'getExtensionViews', 'getSecondaryObjects'].includes(k) &&
      typeof v !== 'boolean'
    )
      throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
    if (
      k === 'filters' &&
      (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length)
    )
      throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
  }
  if (item.tool_name === 'searchObject' && !args.query)
    throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
  if (item.tool_name === 'searchObject') args.max ??= 100;
  if (item.tool_name === 'getObjectSource') {
    args.maxLines ??= 200;
    args.startLine ??= 1;
  }
  if (item.tool_name === 'configurationTemplate' && !target.templates?.[args.template_id])
    throw fault('TOOL_DENIED', 'SAP_ADAPTER');
  return item;
}
// Field-list reads of one DDIC object accumulate across query rounds; an earlier read
// whose fields a later read fully contains only makes the model think fields are missing.
export function withoutSupersededFields(evidence) {
  const fields = (e) => (Array.isArray(e.data?.fields) ? e.data.fields.map((f) => f.name) : null);
  return evidence.filter((e, i) => {
    const mine = fields(e);
    return !(
      mine &&
      evidence.some((later, j) => {
        const theirs = j > i && later.data?.name === e.data.name ? fields(later) : null;
        return theirs && mine.every((n) => theirs.includes(n));
      })
    );
  });
}
export function validateEvidence(e, target, required = [], now = Date.now()) {
  const reasons = [];
  if (e.target_ref !== target.target_ref || e.client !== target.client)
    reasons.push('TARGET_MISMATCH');
  if (!e.source_version) reasons.push('VERSION_UNKNOWN');
  if (!e.coverage?.complete || e.coverage?.truncated) reasons.push('PARTIAL_RESULT');
  const missing = required.filter((p) => !e.coverage?.properties?.includes(p));
  if (missing.length) reasons.push('MISSING_PROPERTIES');
  if (
    !Number.isFinite(Date.parse(e.observed_at)) ||
    now - Date.parse(e.observed_at) > 900000 ||
    e.validity !== 'VALID'
  )
    reasons.push('STALE_EVIDENCE');
  return { valid: reasons.length === 0, reasons, missing_properties: missing };
}
