import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  schemas,
  validateDomain,
  validateProposal,
  validateCommand,
} from '@sap-delivery-workbench/contracts/fs-workspace';

const fixture = async (name) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../fixtures/fs-workspace/specification/examples/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );

test('reject_authority_fields_and_missing_context', async () => {
  for (const kind of [
    'FsProposal',
    'VerificationProposal',
    'RequirementAnalysis',
    'Clarification',
    'ChangeSet',
    'ReviewResult',
    'OrchestratorPlan',
  ]) {
    const value = await fixture(`${kind}.valid`);
    assert.equal(validateProposal(kind, value).ok, true, kind);
    assert.equal(validateProposal(kind, { ...value, lifecycle: 'approved' }).ok, false);
    const missing = structuredClone(value);
    delete missing.context;
    assert.equal(validateProposal(kind, missing).ok, false);
  }
  const value = await fixture('VerificationProposal.valid');
  assert.equal(
    validateProposal('VerificationProposal', { ...value, status: 'verified' }).ok,
    false,
  );
});

test('unknown evidence passes only structure and requires L4', async () => {
  const value = await fixture('REF_NOT_FOUND.semantic-invalid');
  assert.equal(validateProposal('RequirementAnalysis', value).ok, true);
});

test('commands reject authority, invalid UUIDs and unknown operations without mutating input', () => {
  const value = {
    template_id: 'traditional-abap-five',
    template_version: '1.0.0',
    profile: 'report',
    legacy_source_id: null,
  };
  assert.equal(validateCommand('createFsWorkspace', value).ok, true);
  assert.equal(validateCommand('createFsWorkspace', { ...value, actor_id: 'forged' }).ok, false);
  assert.equal(
    validateCommand('createFsWorkspace', { ...value, legacy_source_id: 'bad' }).ok,
    false,
  );
  assert.equal(validateCommand('notAnOperation', {}).ok, false);
  assert.equal(validateProposal('FsDocument', {}).ok, false);
  const before = structuredClone(value);
  validateCommand('createFsWorkspace', value);
  assert.deepEqual(value, before);
});

test('all domain and event examples validate and authority additions fail', async () => {
  for (const kind of [
    'FsDocument',
    'RequirementRecord',
    'DecisionRecord',
    'EvidenceRecord',
    'ApprovalRecord',
    'RunEvent',
    'UploadReceipt',
    'RunCheckpoint',
    'ExportManifest',
  ]) {
    assert.equal(validateDomain(kind, await fixture(`${kind}.valid`)).ok, true, kind);
    assert.equal(validateDomain(kind, await fixture(`${kind}.invalid`)).ok, false, kind);
  }
});

test('manual edit resolves Block refs offline and rejects nested authority', async () => {
  const proposal = await fixture('FsProposal.valid');
  const value = {
    base_document_version: '37c3f7df-f441-4e98-9b0c-13f76135da48',
    block_id: 'block-1',
    before_hash: 'hash',
    new_block: proposal.sections[0].blocks[0],
    reason: '人工修订',
  };
  assert.equal(validateCommand('proposeFsManualEdit', value).ok, true);
  value.new_block.verified = true;
  assert.equal(validateCommand('proposeFsManualEdit', value).ok, false);
});

test('RuleDetail enforces decimal strings, nested closed objects and required scope', () => {
  assert.ok(schemas.RuleDetail);
  const rule = {
    id: 'r',
    revision: '1',
    applicability: [],
    input_refs: [],
    output_refs: [],
    algorithm_summary: '',
    authorization_refs: [],
    exception_refs: [],
    test_refs: [],
    currency_policy: {
      currencies: ['CNY'],
      scale_source: 'currency',
      rounding: 'half_up',
      tolerance_decimal: '0.01',
      cross_currency_allowed: false,
    },
    unit_policy: null,
    confirmation_subject: { id: 'r', revision: '1', hash: 'hash' },
    open_issue_ids: [],
  };
  assert.equal(validateDomain('RuleDetail', rule).ok, true);
  rule.currency_policy.tolerance_decimal = 0.01;
  assert.equal(validateDomain('RuleDetail', rule).ok, false);
});

test('workflow auxiliary DTOs are registered and reject incomplete authority records', () => {
  for (const name of ['UploadReceipt', 'RunCheckpoint', 'ExportManifest']) {
    assert.ok(schemas[name], name + ' must be a runtime contract');
    assert.equal(validateDomain(name, {}).ok, false);
  }
});
