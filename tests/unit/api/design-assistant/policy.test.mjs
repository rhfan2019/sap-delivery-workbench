import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticModel } from '../../../../apps/api/src/modules/design-assistant/simulation.mjs';
import {
  validateOutput,
  validateAnswer,
  validateTool,
  validateEvidence,
  DEFAULT_BUDGET,
  validateBudget,
  assertConfirmation,
  safeError,
} from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
test('TOOL-02 structured failures expose bounded next actions, never provider instructions', () => {
  assert.deepEqual(safeError({ code: 'AUTH_DENIED', next_actions: ['DELETE_DATA'] }).next_actions, [
    'RESTORE_ACCESS',
    'SUPPLY_MATERIAL',
  ]);
  assert.deepEqual(safeError({ code: 'NOT_FOUND_UNCONFIRMED' }).next_actions, [
    'VERIFY_TARGET_AND_COVERAGE',
    'SUPPLY_MATERIAL',
  ]);
  assert.equal(safeError({ code: 'UNSUPPORTED' }).retryable, false);
  assert.equal(safeError({ code: 'UNKNOWN_CAUSE', retryable: true }).retryable, false);
  assert.equal(safeError({ code: 'TIMEOUT' }).retryable, true);
});
test('MODEL-01 expected output kind and nested evidence references are enforced', async () => {
  const context = {
    t: { evidence: [], artifact_version: null },
    r: { input_snapshot_id: 's', snapshot: { answers: {} } },
  };
  const { output } = await syntheticModel({ kind: 'EvidenceAssessment', context });
  assert.throws(
    () =>
      validateOutput(output, { snapshotId: 's', expectedKind: 'AnalysisResult', evidenceIds: [] }),
    /INVALID_OUTPUT/,
  );
  output.assessments = [
    {
      evidence_ref: 'forged',
      completeness: 'COMPLETE',
      fact_status: 'VERIFIED',
      validity: 'VALID',
      missing_properties: [],
      conflicts: [],
    },
  ];
  assert.throws(
    () =>
      validateOutput(output, {
        snapshotId: 's',
        expectedKind: 'EvidenceAssessment',
        evidenceIds: [],
      }),
    /UNKNOWN_REFERENCE/,
  );
});

test('MODEL-01 / STATE-05 closed output rejects invented commands and stale snapshots', () => {
  assert.throws(
    () => validateOutput({ kind: 'AnalysisResult', goto: 'DELIVERED' }, { snapshotId: 's' }),
    /INVALID_OUTPUT/,
  );
});
test('FLOW-02 fixed answers require actual option, other explanation and readable materials', () => {
  const q = {
    id: 'q',
    options: [
      { id: 'a', requires_material: true },
      { id: 'other', other: true },
    ],
  };
  assert.throws(() => validateAnswer(q, { option_id: 'fake' }, []), /INVALID_ANSWER/);
  assert.throws(() => validateAnswer(q, { option_id: 'other', text: ' ' }, []), /INVALID_ANSWER/);
  assert.throws(
    () => validateAnswer(q, { option_id: 'a', attachment_ids: [] }, []),
    /INVALID_ANSWER/,
  );
  assert.equal(validateAnswer(q, { option_id: 'other', text: '明确说明' }, []).option_id, 'other');
});
test('TOOL-01 no writes, SQL, arbitrary target or external URL', () => {
  for (const tool_name of ['setObjectSource', 'runProgram', 'runQuery'])
    assert.throws(
      () => validateTool({ tool_name, arguments: {} }, { target_ref: 't' }),
      /TOOL_DENIED/,
    );
  assert.throws(
    () =>
      validateTool(
        {
          tool_name: 'objectStructure',
          target_ref: 't',
          arguments: { objectUrl: 'https://evil.test/sap/bc/adt/x' },
        },
        { target_ref: 't', allowed_urls: [] },
      ),
    /INVALID_TOOL_INPUT/,
  );
});
test('TOOL-03/05/06 missing properties, wrong target and unknown versions stay unverified', () => {
  const e = {
    target_ref: 't',
    client: '100',
    source_version: '1',
    observed_at: new Date().toISOString(),
    coverage: { complete: true, properties: ['type'] },
    validity: 'VALID',
  };
  assert.equal(validateEvidence(e, { target_ref: 'other', client: '100' }, ['type']).valid, false);
  assert.equal(validateEvidence(e, { target_ref: 't', client: '100' }, ['currency']).valid, false);
  assert.equal(
    validateEvidence({ ...e, source_version: null }, { target_ref: 't', client: '100' }, ['type'])
      .valid,
    false,
  );
});
test('MODEL-06 budgets reject missing, infinite and expanded unvalidated limits', () => {
  // 40: FSD chapters are proposed per group (implementation log I-02), not 05 §9.1's 12.
  assert.equal(validateBudget(DEFAULT_BUDGET).run_model_calls, 40);
  for (const b of [
    {},
    { ...DEFAULT_BUDGET, run_model_calls: Infinity },
    { ...DEFAULT_BUDGET, run_model_calls: 0 },
  ])
    assert.throws(() => validateBudget(b), /INVALID_BUDGET/);
});
test('STATE-06 confirmation is explicit, version and scope bound', () => {
  const wait = { status: 'OPEN', artifact_id: 'a', artifact_version: 2, scope: ['report'] };
  assert.throws(
    () =>
      assertConfirmation(wait, {
        artifact_id: 'a',
        artifact_version: 1,
        scope: ['report'],
        confirmed: true,
      }),
    /STALE_CONFIRMATION/,
  );
  assert.throws(
    () =>
      assertConfirmation(wait, {
        artifact_id: 'a',
        artifact_version: 2,
        scope: ['part'],
        confirmed: true,
      }),
    /INVALID_CONFIRMATION/,
  );
  assertConfirmation(wait, {
    artifact_id: 'a',
    artifact_version: 2,
    scope: ['report'],
    confirmed: true,
  });
});
