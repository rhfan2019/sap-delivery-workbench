export const PHASES = [
  '接收理解',
  '业务分析',
  '方案核实',
  '方案确认',
  'FSD编制检查',
  'FSD确认',
  '交付',
];
export const API_VERSION = 'fsd-v1';
export const DEFAULT_BUDGET = Object.freeze({
  model_call_timeout: 300000,
  tool_call_timeout: 45000,
  model_output_limit: 16000,
  run_model_calls: 12,
  run_tool_calls: 60,
  run_total_tokens: 120000,
  task_model_calls: 48,
  task_tool_calls: 240,
  task_total_tokens: 480000,
  run_active_time: 1800000,
  task_active_time: 7200000,
  max_graph_steps_per_run: 80,
  format_repairs: 1,
  tool_retries: 2,
  query_rounds: 3,
  review_repairs: 2,
});
const str = { type: 'string', minLength: 1, maxLength: 20000 };
const id = { type: 'string', minLength: 1, maxLength: 160 };
const refs = { type: 'array', items: id, maxItems: 200 };
const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const array = (items, maxItems = 200) => ({ type: 'array', items, maxItems });
const issue = obj({ id, description: str, blocking: { type: 'boolean' }, evidence_refs: refs });
const option = obj({
  id,
  label: str,
  impact: str,
  recommended: { type: 'boolean' },
  other: { type: 'boolean' },
  requires_material: { type: 'boolean' },
});
export const questionSchema = obj({
  id,
  question: str,
  background: str,
  options: { ...array(option, 8), minItems: 2 },
  recommendation_reason: str,
});
const change = obj({
  object_id: id,
  base_version: { type: 'integer', minimum: 0 },
  op: { enum: ['ADD', 'REVISE', 'REPLACE'] },
  content: str,
  dependencies: refs,
  reason: str,
  section: { type: 'integer', minimum: 1, maximum: 8 },
});
const common = {
  output_schema_version: { const: 2 },
  kind: id,
  input_snapshot_id: id,
  base_artifact_version: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  decision: {
    enum: ['NEED_QUERY', 'NEED_CLARIFICATION', 'PROPOSE', 'BLOCKED', 'READY_FOR_REVIEW'],
  },
  reason_code: id,
  evidence_refs: refs,
  unresolved_issues: array(issue),
};
const extensions = {
  AnalysisResult: {
    goal: str,
    scope: { enum: ['report', 'mixed', 'as_is', 'out_of_scope'] },
    standard_fit: { enum: ['UNKNOWN', 'PARTIAL', 'SATISFIES'] },
    claims: array(
      obj({
        id,
        content: str,
        basis: { enum: ['FACT', 'INFERENCE', 'CUSTOMER_DECISION'] },
        evidence_refs: refs,
      }),
    ),
    gaps: array(obj({ id, description: str })),
  },
  QueryPlan: {
    items: array(
      obj({
        gap_id: id,
        target_ref: id,
        tool_name: id,
        arguments: { type: 'object' },
        required_properties: refs,
        supports_rule_refs: refs,
      }),
      20,
    ),
  },
  EvidenceAssessment: {
    assessments: array(
      obj({
        evidence_ref: id,
        completeness: { enum: ['COMPLETE', 'PARTIAL'] },
        fact_status: { enum: ['PENDING', 'VERIFIED', 'CONFLICT'] },
        validity: { enum: ['VALID', 'PENDING_REVIEW', 'INVALID'] },
        missing_properties: refs,
        conflicts: refs,
      }),
    ),
  },
  ClarificationBatch: {
    questions: { ...array(questionSchema, 20), minItems: 1 },
    return_phase: { type: 'integer', minimum: 1, maximum: 6 },
  },
  ChangeProposal: {
    proposal_id: id,
    allowed_scope: refs,
    changes: { ...array(change), minItems: 1 },
  },
  ReviewResult: {
    issues: array(
      obj({
        issue_id: id,
        rule_ref: id,
        counterexample: str,
        evidence_refs: refs,
        impact: str,
        suggestion: str,
        status: { enum: ['OPEN', 'RESOLVED'] },
      }),
    ),
  },
};
export const outputSchemas = Object.fromEntries(
  Object.entries(extensions).map(([kind, fields]) => [
    kind,
    obj({ ...common, kind: { const: kind }, ...fields }),
  ]),
);
