export function workflowActions(state, busy = false, readonly = false) {
  const enabled = !!state && !busy && !readonly && !state.activeRunId;
  const bound = enabled && !!state.activeRevisionId && !!state.activeContentHash;
  return {
    approveDraft: !!bound && state.phase === 'draft_review',
    approveFinal: !!bound && state.phase === 'final_review',
    revise: !!bound && ['draft_review', 'final_review', 'completed'].includes(state.phase),
    rollback: !!enabled && state.revisions.length > 0,
  };
}
export function finalGenerationText(draft) {
  return draft.trim() ? draft : '基于已确认初稿生成正式版';
}
export function workflowReviewKey(state) {
  return state?.activeRevisionId && state.activeContentHash
    ? `${state.activeRevisionId}:${state.activeContentHash}`
    : '';
}
export function workflowArtifactToSync(state, currentId) {
  return state?.activeArtifact && state.activeArtifact.id !== currentId
    ? state.activeArtifact
    : null;
}
