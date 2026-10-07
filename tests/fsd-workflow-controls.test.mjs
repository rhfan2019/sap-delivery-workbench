import test from 'node:test';
import assert from 'node:assert/strict';
import {
  workflowActions,
  finalGenerationText,
  workflowReviewKey,
  workflowArtifactToSync,
} from '../apps/web/src/features/fs-assistant-test/workflowActions.mjs';

test('refreshed revision invalidates review approval and syncs active artifact once', () => {
  const artifact = { id: 'v2', contentHash: 'new', revision: 2 };
  const refreshed = { activeRevisionId: 'v2', activeContentHash: 'new', activeArtifact: artifact };
  assert.equal(workflowArtifactToSync(refreshed, 'v1'), artifact);
  assert.equal(workflowArtifactToSync(refreshed, 'v2'), null);
  assert.notEqual(
    workflowReviewKey(refreshed),
    workflowReviewKey({ activeRevisionId: 'v1', activeContentHash: 'old' }),
  );
  assert.notEqual(
    workflowReviewKey(refreshed),
    workflowReviewKey({ ...refreshed, activeContentHash: 'changed' }),
  );
  assert.equal(workflowReviewKey(null), '');
});

test('final generation works without reentering requirements and preserves entered refinements', () => {
  assert.equal(finalGenerationText('   '), '基于已确认初稿生成正式版');
  assert.equal(finalGenerationText('保留现有接口约束'), '保留现有接口约束');
});

test('approvals require the correct phase and a bound saved revision', () => {
  const state = {
    phase: 'draft_review',
    activeRevisionId: 'a',
    activeContentHash: 'hash',
    revisions: [{ id: 'a' }],
  };
  assert.equal(workflowActions(state).approveDraft, true);
  assert.equal(workflowActions(state).approveFinal, false);
  assert.equal(workflowActions({ ...state, activeContentHash: null }).approveDraft, false);
  assert.equal(workflowActions({ ...state, phase: 'final_review' }).approveFinal, true);
});
test('busy, readonly and active remote runs prevent all mutations', () => {
  const state = {
    phase: 'final_review',
    activeRevisionId: 'a',
    activeContentHash: 'hash',
    revisions: [{ id: 'a' }],
  };
  for (const actions of [
    workflowActions(state, true),
    workflowActions(state, false, true),
    workflowActions({ ...state, activeRunId: 'run' }),
  ]) {
    assert.deepEqual(Object.values(actions), [false, false, false, false]);
  }
  assert.equal(workflowActions(null).rollback, false);
});
