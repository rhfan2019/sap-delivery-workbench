import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executor } from '../../../apps/api/src/abap-fsd-agent/executor.mjs';
import { planRun } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
import { validateDraft } from '../../../apps/api/src/abap-fsd-agent/specification.mjs';
import { validateSpecContract } from '../../../packages/contracts/abap-fsd-agent/fsd/v1/validate.mjs';

test('revision preserves existing server issues without duplicate IDs or references', async () => {
  const spec = JSON.parse(
    readFileSync(
      new URL('../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
    ),
  );
  const issue = (id, category, relatedIds) => ({
    id,
    category,
    relatedIds,
    description: '已有真实缺口',
    impact: '需复核',
    priority: 'medium',
    status: 'open',
    suggestion: '补证',
    owner: '顾问',
    followUp: '核对',
    resolution: null,
  });
  spec.issues.push(issue('SYS-900', 'system', []));
  spec.issues.push(issue('SAPGAP-001', 'sap_object', [spec.sapObjects[0].id]));
  spec.sapObjects[0].issueIds.push('SAPGAP-001');
  assert.equal(validateDraft(spec).valid, true);
  let saved;
  await executor({
    action: 'draft',
    plan: planRun({ request: '报表', action: 'draft' }),
    context: { messages: [], manifest: { sources: spec.sources } },
    profile: { systemId: null, identificationSource: 'unknown', profile: {}, evidence: [] },
    verify: { systemId: null },
    persist: async () => {},
    save: async ({ spec }) => {
      saved = spec;
      return { id: 'artifact', revision: 2 };
    },
  })({
    run: { id: 'issue-merge' },
    invoke: async ({ onDelta }) => {
      onDelta(JSON.stringify(spec));
      return {};
    },
    signal: new AbortController().signal,
    emit() {},
  });
  assert.ok(saved);
  assert.equal(validateSpecContract(saved).valid, true);
  assert.equal(saved.issues.filter((i) => i.id === 'SYS-900').length, 1);
  assert.equal(saved.issues.filter((i) => i.id === 'SAPGAP-001').length, 1);
  assert.equal(saved.sapObjects[0].issueIds.filter((id) => id === 'SAPGAP-001').length, 1);
});
