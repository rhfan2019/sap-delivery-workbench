import type { FsdWorkflow } from '@sap-delivery-workbench/contracts/agent-runtime/types';
export function workflowReviewKey(state: FsdWorkflow | null): string;
export function workflowArtifactToSync(
  state: FsdWorkflow | null,
  currentId?: string,
): FsdWorkflow['activeArtifact'] | null;
export function finalGenerationText(draft: string): string;
export function workflowActions(
  state: FsdWorkflow | null,
  busy?: boolean,
  readonly?: boolean,
): {
  approveDraft: boolean;
  approveFinal: boolean;
  revise: boolean;
  rollback: boolean;
};
