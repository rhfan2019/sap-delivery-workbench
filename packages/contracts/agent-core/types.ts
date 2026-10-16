// Shapes every agent API shares with the browser: conversation, steps, questions, files.

export interface AgentStep {
  stepId: string;
  label: string;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  attempt: number;
  summary: string;
  startedAt: string | null;
  finishedAt: string | null;
  dependencies?: string[];
  // The tool behind the step, its arguments (an object, or the raw start of them while they
  // stream) and a readable preview of the result.
  name?: string;
  input?: unknown;
  preview?: AgentToolPreview | null;
  durationMs?: number;
}

export type AgentToolPreview =
  | { kind: 'table'; columns: string[]; rows: string[][]; total: number }
  | {
      kind: 'objects';
      items: { name: string; type: string; description: string }[];
      total: number;
    }
  | { kind: 'text' | 'error'; text: string };

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

// A version an agent saved in a turn; each agent adds its own fields.
export interface AgentArtifactRef {
  id: string;
  revision: number;
  markdown?: string;
  labels?: string[];
  comparison?: any;
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
  artifact?: AgentArtifactRef;
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
  version?: number | null;
}

export interface AgentAttachment {
  id: string;
  fileName: string;
  size: number;
  parseState: string;
  warnings: string[];
  text?: string;
}
