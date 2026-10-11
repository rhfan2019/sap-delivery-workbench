// Shapes shared by the abap-fsd-agent API and the browser.

export interface AgentStep {
  stepId: string;
  label: string;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  attempt: number;
  summary: string;
  startedAt: string | null;
  finishedAt: string | null;
  dependencies?: string[];
}

// ask_user questions as the decision card renders them.
export interface AgentDecision {
  id: string;
  kind: 'business';
  message: string;
  questions: {
    id: string;
    title: string;
    allowText?: boolean;
    options: { value: string; label: string; description: string; recommended?: boolean }[];
  }[];
}

export interface DocumentComparison {
  actual: { heading: string; change: 'added' | 'modified' | 'removed' }[];
  undeclared: string[];
  unapplied: string[];
}

// One saved FSD version, as opened in the document panel.
export interface AgentArtifact {
  id: string;
  revision: number;
  markdown: string;
  labels?: string[];
  comparison?: DocumentComparison;
  createdAt?: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'completed' | 'failed' | 'cancelled' | 'waiting_user';
  createdAt?: string;
  finishedAt?: string | null;
  authorName?: string | null;
  model?: string;
  runId?: string;
  steps?: AgentStep[];
  decision?: AgentDecision;
  answers?: { question: string; label: string }[];
  artifact?: AgentArtifact;
  error?: string;
  errorCode?: string;
  clockOffsetMs?: number;
}

export interface AgentSession {
  id: string;
  title: string;
  activeTurnId: string | null;
  createdAt: string;
  updatedAt: string;
  documentVersion?: number | null;
}

export interface AgentComment {
  id: string;
  anchorText: string;
  anchorVersion: number;
  body: string;
  status: 'open' | 'resolved';
  replies: { body: string; by: string; at: string }[];
  authorName: string;
  createdAt: string;
}

export interface AgentAttachment {
  id: string;
  fileName: string;
  size: number;
  parseState: string;
  warnings: string[];
  text?: string;
}
