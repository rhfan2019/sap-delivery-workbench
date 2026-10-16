import { readFile } from 'node:fs/promises';
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

// Local development only (contract 3.4): the credentials file the MCP runtime can also use,
// accepted when it points at the same SAP origin and client as the project's QAS.
export async function profileCredentials(effective, env = process.env) {
  if (env.NODE_ENV === 'production' || !env.SAP_MCP_PROFILE_FILE || !effective?.sapUrl) return null;
  let profile;
  try {
    profile = JSON.parse(await readFile(env.SAP_MCP_PROFILE_FILE, 'utf8'));
  } catch {
    return null;
  }
  const origin = (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };
  if (
    !profile?.SAP_USER ||
    !profile.SAP_PASSWORD ||
    origin(profile.SAP_URL) !== origin(effective.sapUrl) ||
    String(profile.SAP_CLIENT ?? '') !== String(effective.client ?? '')
  )
    return null;
  return { username: String(profile.SAP_USER), password: String(profile.SAP_PASSWORD) };
}
