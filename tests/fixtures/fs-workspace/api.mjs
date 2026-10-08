import { randomUUID, randomBytes } from 'node:crypto';
import { fixture } from './database.mjs';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { assertIsolatedDatabase } from '../../../scripts/testing/run-tests.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';

export async function apiFixture({
  origin = 'http://127.0.0.1:5173',
  agentStream,
  agentConnect,
} = {}) {
  assertIsolatedDatabase(process.env);
  const db = await connectDatabase();
  const scope = await fixture(db),
    token = randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,'unused',false)",
    [scope.actorId],
  );
  await db.query('UPDATE app.auth_session SET token_hash=$2 WHERE id=$1', [
    scope.sessionId,
    digest(token),
  ]);
  const app = await createApp({
    organizationId: scope.organizationId,
    origin,
    agentStream,
    agentConnect,
  });
  const base = `/api/projects/${scope.projectId}/development-items/${scope.itemId}/fs-workspace`;
  const headers = { origin, cookie: 'sapwb_local_session=' + token };
  const request = (method, path = '', payload, extra = {}) =>
    app.inject({ method, url: base + path, payload, headers: { ...headers, ...extra } });
  const result = await request(
    'POST',
    '',
    {
      template_id: 'traditional-abap-five',
      template_version: '1.0.0',
      profile: 'report',
      legacy_source_id: null,
    },
    { 'idempotency-key': randomUUID() },
  );
  if (result.statusCode !== 201) throw new Error(result.body);
  return {
    db,
    scope,
    app,
    headers,
    base,
    request,
    workspace: result.json().data,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}
export const etag = (w) => `"ws:${w.id}:${w.revision}"`;
