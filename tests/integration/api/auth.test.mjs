import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { grantRole, dropOrganizations } from '../../fixtures/access.mjs';

test('real HTTP authentication, forced password change, session revocation and project isolation', async () => {
  const { createApp } = await import('../../../apps/api/src/app.mjs');
  const { hashPassword } = await import('../../../apps/api/src/platform/password.mjs');
  const db = await connectDatabase();
  const id = randomUUID();
  const other = randomUUID();
  const org = randomUUID();
  const customer = randomUUID();
  const project = randomUUID();
  const hidden = randomUUID();
  const login = 'test-' + id;
  const testIp = 'test-' + randomUUID();
  const original = 'Test original passphrase!';
  const next = 'Test replacement passphrase!';
  let app;
  try {
    await db.query('INSERT INTO app.organization(id,code,name) VALUES($1,$2,$3)', [
      org,
      'T' + org.replaceAll('-', '').slice(0, 25).toUpperCase(),
      '认证测试组织',
    ]);
    await db.query(
      'INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3),($4,$5,$6)',
      [id, login, '测试用户', other, 'test-' + other, '其他用户'],
    );
    await db.query('INSERT INTO app.user_password(user_id,password_hash) VALUES($1,$2)', [
      id,
      await hashPassword(original),
    ]);
    await db.query(
      'INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2),($1,$3)',
      [org, id, other],
    );
    await db.query(
      "INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$2,'TEST','测试客户')",
      [customer, org],
    );
    await db.query(
      "INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$3,$4,'VISIBLE','可见项目'),($2,$3,$4,'HIDDEN','不可见项目')",
      [project, hidden, org, customer],
    );
    // Contract 3.5: a member sees a project through a project role.
    await grantRole(db, org, id, 'C_OBSERVER', { projectId: project });
    app = await createApp({ organizationId: org });
    const request = (method, url, payload, cookie, origin = 'http://127.0.0.1:5173') =>
      app.inject({
        method,
        url,
        payload,
        remoteAddress: testIp,
        headers: { origin, ...(cookie ? { cookie } : {}) },
      });
    const signIn = (password = original) =>
      request('POST', '/api/login', { loginName: '  ' + login.toUpperCase() + '  ', password });
    assert.equal((await request('GET', '/api/projects')).statusCode, 401);
    assert.equal(
      (
        await request(
          'POST',
          '/api/login',
          { loginName: login, password: original },
          null,
          'https://evil.example',
        )
      ).statusCode,
      403,
    );
    assert.equal((await signIn('wrong password')).statusCode, 401);
    let response = await signIn();
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().mustChangePassword, true);
    const cookie = response.headers['set-cookie'].split(';')[0];
    assert.match(response.headers['set-cookie'], /HttpOnly/);
    // Contract 1.17: the theme preference API is gone with the theme switcher.
    assert.equal((await request('GET', '/api/preferences', null, cookie)).statusCode, 404);
    assert.equal((await request('GET', '/api/projects', undefined, cookie)).statusCode, 403);
    assert.equal(
      (
        await request(
          'POST',
          '/api/password',
          { currentPassword: original, newPassword: next },
          cookie,
        )
      ).statusCode,
      200,
    );
    assert.equal((await request('GET', '/api/session', undefined, cookie)).statusCode, 401);
    assert.equal((await signIn()).statusCode, 401);
    response = await signIn(next);
    const current = response.headers['set-cookie'].split(';')[0];
    assert.equal(response.json().mustChangePassword, false);
    assert.equal(
      (await request('GET', '/api/session', undefined, current)).json().user.displayName,
      '测试用户',
    );
    // npm stop / npm start: sessions live in the database, so a new API process keeps them.
    await app.close();
    app = await createApp({ organizationId: org });
    assert.equal((await request('GET', '/api/session', undefined, current)).statusCode, 200);
    assert.deepEqual(
      (await request('GET', '/api/projects', undefined, current)).json().map((p) => p.id),
      [project],
    );
    assert.equal(
      (await request('GET', '/api/projects/' + hidden, undefined, current)).statusCode,
      404,
    );
    assert.equal(
      (await request('GET', '/api/projects/' + project, undefined, current)).statusCode,
      200,
    );
    await db.query("UPDATE app.project_member SET status='removed' WHERE user_id=$1", [id]);
    assert.deepEqual((await request('GET', '/api/projects', undefined, current)).json(), []);
    await request('POST', '/api/logout', {}, current);
    assert.equal((await request('GET', '/api/session', undefined, current)).statusCode, 401);
    response = await signIn(next);
    const expired = response.headers['set-cookie'].split(';')[0];
    await db.query(
      "UPDATE app.auth_session SET issued_at=now()-interval '2 hours',last_seen_at=now()-interval '1 hour',idle_expires_at=now()-interval '30 minutes' WHERE user_id=$1",
      [id],
    );
    assert.equal((await request('GET', '/api/session', undefined, expired)).statusCode, 401);
    response = await signIn(next);
    const disabled = response.headers['set-cookie'].split(';')[0];
    await db.query("UPDATE app.organization_member SET status='disabled' WHERE user_id=$1", [id]);
    assert.equal((await request('GET', '/api/session', undefined, disabled)).statusCode, 401);
    assert.equal((await signIn(next)).statusCode, 401);
    const burst = await Promise.all(Array.from({ length: 6 }, () => signIn('wrong password')));
    assert.ok(burst.some((r) => r.statusCode === 429));
  } finally {
    await app?.close();
    for (const key of [testIp, login, 'password:' + id])
      await db.query('DELETE FROM app.login_throttle WHERE key_hash=$1', [
        createHash('sha256').update(key).digest(),
      ]);
    await db.query('DELETE FROM app.audit_event WHERE organization_id=$1 OR actor_user_id=$2', [
      org,
      id,
    ]);
    await dropOrganizations(db, [org], [id, other]);
    await db.end();
  }
});
