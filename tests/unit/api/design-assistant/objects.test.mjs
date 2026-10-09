import test from 'node:test';
import assert from 'node:assert/strict';
import { applyObjectChanges } from '../../../../apps/api/src/modules/design-assistant/objects.mjs';
const change = (id, dependencies = [], base_version = 0) => ({
  object_id: id,
  base_version,
  op: base_version ? 'REVISE' : 'ADD',
  content: 'synthetic ' + id,
  dependencies,
  reason: 'test',
  section: 6,
});
test('FLOW-05 atomic field/rule identities preserve versioned dependency endpoints', () => {
  const evidence = [{ id: 'e1', source_version: 'sap-v1' }];
  const first = applyObjectChanges(
    {},
    [change('field-quantity', ['e1']), change('rule-open', ['field-quantity'])],
    evidence,
  );
  assert.equal(first['field-quantity'].kind, 'FIELD');
  assert.deepEqual(first['rule-open'].dependency_links, [
    {
      source_id: 'rule-open',
      source_version: 1,
      target_id: 'field-quantity',
      target_version: 1,
      purpose: 'SUPPORTS',
    },
  ]);
  const revised = applyObjectChanges(
    first,
    [
      { ...change('field-quantity', ['e1'], 1), content: 'revised unit' },
      change('rule-open', ['field-quantity'], 1),
    ],
    evidence,
  );
  assert.equal(revised['rule-open'].dependency_links[0].target_version, 2);
  assert.equal(first['field-quantity'].version, 1);
});
test('FLOW-05 omitted dependents and forged references block the complete transaction', () => {
  const first = applyObjectChanges(
    {},
    [change('field-quantity'), change('rule-open', ['field-quantity'])],
    [],
  );
  assert.throws(() => applyObjectChanges(first, [change('field-quantity', [], 1)], []), {
    code: 'DEPENDENCY_REVIEW_REQUIRED',
  });
  assert.throws(() => applyObjectChanges({}, [change('rule-open', ['missing'])], []), {
    code: 'UNKNOWN_REFERENCE',
  });
  assert.equal(first['field-quantity'].version, 1);
});
