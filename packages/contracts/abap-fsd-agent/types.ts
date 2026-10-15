// Shapes specific to the abap-fsd-agent API: FSD versions and comments.
import type { AgentArtifactRef } from '../agent-core/types';

export interface DocumentComparison {
  actual: { heading: string; change: 'added' | 'modified' | 'removed' }[];
  undeclared: string[];
  unapplied: string[];
}

// One saved FSD version, as opened in the document panel.
export interface AgentArtifact extends AgentArtifactRef {
  markdown: string;
  comparison?: DocumentComparison;
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
