import type {
  AgentDecision,
  AgentMessage,
  AgentStep,
} from '@sap-delivery-workbench/contracts/agent-core/types';

export interface AskedQuestion {
  question: string;
  background: string;
  options: { label: string; impact: string }[];
  recommended: string;
  reason: string;
  why_customer: string;
}
export function toolLabel(name: string): string;
export function stepFromToolCall(
  call: {
    id?: string;
    name: string;
    status: string;
    summary?: string;
    createdAt?: string;
    arguments?: unknown;
    preview?: AgentStep['preview'];
    durationMs?: number;
  },
  index?: number,
): AgentStep;
export function decisionFromQuestions(id: string, questions: AskedQuestion[]): AgentDecision;
export function answersFromValues(
  questions: AskedQuestion[],
  values: Record<string, string>,
): { question: string; choice: string; note?: string }[];
export function buildTimeline(detail: {
  messages?: any[];
  turns?: any[];
  toolCalls?: any[];
  documents?: any[];
  versions?: any[];
}): AgentMessage[];
export function pendingQuestions(detail: any): { id: string; questions: AskedQuestion[] } | null;
export interface TestDataRequest {
  id: string;
  dataId: string;
  object: string;
  purpose: string;
  keyData: string;
  body: string;
  functions: string[];
  target: { environment: string; systemCode: string; systemName: string; client: string | null };
}
export function pendingTestData(detail: any): TestDataRequest | null;
export interface RunActivity {
  id: string;
  title: string;
  detail: string;
  count: number;
  failures: number;
  status: 'running' | 'succeeded';
  steps: AgentStep[];
}
export function sectionsOf(input: unknown): string[];
export function stepObjects(step: AgentStep): { group: string; name: string }[];
export function objectsText(groups: { group: string; names: string[] }[], limit?: number): string;
export function activitiesFromSteps(steps?: AgentStep[]): RunActivity[];
export function activitySummary(steps?: AgentStep[]): string;
export function runningText(step: AgentStep): string;
export function preparingText(prepare: {
  name: string;
  chars?: number;
  sections?: string[];
}): string;
export function reasoningHeading(text?: string): string;
