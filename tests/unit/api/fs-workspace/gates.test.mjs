import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReleaseGates } from '../../../../apps/api/src/modules/fs-workspace/review/gates.mjs';
import { documentHash } from '../../../../apps/api/src/modules/fs-workspace/document/ast.mjs';
import { document, template } from '../../../fixtures/fs-workspace/document.mjs';
test('verified labels without a complete bound server receipt cannot pass technical release gate', () => {
  const ast = document();
  ast.verifications = [
    {
      id: 'v',
      target: { system_id: 'S', client: '100', release: '1' },
      claim: '字段存在',
      object_name: 'FIELD',
      scope: 'metadata',
      status: 'verified',
      evidence_ids: ['fake'],
      checked_at: '2026-10-03T00:00:00Z',
      valid_until: '2099-01-01T00:00:00Z',
      limitations: [],
      applicability: 'supported',
      applicability_reason: '标记',
    },
  ];
  const gates = evaluateReleaseGates(
    { ast, template, content_hash: documentHash(ast, template) },
    { entities: [], evidence: [] },
  );
  assert.ok(gates.some((g) => g.rule_id === 'TECHNICAL_VERIFICATION' && !g.passed));
});
