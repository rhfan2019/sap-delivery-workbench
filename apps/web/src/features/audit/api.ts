import { api } from '../../services/session';
import { toQueryString } from './audit.mjs';

export const auditBase = '/audit';
export interface Named {
  id: string;
  code: string;
  name: string;
}
export interface RunRow {
  id: string;
  session_id: string;
  status: string;
  stop_reason: string | null;
  model: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  error_code: string | null;
  error_message: string | null;
  project: Named;
  item: Named;
  user_name: string;
  model_calls: number;
  tool_calls: number;
  tool_failures: number;
  prompt: string | null;
  document_version: number | null;
  comments: number;
}
export interface Facets {
  models: string[];
  statuses: string[];
  projects: (Named & { items: Named[] })[];
}
export interface AuditComment {
  id: string;
  body: string;
  author: string;
  created_at: string;
  mine: boolean;
}
export interface RunDetail {
  run: RunRow;
  messages: { seq: number; role: string; content: string; payload: any; created_at: string }[];
  toolCalls: {
    name: string;
    arguments: Record<string, unknown>;
    status: string;
    result: string;
    duration_ms: number;
    created_at: string;
    gap_ms: number;
  }[];
  document: {
    version: number;
    length: number;
    changes: any[];
    comparison: { actual: { heading: string }[]; undeclared: string[]; unapplied: string[] };
  } | null;
  comments: AuditComment[];
}
export interface Stats {
  totals: {
    runs: number;
    completed: number;
    asked: number;
    failed: number;
    cancelled: number;
    interrupted: number;
    avg_duration_ms: number | null;
    prompt_tokens: number;
    completion_tokens: number;
    tool_calls: number;
    tool_failures: number;
  };
  failure_rate: number | null;
  ask_rate: number | null;
  tool_failure_rate: number | null;
  stop_reasons: { reason: string; count: number; title: string }[];
  tools: { name: string; calls: number; failures: number; avg_ms: number; max_ms: number }[];
  models: {
    model: string | null;
    runs: number;
    failures: number;
    avg_duration_ms: number | null;
    max_duration_ms: number | null;
    tokens: number;
  }[];
  daily: { day: string; total: number; failed: number }[];
}
export interface Trend {
  session: { id: string; title: string; created_at: string; project: Named; item: Named };
  rounds: RunRow[];
}
export interface AuditEvent {
  id: string;
  occurred_at: string;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  subject_type: string | null;
  subject_id: string | null;
  details: Record<string, unknown>;
  actor: string | null;
  actor_login: string | null;
}
export interface Proposal {
  id: string;
  title: string;
  markdown?: string;
  period_from: string | null;
  period_to: string | null;
  sources: { runs?: number; comments?: number };
  author: string;
  created_at: string;
}
type Query = Record<string, string | number | undefined>;
const get = <T>(path: string, query: Query = {}, signal?: AbortSignal) =>
  api<T>(auditBase + path + toQueryString(query), undefined, undefined, { signal });
type Page<T> = { items: T[]; total: number; offset: number; page_size: number };

export const auditApi = {
  facets: () => get<Facets>('/runs/facets'),
  runs: (q: Query, signal?: AbortSignal) => get<Page<RunRow>>('/runs', q, signal),
  run: (id: string) => get<RunDetail>('/runs/' + encodeURIComponent(id)),
  comment: (id: string, body: string) =>
    api<AuditComment[]>(
      auditBase + '/runs/' + encodeURIComponent(id) + '/comments',
      { body },
      'POST',
    ),
  removeComment: (id: string) =>
    api(auditBase + '/comments/' + encodeURIComponent(id), {}, 'DELETE'),
  trend: (sessionId: string) => get<Trend>('/sessions/' + encodeURIComponent(sessionId) + '/trend'),
  stats: (q: Query) =>
    get<Stats>('/stats', { ...q, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  events: (q: Query, signal?: AbortSignal) =>
    get<Page<AuditEvent> & { actions: string[] }>('/events', q, signal),
  proposals: () => get<Proposal[]>('/proposals'),
  proposal: (id: string) => get<Proposal>('/proposals/' + encodeURIComponent(id)),
  exportUrl: (q: Query, format: 'md' | 'json', detail = false) =>
    '/api' + auditBase + '/export' + toQueryString({ ...q, format, detail: detail ? '1' : '' }),
};
