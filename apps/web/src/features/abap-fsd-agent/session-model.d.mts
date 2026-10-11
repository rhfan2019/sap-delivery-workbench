import type {
  AgentDecision,
  AgentMessage,
  AgentStep,
} from '@sap-delivery-workbench/contracts/abap-fsd-agent/types';

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
  call: { id?: string; name: string; status: string; summary?: string; createdAt?: string },
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
}): AgentMessage[];
export function pendingQuestions(detail: any): { id: string; questions: AskedQuestion[] } | null;
