import { ref } from 'vue';
export interface Identity {
  user: { id: string; loginName: string; displayName: string };
  organization: { id: string; name: string };
  mustChangePassword: boolean;
  canManageOrganization: boolean;
}
export interface Project {
  id: string;
  code: string;
  name: string;
  customerName: string;
  status: string;
  isPaused: boolean;
  description: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}
export const identity = ref<Identity | null>(null);
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
  method?: 'POST' | 'PATCH' | 'DELETE',
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
    identity.value = await api<Identity>('/session');
  } catch (error) {
    identity.value = null;
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
}
