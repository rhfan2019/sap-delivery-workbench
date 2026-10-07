export interface ModelConfig {
  name: string;
  provider: string;
  protocol: 'openai_chat' | 'openai_responses' | 'anthropic_messages';
  baseUrl: string;
  modelId: string;
}
export interface ModelTest {
  status: 'running' | 'passed' | 'failed' | 'timeout';
  message: string;
  startedAt: string;
  expiresAt: string | null;
  latencyMs: number | null;
  adapter: string;
}
export interface ModelRecord extends ModelConfig {
  id: string;
  rowVersion: string;
  versionId: string;
  versionNo: string;
  credentialReady: boolean;
  isDefault: boolean;
  test: ModelTest | null;
  structuredTest?: ModelTest | null;
}
export interface ModelList {
  items: ModelRecord[];
  defaultModel: { id: string; versionId: string; name: string } | null;
  defaultRevision: string;
}
export function canDefault(model: ModelRecord, now = Date.now()) {
  return (
    model.test?.status === 'passed' &&
    !!model.test.expiresAt &&
    Date.parse(model.test.expiresAt) > now
  );
}
export const protocolNames = {
  openai_chat: 'OpenAI Chat',
  openai_responses: 'OpenAI Responses',
  anthropic_messages: 'Anthropic Messages',
};
