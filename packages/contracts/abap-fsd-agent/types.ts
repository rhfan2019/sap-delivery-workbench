export type FsdPhase = 'analysis' | 'draft_review' | 'refining' | 'final_review' | 'completed';
export type FsdWorkflowCommand = 'approve_draft' | 'approve_final' | 'revise' | 'rollback';
export interface FsdWorkflow {
  phase: FsdPhase;
  version: string;
  activeRevisionId: string | null;
  activeRevision: number | null;
  activeContentHash: string | null;
  activeArtifact?: AgentArtifact | null;
  activeRunId: string | null;
  draftApproval: { revisionId: string; contentHash: string; actorId: string; at: string } | null;
  finalApproval: FsdWorkflow['draftApproval'];
  baselineId: string | null;
  updatedAt: string;
  updatedBy: string | null;
  revisions: {
    id: string;
    revision: number;
    contentHash: string;
    kind: string;
    createdAt: string;
  }[];
}
export interface AgentDecision {
  id: string;
  kind: 'type' | 'business';
  message: string;
  questions: {
    id: string;
    title: string;
    allowText?: boolean;
    options: { value: string; label: string; description: string; recommended?: boolean }[];
  }[];
}
export interface AgentSelection {
  workspaceStage?: 'design' | 'development';
  projectId?: string | null;
  itemId?: string | null;
  itemRowVersion?: string | null;
  systemId?: string | null;
  qasSystemId?: string | null;
  environment?: 'DEV' | 'QAS' | 'PRD';
  consultantVersion?: string;
}
export interface AgentMessage {
  steps?: AgentStep[];
  rendered?: {
    markdown: string;
    contractValid: boolean;
    sourceHash: string;
    rendererVersion: string;
  };
  decision?: AgentDecision;
  answers?: { question: string; label: string; value?: string; description?: string }[];
  answeredAt?: string;
  createdAt?: string;
  finishedAt?: string | null;
  authorName?: string | null;
  authorId?: string | null;
  clockOffsetMs?: number;
  artifact?: AgentArtifact;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'completed' | 'failed' | 'cancelled' | 'waiting_user';
  action?: 'dialogue' | 'draft';
  error?: string;
  errorCode?: string;
  finishReason?: string | null;
  outputLimit?: number | null;
  model?: string;
  runId?: string;
}
export interface SystemProfile {
  systemId: string | null;
  discoveryStatus: string;
  identificationSource: string;
  profile: {
    product: string | null;
    productVersion: string | null;
    abapRelease: string | null;
    deployment: string | null;
  };
  reason?: string;
  question: string | null;
  consultantStatement?: string;
  evidence: unknown[];
}
export interface AgentStep {
  dependencies?: string[];
  stepId: string;
  label: string;
  status: string;
  attempt: number;
  summary: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface AgentArtifact {
  runId?: string;
  id: string;
  spec: Record<string, unknown>;
  markdown: string;
  contentHash: string;
  revision: number;
}
export interface RunReceipt {
  createdAt?: string;
  serverTime?: string;
  action?: 'dialogue' | 'draft';
  conversationId?: string;
  plan?: { type: { riceType: string | null; reason: string }; steps: AgentStep[] };
  runId: string;
  systemProfile?: SystemProfile;
  systemTargets?: Record<
    'DEV' | 'QAS',
    { systemId: string | null; environment: string; purpose: string; profile: SystemProfile }
  >;
  association?: {
    projectId: string;
    itemId: string | null;
    itemCode?: string;
    rowVersion?: string;
  };
  manifest?: {
    included: string[];
    excluded: { id: string; reason: string }[];
    bytes: number;
    budgetBytes: number;
    rules: { file: string; version: string; sha256: string }[];
  };
  warnings?: string[];
}
