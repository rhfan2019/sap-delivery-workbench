import type { Component } from 'vue';
import type { AgentSession } from '@sap-delivery-workbench/contracts/agent-core/types';

// What differs between the assistants sharing the item workspace: API, wording and the
// panel that shows what the agent produced (FSD document, or plan and code).
export interface StageConfig {
  agent: 'abap-fsd-agent' | 'abap-dev-agent';
  assistantName: string;
  readonlyNote: string;
  sessionsHeading: string;
  development: boolean;
  // SAP system a message reads unless the user picks another (contract 1.12).
  sapEnvironment: 'DEV' | 'QAS';
  artifactPanel: Component;
  // Revision of the newest saved version in a session detail.
  latestRevision: (detail: any) => number | undefined;
  // Suffix of a session row, e.g. ' · 文档第 2 版'.
  sessionVersion: (session: AgentSession) => string;
}
