import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { fixture } from '../../../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../../../scripts/testing/run-tests.mjs';
import { connectDatabase } from '../../../../../apps/api/src/platform/database.mjs';
import { createApp } from '../../../../../apps/api/src/app.mjs';
import { digest } from '../../../../../apps/api/src/platform/auth.mjs';

test('workspace API uses real session scope, idempotency and archived-project gates', async () => {
  assertIsolatedDatabase(process.env);
  const db = await connectDatabase();
  let app;
  try {
    const scope = await fixture(db),
      token = randomBytes(32).toString('hex');
    await db.query(
      "INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,'unused',false)",
      [scope.actorId],
    );
    await db.query(
      "INSERT INTO app.auth_session(organization_id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours')",
      [scope.organizationId, scope.actorId, digest(token)],
    );
    app = await createApp({ organizationId: scope.organizationId });
    const base = `/api/projects/${scope.projectId}/development-items/${scope.itemId}/fs-workspace`;
    const headers = {
      origin: 'http://127.0.0.1:5173',
      cookie: 'sapwb_local_session=' + token,
      'idempotency-key': randomUUID(),
    };
    const payload = {
      template_id: 'traditional-abap-five',
      template_version: '1.0.0',
      profile: 'report',
      legacy_source_id: null,
    };
    assert.equal((await app.inject({ method: 'GET', url: base })).statusCode, 401);
    const empty = await app.inject({ method: 'GET', url: base, headers });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().data.workspace, null);
    const create = () => app.inject({ method: 'POST', url: base, headers, payload });
    const [first, concurrent] = await Promise.all([create(), create()]);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(concurrent.statusCode, 201, concurrent.body);
    assert.equal(concurrent.json().data.id, first.json().data.id);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM app.fs_workspace WHERE item_id=$1', [
          scope.itemId,
        ])
      ).rows[0].n,
      1,
    );
    assert.equal((await create()).json().data.id, first.json().data.id);
    const different = await app.inject({
      method: 'POST',
      url: base,
      headers,
      payload: { ...payload, profile: 'interface' },
    });
    assert.equal(different.statusCode, 409, different.body);
    assert.equal(different.json().code, 'IDEMPOTENCY_CONFLICT');
    const rolesUrl = `/api/projects/${scope.projectId}/fs-roles`;
    assert.equal((await app.inject({ method: 'GET', url: rolesUrl, headers })).statusCode, 403);
    await db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [scope.organizationId, scope.actorId],
    );
    const roleHeaders = { ...headers, 'idempotency-key': randomUUID() };
    const rolePayload = {
      user_id: scope.actorId,
      roles: ['business_approver', 'technical_reviewer', 'publisher'],
      expected_revision: '0',
    };
    const grant = () =>
      app.inject({ method: 'POST', url: rolesUrl, headers: roleHeaders, payload: rolePayload });
    const assigned = await grant();
    assert.equal(assigned.statusCode, 200, assigned.body);
    assert.equal((await grant()).json().data.revision, '1');
    const listed = await app.inject({ method: 'GET', url: rolesUrl, headers });
    assert.equal(listed.json().data[0].revision, '1');
    const snapshot = (await app.inject({ method: 'GET', url: base, headers })).json();
    assert.equal(
      snapshot.data.capabilities.can_approve_business,
      false,
      'author cannot self-approve',
    );
    assert.equal(snapshot.data.capabilities.can_review_technical, false);
    assert.equal(snapshot.data.capabilities.can_publish, true);
    const revoke = await app.inject({
      method: 'POST',
      url: rolesUrl,
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: { ...rolePayload, roles: [], expected_revision: '1' },
    });
    assert.equal(revoke.statusCode, 200, revoke.body);
    assert.equal(
      (await app.inject({ method: 'GET', url: base, headers })).json().data.capabilities
        .can_publish,
      false,
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: base.replace(scope.projectId, randomUUID()),
          headers,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: base,
          headers: { ...headers, origin: 'https://evil.example' },
          payload,
        })
      ).statusCode,
      403,
    );
    await db.query("UPDATE app.project SET status='archived',archived_at=now() WHERE id=$1", [
      scope.projectId,
    ]);
    assert.equal((await create()).statusCode, 409);
    await db.query(
      "UPDATE app.project_member SET status='removed' WHERE project_id=$1 AND user_id=$2",
      [scope.projectId, scope.actorId],
    );
    assert.equal((await app.inject({ method: 'GET', url: base, headers })).statusCode, 404);
  } finally {
    if (app) await app.close();
    await db.end();
  }
});
