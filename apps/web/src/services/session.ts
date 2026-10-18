import { ref } from 'vue';
export interface Identity {
  user: { id: string; loginName: string; displayName: string };
  organization: { id: string; name: string };
  mustChangePassword: boolean;
  // Organization-level permission codes (contract 3.5); project ones come per project.
  permissions: string[];
}
export interface Project {
  id: string;
  code: string;
  name: string;
  shortName: string;
  customerName: string;
  projectType: string;
  status: string;
  isPaused: boolean;
  description: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  currentPhase?: string | null;
  goLive?: string | null;
  health?: { overall: string; reportedOn: string } | null;
}
// The user's permissions in one project (GET /api/projects/:id/access).
export interface ProjectAccess {
  projectId: string;
  permissions: string[];
  // For the permissions narrowed by module or "own items": one entry per grant.
  limits: Record<string, { modules: string[]; ownOnly: boolean }[]>;
}
export const identity = ref<Identity | null>(null);
// Whether the signed-in user holds an organization-level permission.
export const can = (code: string) => !!identity.value?.permissions?.includes(code);
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  options?: { headers?: HeadersInit; signal?: AbortSignal },
): Promise<T> {
  let response: Response;
  const headers = new Headers(options?.headers);
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
  try {
    response = await fetch('/api' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers,
      signal: options?.signal,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(503, '无法连接服务，请检查服务是否启动后重试。');
  }
  const data = await response.json().catch(() => ({ message: '服务响应异常，请稍后重试。' }));
  if (!response.ok) {
    if (response.status === 401) identity.value = null;
    throw new ApiError(response.status, data.message, data.code, data.details);
  }
  return data;
}
export async function restoreSession() {
  try {
    const session = await api<(Identity & { authenticated?: true }) | { authenticated: false }>(
      '/session',
    );
    identity.value = session.authenticated === false ? null : session;
  } catch (error) {
    identity.value = null;
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
}
