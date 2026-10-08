// Generated from packages/contracts/fs-workspace JSON Schema. DO NOT EDIT.

export interface AcceptChange {
  base_document_version: string;
  accepted_group_ids: string[];
}

export interface AgentArtifact {
  id: string;
  run_id: string;
  stage: "orchestrate" | "analyze" | "clarify" | "generate" | "revise" | "review";
  summary: string;
  change_set_id: string | null;
}

export interface ApprovalCreate {
  document_version_id: string;
  document_hash: string;
  action: "approve" | "reject";
  review_role: "business_approver" | "technical_reviewer";
  reason: string;
}

/**
 * server persisted domain
 */
export interface ApprovalRecord {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  id: string;
  document_version_id: string;
  document_hash: string;
  review_ids: string[];
  evidence_manifest_hash: string;
  policy_version: string;
  actor_id: string;
  actor_role: string;
  action: "approve" | "reject" | "withdraw";
  reason: string;
  created_at: string;
}

export interface AssessFsVerificationCommand {
  target_binding: string;
  evidence_ids: string[];
  scope: string;
  conclusion: "supported" | "unsupported" | "inconclusive";
  reason: string;
}

export interface Attachment {
  id: string;
  name: string;
  size_bytes: number;
  mime: string;
  sha256: string;
  scan_state: "quarantined" | "clean" | "rejected" | "failed";
  parse_result: {
    id: string;
    attachment_id: string;
    revision: string;
    parser_version: string;
    state: "complete" | "partial" | "failed";
    regions: {
      id: string;
      locator: string;
      text: string;
      confidence: number | null;
      rows: string[][];
    }[];
    unread_regions: string[];
    warnings: string[];
    created_at: string;
  } | null;
  created_at: string;
}

export interface Capabilities {
  can_edit: boolean;
  can_confirm: boolean;
  can_review_technical: boolean;
  can_approve_business: boolean;
  can_publish: boolean;
  can_export: boolean;
}

/**
 * llm proposal only
 */
export interface ChangeSet {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  change_set_id: string;
  reason: string;
  operations: {
    op: "add" | "replace" | "remove";
    entity_type: "requirement" | "rule" | "decision" | "issue" | "verification_request" | "section" | "block" | "test";
    target_id: string;
    expected_revision: number | null;
    before_hash: string | null;
    value:
      | (
          | {
              id: string;
              revision: number;
              text: string;
              classification: "source_fact" | "assumption" | "recommendation" | "pending";
              source_refs: {
                evidence_id: string;
                locator: string;
                conclusion: string;
              }[];
              depends_on: string[];
            }
          | {
              id: string;
              question: string;
              impact: string;
              owner_role: "business" | "technical" | "security" | "product";
              blocking: "release" | "review" | "none";
              entity_ids: string[];
              status: "open" | "resolved" | "superseded";
              resolution_ref: string | null;
            }
          | {
              id: string;
              target: {
                system_id: string;
                client: string;
                release: string;
              };
              claim: string;
              object_type:
                | "table"
                | "field"
                | "domain"
                | "transaction"
                | "interface"
                | "enhancement"
                | "authorization"
                | "behavior";
              candidate_name: string | null;
              scope: string;
              required_evidence: string;
              blocking: "release" | "review" | "none";
              related_ids: string[];
            }
          | {
              id: string;
              template_slot: string;
              title: string;
              blocks: {
                id: string;
                kind: "paragraph" | "table" | "callout";
                text: string | null;
                columns: string[];
                rows: {
                  id: string;
                  cells: string[];
                }[];
                classification: "source_fact" | "assumption" | "recommendation" | "pending";
                requirement_ids: string[];
                rule_ids: string[];
                decision_ids: string[];
                evidence_refs: {
                  evidence_id: string;
                  locator: string;
                  conclusion: string;
                }[];
              }[];
            }
          | {
              id: string;
              kind: "paragraph" | "table" | "callout";
              text: string | null;
              columns: string[];
              rows: {
                id: string;
                cells: string[];
              }[];
              classification: "source_fact" | "assumption" | "recommendation" | "pending";
              requirement_ids: string[];
              rule_ids: string[];
              decision_ids: string[];
              evidence_refs: {
                evidence_id: string;
                locator: string;
                conclusion: string;
              }[];
            }
          | {
              id: string;
              title: string;
              preconditions: string[];
              steps: string[];
              expected: string[];
              requirement_ids: string[];
              rule_ids: string[];
              section_ids: string[];
              evidence_refs: {
                evidence_id: string;
                locator: string;
                conclusion: string;
              }[];
            }
        )
      | null;
    reason: string;
  }[];
  impacts: {
    entity_id: string;
    reason: string;
    action: "revise" | "invalidate_confirmation" | "invalidate_review" | "reverify" | "inspect";
  }[];
  atomic_groups: {
    id: string;
    operation_target_ids: string[];
    reason: string;
  }[];
  new_issue_ids: string[];
}

/**
 * llm proposal only
 */
export interface Clarification {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  questions: {
    issue_id: string;
    question: string;
    options: {
      id: string;
      label: string;
      consequence: string;
      recommended: boolean;
    }[];
    decision_subject_id: string;
    decision_subject_revision: number;
    decision_subject_hash: string;
  }[];
  decision_proposals: {
    id: string;
    revision: number;
    text: string;
    classification: "source_fact" | "assumption" | "recommendation" | "pending";
    source_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
    depends_on: string[];
  }[];
  deferred_issue_ids: string[];
  summary: string;
}

export interface CommandReceipt {
  action: string;
  key: string;
  state: "committed" | "not_found";
  result_ids: string[];
  request_hash: string | null;
}

export interface Confirm {
  subject_id: string;
  subject_revision: string;
  subject_hash: string;
  context_snapshot_id: string;
  choice_id: string;
  decision_text: string;
}

export interface ContextSnapshot {
  id: string;
  project_policy_version: string;
  target_binding: string | null;
  template_version: string;
  schema_version: string;
  prompt_version: string;
  ruleset_version: string;
  model_version_id: string | null;
  document_head: {
    id: string;
    revision: string;
    formal_number: number | null;
    content_hash: string;
  } | null;
  entity_manifest: {
    id: string;
    revision: string;
    hash: string;
  }[];
  evidence_ids: string[];
  input_message_ids: string[];
  token_budget: number;
  omitted_regions: string[];
  created_at: string;
}

/**
 * server persisted domain
 */
export interface DecisionRecord {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  id: string;
  revision: number;
  content: {
    id: string;
    revision: number;
    text: string;
    classification: "source_fact" | "assumption" | "recommendation" | "pending";
    source_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
    depends_on: string[];
  };
  confirmation: {
    subject_id: string;
    subject_revision: number;
    subject_hash: string;
    state: "unconfirmed" | "confirmed" | "invalidated" | "rejected";
    actor_id: string | null;
    confirmed_at: string | null;
    record_id: string | null;
  };
  supersedes_id: string | null;
}

export interface Empty {}

export interface Error {
  code:
    | "INVALID_INPUT"
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "VERSION_CONFLICT"
    | "IDEMPOTENCY_CONFLICT"
    | "FS_WORKSPACE_ENABLED"
    | "GATE_BLOCKED"
    | "PRECONDITION_REQUIRED"
    | "PAYLOAD_TOO_LARGE"
    | "EVENT_CURSOR_EXPIRED"
    | "MODEL_CAPABILITY_REQUIRED"
    | "DEPENDENCY_MISSING"
    | "SERVICE_UNAVAILABLE";
  message: string;
  details: {
    path: string;
    rule_id: string;
    message: string;
    entity_ids: string[];
  }[];
  request_id: string;
}

/**
 * server persisted domain
 */
export interface EvidenceRecord {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  id: string;
  source_kind: "message" | "attachment" | "sap_tool" | "official_document";
  source_id: string;
  source_revision: string;
  content_hash: string;
  locator: string;
  conclusion: string;
  target: {
    system_id: string;
    client: string;
    release: string;
  } | null;
  scope: string;
  collected_at: string;
  expires_at: string | null;
  limitations: string[];
  tool_receipt_id: string | null;
  access_scope_id: string;
}

export interface Export {
  id: string;
  document_version_id: string;
  format: "pdf" | "docx";
  status: "queued" | "running" | "ready" | "failed";
  manifest_hash: string;
  content_hash: string | null;
  error_code: string | null;
}

export interface ExportCreate {
  document_version_id: string;
  format: "pdf" | "docx";
}

export interface ExportManifest {
  id: string;
  document_version_id: string;
  content_hash: string;
  template_version: string;
  renderer_version: string;
  font_pack_version: string;
  format: "docx" | "pdf";
  render_model_hash: string;
  evidence_manifest_hash: string;
  watermark_policy: "discussion" | "approved" | "superseded" | "withdrawn" | "legacy_submission";
  created_by: string;
  created_at: string;
}

/**
 * server persisted domain
 */
export interface FsDocument {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  id: string;
  revision: number;
  version_number: number;
  title: string;
  content_hash: string;
  lifecycle: "draft" | "in_review" | "approved" | "superseded" | "withdrawn";
  sections: {
    id: string;
    template_slot: string;
    title: string;
    blocks: {
      id: string;
      kind: "paragraph" | "table" | "callout";
      text: string | null;
      columns: string[];
      rows: {
        id: string;
        cells: string[];
      }[];
      classification: "source_fact" | "assumption" | "recommendation" | "pending";
      requirement_ids: string[];
      rule_ids: string[];
      decision_ids: string[];
      evidence_refs: {
        evidence_id: string;
        locator: string;
        conclusion: string;
      }[];
    }[];
  }[];
  tests: {
    id: string;
    title: string;
    preconditions: string[];
    steps: string[];
    expected: string[];
    requirement_ids: string[];
    rule_ids: string[];
    section_ids: string[];
    evidence_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
  }[];
  requirement_refs: string[];
  rule_refs: string[];
  decision_refs: string[];
  open_issue_ids: string[];
  verifications: {
    id: string;
    target: {
      system_id: string;
      client: string;
      release: string;
    };
    claim: string;
    object_name: string | null;
    scope: string;
    status: "unverified" | "verified" | "conflict" | "expired" | "not_applicable" | "not_found" | "unreadable";
    evidence_ids: string[];
    checked_at: string | null;
    valid_until: string | null;
    limitations: string[];
    applicability: "pending" | "supported" | "unsupported";
    applicability_reason: string;
  }[];
  confirmation_refs: string[];
  review_refs: string[];
  approval_refs: string[];
  evidence_manifest_ids: string[];
  created_at: string;
  created_by: string;
}

export interface FsProjectRoleAssignment {
  user_id: string;
  roles: ("business_approver" | "technical_reviewer" | "publisher")[];
  revision: string;
}

/**
 * llm proposal only
 */
export interface FsProposal {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  title: string;
  sections: {
    id: string;
    template_slot: string;
    title: string;
    blocks: {
      id: string;
      kind: "paragraph" | "table" | "callout";
      text: string | null;
      columns: string[];
      rows: {
        id: string;
        cells: string[];
      }[];
      classification: "source_fact" | "assumption" | "recommendation" | "pending";
      requirement_ids: string[];
      rule_ids: string[];
      decision_ids: string[];
      evidence_refs: {
        evidence_id: string;
        locator: string;
        conclusion: string;
      }[];
    }[];
  }[];
  tests: {
    id: string;
    title: string;
    preconditions: string[];
    steps: string[];
    expected: string[];
    requirement_ids: string[];
    rule_ids: string[];
    section_ids: string[];
    evidence_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
  }[];
  open_issue_ids: string[];
  decision_refs: string[];
  verification_refs: string[];
  mode: "discussion" | "review_candidate";
}

export interface Gate {
  rule_id: string;
  passed: boolean;
  blocking: "release" | "review" | "none";
  message: string;
  entity_ids: string[];
}

export interface Head {
  id: string;
  revision: string;
  formal_number: number | null;
  content_hash: string;
}

export interface Issue {
  id: string;
  question: string;
  impact: string;
  owner_role: "business" | "technical" | "security" | "product";
  blocking: "release" | "review" | "none";
  state: "open" | "resolved" | "superseded";
  entity_ids: string[];
}

export interface ManifestEntry {
  id: string;
  revision: string;
  hash: string;
}

export interface ManualEdit {
  base_document_version: string;
  block_id: string;
  before_hash: string;
  new_block: {
    id: string;
    kind: "paragraph" | "table" | "callout";
    text: string | null;
    columns: string[];
    rows: {
      id: string;
      cells: string[];
    }[];
    classification: "source_fact" | "assumption" | "recommendation" | "pending";
    requirement_ids: string[];
    rule_ids: string[];
    decision_ids: string[];
    evidence_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
  };
  reason: string;
}

export interface Message {
  id: string;
  session_id: string;
  sequence: string;
  role: "user" | "assistant" | "system_notice";
  content: string;
  attachment_ids: string[];
  selection: {
    document_version_id: string;
    block_id: string;
    start: number;
    end: number;
    text_hash: string;
  } | null;
  created_at: string;
}

export interface MessageCreate {
  client_message_id: string;
  content: string;
  attachment_ids: string[];
  selection: {
    document_version_id: string;
    block_id: string;
    start: number;
    end: number;
    text_hash: string;
  } | null;
  intent: "analyze" | "clarify" | "generate" | "revise" | "explain";
}

export interface Meta {
  request_id: string;
  workspace_revision: string | null;
}

/**
 * llm proposal only
 */
export interface OrchestratorPlan {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  summary: string;
  next_action: "analyze" | "clarify" | "verify" | "generate" | "revise" | "review" | "wait";
  reason: string;
  required_entity_ids: string[];
  issue_ids: string[];
}

export interface ParseResult {
  id: string;
  attachment_id: string;
  revision: string;
  parser_version: string;
  state: "complete" | "partial" | "failed";
  regions: {
    id: string;
    locator: string;
    text: string;
    confidence: number | null;
    rows: string[][];
  }[];
  unread_regions: string[];
  warnings: string[];
  created_at: string;
}

export interface PublicationCreate {
  review_id: string;
  document_version_id: string;
  expected_baseline_id: string | null;
}

export interface RebaseFsChangeCommand {
  new_base_document_version: string;
}

export interface RejectFsChangeCommand {
  reason: string;
}

export interface RequestFsVerificationCommand {
  verification_id: string;
  scope: string;
}

/**
 * llm proposal only
 */
export interface RequirementAnalysis {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  summary: string;
  requirements: {
    id: string;
    revision: number;
    text: string;
    classification: "source_fact" | "assumption" | "recommendation" | "pending";
    source_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
    depends_on: string[];
  }[];
  rules: {
    id: string;
    revision: number;
    text: string;
    classification: "source_fact" | "assumption" | "recommendation" | "pending";
    source_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
    depends_on: string[];
  }[];
  issues: {
    id: string;
    question: string;
    impact: string;
    owner_role: "business" | "technical" | "security" | "product";
    blocking: "release" | "review" | "none";
    entity_ids: string[];
    status: "open" | "resolved" | "superseded";
    resolution_ref: string | null;
  }[];
  verification_requests: {
    id: string;
    target: {
      system_id: string;
      client: string;
      release: string;
    };
    claim: string;
    object_type:
      "table" | "field" | "domain" | "transaction" | "interface" | "enhancement" | "authorization" | "behavior";
    candidate_name: string | null;
    scope: string;
    required_evidence: string;
    blocking: "release" | "review" | "none";
    related_ids: string[];
  }[];
  source_coverage: {
    evidence_id: string;
    covered_locators: string[];
    unread_locators: string[];
    limitations: string[];
  }[];
}

/**
 * server persisted domain
 */
export interface RequirementRecord {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  id: string;
  revision: number;
  kind: "requirement" | "rule";
  content: {
    id: string;
    revision: number;
    text: string;
    classification: "source_fact" | "assumption" | "recommendation" | "pending";
    source_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
    depends_on: string[];
  };
  confirmation: {
    subject_id: string;
    subject_revision: number;
    subject_hash: string;
    state: "unconfirmed" | "confirmed" | "invalidated" | "rejected";
    actor_id: string | null;
    confirmed_at: string | null;
    record_id: string | null;
  };
  created_at: string;
  updated_at: string;
}

export interface Restore {
  source_version_id: string;
  base_document_version: string;
  reason: string;
}

export interface Resume {
  checkpoint_id: string | null;
  reason: string;
}

export interface RetryFsParseCommand {
  region_ids: string[];
}

export interface ReviewCreate {
  document_version_id: string;
  document_hash: string;
}

export interface ReviewRequest {
  id: string;
  document_version_id: string;
  document_hash: string;
  state: "open" | "returned" | "approved" | "closed";
  policy_version: string;
  gates: {
    rule_id: string;
    passed: boolean;
    blocking: "release" | "review" | "none";
    message: string;
    entity_ids: string[];
  }[];
  technical_approved: boolean;
  business_approved: boolean;
}

/**
 * llm advisory review only
 */
export interface ReviewResult {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  review_id: string;
  document_hash: string;
  ruleset_version: string;
  recommendation: "ready_for_human_review" | "revise" | "discussion_only";
  findings: {
    id: string;
    rule_id: string;
    severity: "blocker" | "major" | "minor" | "info";
    entity_ids: string[];
    description: string;
    evidence_refs: {
      evidence_id: string;
      locator: string;
      conclusion: string;
    }[];
    suggested_fix: string;
  }[];
  coverage: {
    rule_id: string;
    entity_ids: string[];
    result: "pass" | "fail" | "not_applicable" | "not_checked";
    reason: string;
  }[];
  limitations: string[];
}

export interface RuleDetail {
  id: string;
  revision: string;
  applicability: string[];
  input_refs: string[];
  output_refs: string[];
  algorithm_summary: string;
  authorization_refs: string[];
  exception_refs: string[];
  test_refs: string[];
  currency_policy: {
    currencies: string[];
    scale_source: string;
    rounding: "half_up" | "half_even" | "down" | "not_applicable";
    tolerance_decimal: string | null;
    cross_currency_allowed: boolean;
  } | null;
  unit_policy: string | null;
  confirmation_subject: {
    id: string;
    revision: string;
    hash: string;
  };
  open_issue_ids: string[];
}

export interface Run {
  id: string;
  status:
    | "queued"
    | "running"
    | "waiting_user"
    | "waiting_evidence"
    | "failed"
    | "cancel_requested"
    | "cancelled"
    | "completed";
  node_id: string;
  attempt: number;
  input_snapshot_id: string;
  last_sequence: string;
  error_code: string | null;
  updated_at: string;
}

export interface RunCheckpoint {
  id: string;
  run_id: string;
  node_id: string;
  attempt: number;
  input_hash: string;
  output_refs: string[];
  idempotency_receipts: string[];
  fencing_token: string;
  cancel_epoch: string;
  config_versions: {
    template_version: string;
    schema_version: string;
    prompt_version: string;
    ruleset_version: string;
    model_version_id: string | null;
  };
  last_event_sequence: string;
  created_at: string;
}

/**
 * server event only
 */
export interface RunEvent {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  event_id: string;
  sequence: number;
  occurred_at: string;
  event_type:
    | "run.queued"
    | "run.started"
    | "run.progress"
    | "run.waiting"
    | "artifact.proposed"
    | "draft.saved"
    | "review.submitted"
    | "approval.recorded"
    | "baseline.published"
    | "export.ready"
    | "run.failed"
    | "run.cancelled"
    | "run.completed";
  run_status:
    | "queued"
    | "running"
    | "waiting_user"
    | "waiting_evidence"
    | "failed"
    | "cancel_requested"
    | "cancelled"
    | "completed";
  node_id: string;
  data: {
    message: string;
    progress: number | null;
    entity_ids: string[];
    error_code: string | null;
    retryable: boolean;
    result_version_id: string | null;
    checkpoint_id: string | null;
  };
}

export interface Selection {
  document_version_id: string;
  block_id: string;
  start: number;
  end: number;
  text_hash: string;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  archived: boolean;
}

export interface SessionCreate {
  title: string;
}

export interface SetFsProjectRolesCommand {
  user_id: string;
  roles: ("business_approver" | "technical_reviewer" | "publisher")[];
  expected_revision: string;
}

export interface Snapshot {
  workspace: {
    id: string;
    fs_number: string;
    profile: "report" | "interface" | "enhancement" | "batch" | "tool" | "form";
    template_id: string;
    template_version: string;
    draft_head: {
      id: string;
      revision: string;
      formal_number: number | null;
      content_hash: string;
    } | null;
    review_head: {
      id: string;
      revision: string;
      formal_number: number | null;
      content_hash: string;
    } | null;
    baseline_head: {
      id: string;
      revision: string;
      formal_number: number | null;
      content_hash: string;
    } | null;
    revision: string;
  } | null;
  capabilities: {
    can_edit: boolean;
    can_confirm: boolean;
    can_review_technical: boolean;
    can_approve_business: boolean;
    can_publish: boolean;
    can_export: boolean;
  };
  legacy_available: boolean;
  sessions: {
    id: string;
    title: string;
    created_at: string;
    archived: boolean;
  }[];
  active_runs: {
    id: string;
    status:
      | "queued"
      | "running"
      | "waiting_user"
      | "waiting_evidence"
      | "failed"
      | "cancel_requested"
      | "cancelled"
      | "completed";
    node_id: string;
    attempt: number;
    input_snapshot_id: string;
    last_sequence: string;
    error_code: string | null;
    updated_at: string;
  }[];
  attachments: {
    id: string;
    name: string;
    size_bytes: number;
    mime: string;
    sha256: string;
    scan_state: "quarantined" | "clean" | "rejected" | "failed";
    parse_result: {
      id: string;
      attachment_id: string;
      revision: string;
      parser_version: string;
      state: "complete" | "partial" | "failed";
      regions: {
        id: string;
        locator: string;
        text: string;
        confidence: number | null;
        rows: string[][];
      }[];
      unread_regions: string[];
      warnings: string[];
      created_at: string;
    } | null;
    created_at: string;
  }[];
  issues: {
    id: string;
    question: string;
    impact: string;
    owner_role: "business" | "technical" | "security" | "product";
    blocking: "release" | "review" | "none";
    state: "open" | "resolved" | "superseded";
    entity_ids: string[];
  }[];
}

export interface SnapshotCreate {
  base_document_version: string;
  note: string;
}

export interface SourceRegion {
  id: string;
  locator: string;
  text: string;
  confidence: number | null;
  rows: string[][];
}

export interface UploadReceipt {
  attachment_id: string;
  workspace_id: string;
  client_upload_id: string;
  blob_version: string;
  sha256: string;
  media_type: string;
  size_bytes: number;
  scan_state: "quarantined" | "clean" | "rejected" | "failed";
  created_at: string;
}

/**
 * llm interpretation only
 */
export interface VerificationProposal {
  schema_version: "1.0.0";
  context: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    document_id: string;
    base_document_version: string | null;
    context_snapshot_id: string;
    template_id: string;
    template_version: string;
  };
  request_id: string;
  evidence_refs: {
    evidence_id: string;
    locator: string;
    conclusion: string;
  }[];
  candidate_conclusion: string;
  applicability_reason: string;
  unresolved: {
    id: string;
    question: string;
    impact: string;
    owner_role: "business" | "technical" | "security" | "product";
    blocking: "release" | "review" | "none";
    entity_ids: string[];
    status: "open" | "resolved" | "superseded";
    resolution_ref: string | null;
  }[];
  next_queries: {
    id: string;
    target: {
      system_id: string;
      client: string;
      release: string;
    };
    claim: string;
    object_type:
      "table" | "field" | "domain" | "transaction" | "interface" | "enhancement" | "authorization" | "behavior";
    candidate_name: string | null;
    scope: string;
    required_evidence: string;
    blocking: "release" | "review" | "none";
    related_ids: string[];
  }[];
}

export interface WithdrawFsBaselineCommand {
  document_version_id: string;
  reason: string;
}

export interface Workspace {
  id: string;
  fs_number: string;
  profile: "report" | "interface" | "enhancement" | "batch" | "tool" | "form";
  template_id: string;
  template_version: string;
  draft_head: {
    id: string;
    revision: string;
    formal_number: number | null;
    content_hash: string;
  } | null;
  review_head: {
    id: string;
    revision: string;
    formal_number: number | null;
    content_hash: string;
  } | null;
  baseline_head: {
    id: string;
    revision: string;
    formal_number: number | null;
    content_hash: string;
  } | null;
  revision: string;
}

export interface WorkspaceCreate {
  template_id: string;
  template_version: string;
  profile: "report" | "interface" | "enhancement" | "batch" | "tool" | "form";
  legacy_source_id: string | null;
}
