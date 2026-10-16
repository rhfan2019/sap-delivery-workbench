import { failure } from '../../platform/auth.mjs';
import { binding } from './resolve.mjs';

// Contract 3.4: the user's own test system (QAS) user and password, entered once per login.
// Held only in this process's memory, keyed by login session and project; never stored,
// logged or returned. Gone after logout, expiry or an API restart.
export const TEST_ENVIRONMENT = 'QAS';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const store = new Map();
const key = (sessionId, projectId) => `${sessionId}:${projectId}`;

export function rememberCredentials(sessionId, projectId, effective, password, now = Date.now()) {
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
  store.set(key(sessionId, projectId), {
    username: effective.username,
    password,
    binding: binding(effective),
    expiresAt: now + MAX_AGE_MS,
  });
}

// Callers compare `binding` with the current configuration: a changed system, URL or
// client requires entering the credentials again.
export function recalledCredentials(sessionId, projectId, now = Date.now()) {
  const entry = store.get(key(sessionId, projectId));
  if (!entry || entry.expiresAt <= now) return null;
  return entry;
}

export function forgetCredentials(sessionId, projectId) {
  store.delete(key(sessionId, projectId));
}

export const loginRequired = (message = '请先输入您本人的 QAS 用户和密码。') =>
  Object.assign(failure(409, message), { code: 'TEST_SYSTEM_LOGIN_REQUIRED' });
