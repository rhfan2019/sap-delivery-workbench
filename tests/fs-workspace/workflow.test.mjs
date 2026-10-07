import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionWorkflow,
  assertGenerationState,
} from '../../apps/api/src/abap-fsd-agent/workflow.mjs';
const draft = {
  phase: 'draft_review',
  version: '2',
  activeRevisionId: 'a',
  activeContentHash: 'h',
  draftApproval: null,
};
test('approval binds exact version and hash', () => {
  assert.throws(() =>
    transitionWorkflow(
      draft,
      { command: 'approve_draft', expectedVersion: '1', revisionId: 'a', contentHash: 'h' },
      'u',
    ),
  );
  assert.throws(() =>
    transitionWorkflow(
      draft,
      { command: 'approve_draft', expectedVersion: '2', revisionId: 'a', contentHash: 'wrong' },
      'u',
    ),
  );
  const next = transitionWorkflow(
    draft,
    { command: 'approve_draft', expectedVersion: '2', revisionId: 'a', contentHash: 'h' },
    'u',
  );
  assert.equal(next.phase, 'refining');
  assert.equal(next.draftApproval.contentHash, 'h');
});
test('generation cannot bypass review or use stale state', () => {
  assert.throws(() => assertGenerationState(draft, draft));
  assert.throws(() =>
    assertGenerationState(
      { ...draft, phase: 'analysis' },
      { ...draft, phase: 'analysis', version: '1' },
    ),
  );
  assert.doesNotThrow(() =>
    assertGenerationState({ ...draft, phase: 'analysis' }, { ...draft, phase: 'analysis' }),
  );
});
test('draft revision invalidates approval and final revision retains draft basis', () => {
  const revise = transitionWorkflow(draft, { command: 'revise', expectedVersion: '2' }, 'u');
  assert.equal(revise.phase, 'analysis');
  assert.equal(revise.draftApproval, null);
  const final = { ...draft, phase: 'completed', draftApproval: { revisionId: 'original' } };
  assert.equal(
    transitionWorkflow(final, { command: 'revise', expectedVersion: '2' }, 'u').phase,
    'refining',
  );
});
