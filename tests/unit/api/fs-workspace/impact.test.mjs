import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeImpact,
  selectAtomicOperations,
} from '../../../../apps/api/src/modules/fs-workspace/changes/impact.mjs';
test('reverse_dependency_closure_with_cycle is deterministic and does not walk forward', () => {
  const graph = {
    nodes: [
      { id: 'rule', kind: 'rule' },
      { id: 'test', kind: 'test' },
      { id: 'section', kind: 'section' },
      { id: 'other', kind: 'rule' },
    ],
    edges: [
      { source: 'test', target: 'rule' },
      { source: 'section', target: 'test' },
      { source: 'rule', target: 'section' },
      { source: 'rule', target: 'other' },
    ],
  };
  assert.deepEqual(
    computeImpact(graph, ['rule']).map((i) => i.entity_id),
    ['rule', 'section', 'test'],
  );
  assert.throws(() => computeImpact(graph, ['rule'], { maxNodes: 1 }), /budget/i);
});
test('reject_partial_atomic_group and dependencies outside selected groups', () => {
  const change = {
    operations: [
      { target_id: 'r', value: { depends_on: [] } },
      { target_id: 't', value: { depends_on: ['r'] } },
    ],
    atomic_groups: [
      { id: 'rule', operation_target_ids: ['r'] },
      { id: 'test', operation_target_ids: ['t'] },
    ],
  };
  assert.throws(() => selectAtomicOperations(change, ['test']), /dependency/i);
  assert.equal(selectAtomicOperations(change, ['rule', 'test']).length, 2);
  assert.throws(() => selectAtomicOperations(change, ['missing']), /group/i);
});

test('server graph rejects omitted reverse dependencies even when candidate omits depends_on', () => {
  const change = {
    operations: [
      { target_id: 'rule', value: {} },
      { target_id: 'test', value: {} },
    ],
    atomic_groups: [
      { id: 'r', operation_target_ids: ['rule'] },
      { id: 't', operation_target_ids: ['test'] },
    ],
  };
  const graph = { nodes: [], edges: [{ source: 'test', target: 'rule' }] };
  assert.throws(() => selectAtomicOperations(change, ['r'], graph), /dependency/i);
  assert.equal(selectAtomicOperations(change, ['r', 't'], graph).length, 2);
});
