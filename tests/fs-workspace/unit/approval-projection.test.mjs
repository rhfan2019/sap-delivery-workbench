import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalProjection } from '../../../apps/api/src/fs-workspace/review/decisions.mjs';
test('latest role decision supersedes approval and must bind exact content and policy', () => {
  const binding = {
    document_revision_id: 'doc',
    document_hash: 'hash',
    manifest_hash: 'manifest',
    policy_version: 'policy',
  };
  const approved = { ...binding, role: 'technical_reviewer', action: 'approve' };
  assert.equal(approvalProjection([approved], binding).technical_approved, true);
  assert.equal(
    approvalProjection([approved, { ...approved, action: 'reject' }], binding).technical_approved,
    false,
  );
  assert.equal(
    approvalProjection([{ ...approved, manifest_hash: 'old' }], binding).technical_approved,
    false,
  );
});
