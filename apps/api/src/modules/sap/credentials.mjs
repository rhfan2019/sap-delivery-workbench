import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { seal, open } from './crypto.mjs';

// Contract 3.4 / docs/specs/project-access-admin.md 3.3–3.4: a person's own SAP user for one
// project system. "This login only" lives in this process (by login session and system);
// "saved" is AES-256-GCM in app.sap_user_credential, bound to the user, system, address,
// client and SAP user. Passwords never leave this module except into the MCP environment.

const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const memory = new Map();
const memoryKey = (sessionId, systemId) => `${sessionId}:${systemId}`;
// What a credential was entered for; a change of address, client or user invalidates it.
export const binding = (system, username) =>
  createHash('sha256')
    .update(JSON.stringify([system.id, system.sapUrl, system.client, username]))
    .digest('hex');
const aad = (userId, system, username) =>
  JSON.stringify(['sap-credential', userId, system.id, system.sapUrl, system.client, username]);

export const DEFAULT_POLICY = {
  allowSave: true,
  maxDays: 30,
  idleDays: 14,
  subcontractorSave: false,
};
export async function policyOf(db, org) {
  const { rows } = await db.query(
    `SELECT allow_save AS "allowSave",max_days AS "maxDays",idle_days AS "idleDays",
      subcontractor_save AS "subcontractorSave",row_version AS "rowVersion",updated_at AS "updatedAt"
    FROM app.sap_credential_policy WHERE organization_id=$1`,
    [org],
  );
  return rows[0] ?? { ...DEFAULT_POLICY, rowVersion: '0' };
}
export const maySave = (policy, personType) =>
  policy.allowSave && (personType === 'employee' || policy.subcontractorSave);

const audit = (db, org, userId, action, outcome, system, details = {}) =>
  db.query(
    `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details)
    VALUES($1,$2,$3,$4,'sap_system',$5,$6,$7)`,
    [org, userId, action, outcome, system?.id ?? null, randomUUID(), JSON.stringify(details)],
  );

export function rememberForSession(
  sessionId,
  userId,
  system,
  username,
  password,
  now = Date.now(),
) {
  for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
  memory.set(memoryKey(sessionId, system.id), {
    userId,
    username,
    password,
    binding: binding(system, username),
    expiresAt: now + SESSION_MAX_MS,
  });
}
export const forgetForSession = (sessionId, systemId) =>
  memory.delete(memoryKey(sessionId, systemId));
// Forced removal (security policy): every this-login credential of a person.
export function forgetUser(userId) {
  for (const [k, v] of memory) if (v.userId === userId) memory.delete(k);
}

export async function saveCredential(db, org, userId, system, { username, password }, policy) {
  const expires = new Date(Date.now() + policy.maxDays * 86400000);
  await db.query(
    `INSERT INTO app.sap_user_credential(organization_id,project_id,system_id,user_id,sap_username,password_cipher,expires_at,last_used_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now())
    ON CONFLICT(system_id,user_id) DO UPDATE SET sap_username=EXCLUDED.sap_username,password_cipher=EXCLUDED.password_cipher,
      key_version=1,saved_at=now(),expires_at=EXCLUDED.expires_at,last_used_at=now()`,
    [
      org,
      system.projectId,
      system.id,
      userId,
      username,
      seal(password, aad(userId, system, username)),
      expires,
    ],
  );
  await audit(db, org, userId, 'sap.credential.save', 'success', system, {
    username,
    mode: 'saved',
  });
}
export async function deleteCredential(db, org, userId, system, reason = 'sap.credential.delete') {
  const { rowCount } = await db.query(
    'DELETE FROM app.sap_user_credential WHERE organization_id=$1 AND system_id=$2 AND user_id=$3',
    [org, system.id, userId],
  );
  if (rowCount) await audit(db, org, userId, reason, 'success', system);
  return rowCount > 0;
}

// Local development only (contract 3.4): the credentials file the MCP runtime can also use,
// accepted when it points at the same address and client as the system.
export async function profileCredentials(system, env = process.env) {
  if (env.NODE_ENV === 'production' || !env.SAP_MCP_PROFILE_FILE || !system?.sapUrl) return null;
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
    origin(profile.SAP_URL) !== origin(system.sapUrl) ||
    String(profile.SAP_CLIENT ?? '') !== String(system.client)
  )
    return null;
  return { username: String(profile.SAP_USER), password: String(profile.SAP_PASSWORD) };
}

async function savedRow(db, org, userId, system, policy) {
  const { rows } = await db.query(
    `SELECT sap_username AS username,password_cipher AS cipher,saved_at AS "savedAt",expires_at AS "expiresAt",
      last_used_at AS "lastUsedAt" FROM app.sap_user_credential WHERE organization_id=$1 AND system_id=$2 AND user_id=$3`,
    [org, system.id, userId],
  );
  const row = rows[0];
  if (!row) return null;
  const idleSince = Date.parse(row.lastUsedAt ?? row.savedAt);
  const expired =
    Date.parse(row.expiresAt) <= Date.now() || Date.now() - idleSince > policy.idleDays * 86400000;
  if (expired) {
    await deleteCredential(db, org, userId, system, 'sap.credential.expire');
    return null;
  }
  return row;
}

// The credential state shown to the person (never the password).
export async function credentialStatus(db, org, current, system, policy) {
  const entry = memory.get(memoryKey(current.sessionId, system.id));
  if (entry && entry.userId === current.user.id && entry.expiresAt > Date.now()) {
    if (entry.binding === binding(system, entry.username))
      return { state: 'session', username: entry.username, expiresAt: new Date(entry.expiresAt) };
    forgetForSession(current.sessionId, system.id);
  }
  const saved = await savedRow(db, org, current.user.id, system, policy);
  if (saved)
    return {
      state: 'saved',
      username: saved.username,
      savedAt: saved.savedAt,
      expiresAt: saved.expiresAt,
      lastUsedAt: saved.lastUsedAt,
    };
  if (await profileCredentials(system)) return { state: 'profile', username: '' };
  return { state: 'none', username: '' };
}

// The person's credential for a request, or null. `rejected()` discards a credential SAP
// refused, so a wrong password is never tried again (SAP locks users after a few failures).
export async function credentialFor(db, org, actor, system, policy) {
  const entry = memory.get(memoryKey(actor.sessionId, system.id));
  if (entry && entry.userId === actor.userId && entry.expiresAt > Date.now()) {
    if (entry.binding === binding(system, entry.username))
      return {
        username: entry.username,
        password: entry.password,
        source: 'session',
        rejected: async () => forgetForSession(actor.sessionId, system.id),
      };
    forgetForSession(actor.sessionId, system.id);
  }
  const saved = await savedRow(db, org, actor.userId, system, policy);
  if (saved) {
    let password;
    try {
      password = open(saved.cipher, aad(actor.userId, system, saved.username));
    } catch {
      await deleteCredential(db, org, actor.userId, system, 'sap.credential.unreadable');
      return null;
    }
    await db.query(
      'UPDATE app.sap_user_credential SET last_used_at=now() WHERE organization_id=$1 AND system_id=$2 AND user_id=$3',
      [org, system.id, actor.userId],
    );
    return {
      username: saved.username,
      password,
      source: 'saved',
      rejected: async () =>
        deleteCredential(db, org, actor.userId, system, 'sap.credential.reject'),
    };
  }
  const profile = await profileCredentials(system);
  if (profile) return { ...profile, source: 'profile', rejected: async () => {} };
  return null;
}
