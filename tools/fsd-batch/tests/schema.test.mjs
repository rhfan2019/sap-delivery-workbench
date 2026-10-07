import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  draftInstructions,
  validateDraft,
} from '../../../apps/api/src/abap-fsd-agent/specification.mjs';
test('model-facing schema cannot issue consultant confirmation', () => {
  const text = draftInstructions();
  const s = JSON.parse(text.slice(text.indexOf('{')));
  assert.deepEqual(s.$defs.decision.properties.status.enum, ['proposed', 'open']);
});
test('safe provenance checks include precise paths even when schema fails elsewhere', () => {
  const s = JSON.parse(
    readFileSync(
      new URL('../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
    ),
  );
  s.fields[0].mappingRule.status = 'consultant_confirmed';
  s.issues[0].relatedIds = ['systemContext'];
  const r = validateDraft(s);
  assert.ok(
    r.errors.some(
      (e) => e.code === 'untrusted_confirmation' && e.path === '/fields/0/mappingRule/status',
    ),
  );
  assert.ok(r.errors.some((e) => e.keyword === 'pattern'));
});
