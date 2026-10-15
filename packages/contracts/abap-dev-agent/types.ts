// Shapes specific to the abap-dev-agent API: versions of the development plan and code.

export type DevTarget = 'plan' | 'code';
export type DevSource = 'assistant' | 'upload' | 'sap';

export interface DevBasisEntry {
  key: string;
  type: 'item' | 'fsd' | 'file' | 'attachment' | 'framework';
  label: string;
  digest: string;
}

export interface DevComparison {
  plan?: {
    actual: { heading: string; change: string }[];
    undeclared: string[];
    unapplied: string[];
  };
  code?: { added: number; removed: number; undeclared: boolean };
}

export interface DevVersion {
  version: number;
  plan: string;
  code: string;
  source: DevSource;
  sourceRef: string | null;
  basis: DevBasisEntry[];
  changes: any[];
  comparison: DevComparison;
  labels: string[];
  createdAt: string;
}

export interface DevVersionSummary {
  version: number;
  source: DevSource;
  sourceRef: string | null;
  labels: string[];
  basis: DevBasisEntry[];
  comparison: DevComparison;
  createdAt: string;
  planLength: number;
  codeLines: number;
  turnId: string | null;
}

export interface DevComment {
  id: string;
  target: DevTarget;
  anchorText: string;
  anchorVersion: number;
  anchorLine: number | null;
  body: string;
  status: 'open' | 'resolved' | 'stale';
  replies: { body: string; by: string; at: string }[];
  authorName: string;
  createdAt: string;
}

export interface DevDiff {
  target: DevTarget;
  from: number | null;
  to: number;
  added: number;
  removed: number;
  hunks: { newStart: number; lines: string[] }[];
}
