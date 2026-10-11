import { randomBytes } from 'node:crypto';
import { fixture } from './database.mjs';
import { connectDatabase } from '../../apps/api/src/platform/database.mjs';
import { assertIsolatedDatabase } from '../../scripts/testing/run-tests.mjs';
import { createApp } from '../../apps/api/src/app.mjs';
import { digest } from '../../apps/api/src/platform/auth.mjs';

// Real app on the isolated test database with one signed-in project member.
export async function apiFixture({ origin = 'http://127.0.0.1:5173' } = {}) {
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
  const app = await createApp({ organizationId: scope.organizationId, origin });
  const headers = { origin, cookie: 'sapwb_local_session=' + token };
  return {
    db,
    scope,
    app,
    headers,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}
