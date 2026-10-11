import { event } from './repository.mjs';
import { fault } from './policy.mjs';

// What a failed content check does to the run. PASS records a quality.issue event and lets
// the FSD be written; the user corrects it in the conversation and the log is reviewed
// later. BLOCK stops the run with the code given. Only checks of the content belong here:
// authorization, leases, versions and the read-only SAP guard always stop a run.
// An unclear requirement, a SAP read that failed or a table the model got wrong is not a
// reason to withhold the FSD.
export const QUALITY_POLICY = Object.freeze({
  // A planned SAP read outside the approved objects or with invalid arguments.
  TOOL_REJECTED: { severity: 'PASS', code: 'INVALID_TOOL_INPUT' },
  // A SAP read that failed or came back incomplete.
  QUERY_FAILED: { severity: 'PASS', code: 'PARTIAL_RESULT' },
  // Query rounds used up, or the same reads planned again.
  NO_PROGRESS: { severity: 'PASS', code: 'NO_PROGRESS' },
  // No SAP evidence still valid when the draft is saved or delivered.
  STALE_EVIDENCE: { severity: 'PASS', code: 'STALE_EVIDENCE' },
  // Draft content the content model rejects; it is removed and listed as an open issue.
  DOCUMENT_INVALID: { severity: 'PASS', code: 'INVALID_OUTPUT' },
  // A revision for review findings that changed nothing.
  REVIEW_NOT_APPLIED: { severity: 'PASS', code: 'REVIEW_NOT_APPLIED' },
  // Delivery while open issues marked 阻断=是 remain.
  BLOCKING_ISSUES: { severity: 'BLOCK', code: 'DELIVERY_BLOCKED' },
});

/** Records one failed check inside the caller's transaction; throws when it blocks. */
export async function qualityIssue(db, taskId, runId, check, details = {}) {
  const policy = QUALITY_POLICY[check];
  if (!policy) throw new Error('unknown quality check ' + check);
  await event(db, taskId, runId, 'quality.issue', {
    check,
    severity: policy.severity,
    ...details,
  });
  if (policy.severity === 'BLOCK') throw fault(policy.code, 'OUTPUT_VALIDATION');
}
