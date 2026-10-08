import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { hashPassword } from '../../../apps/api/src/platform/password.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';

test('organization administration respects scope, versions, account and membership boundaries', async (t) => {
  const db = await connectDatabase();
  const org = randomUUID(),
    otherOrg = randomUUID(),
    admin = randomUUID(),
    member = randomUUID();
  const suffix = org.slice(0, 8);
  const password = 'Admin test passphrase!';
  const testIp = 'admin-test-' + org;
  const createdUsers = [admin, member];
  const logins = ['adm-' + suffix, 'mem-' + suffix];
  let app;
  try {
    await db.query(
      "INSERT INTO app.organization(id,code,name) VALUES($1,$2,'Test'),($3,$4,'Other')",
      [org, 'T' + suffix.toUpperCase(), otherOrg, 'O' + suffix.toUpperCase()],
    );
    const hash = await hashPassword(password);
    for (const [i, id] of createdUsers.entries()) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        logins[i],
        i ? 'Member' : 'Admin',
      ]);
      await db.query(
        'INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,$2,false)',
        [id, hash],
      );
      await db.query(
        'INSERT INTO app.organization_member(organization_id,user_id,access_level) VALUES($1,$2,$3)',
        [org, id, i ? 'member' : 'admin'],
      );
    }
    app = await createApp({ organizationId: org });
    const req = (method, url, body, cookie) =>
      app.inject({
        method,
        url,
        payload: body,
        remoteAddress: testIp,
        headers: { origin: 'http://127.0.0.1:5173', ...(cookie ? { cookie } : {}) },
      });
    const login = async (name) => {
      const r = await req('POST', '/api/login', { loginName: name, password });
      assert.equal(r.statusCode, 200);
      return r.headers['set-cookie'].split(';')[0];
    };
    const a = await login(logins[0]),
      m = await login(logins[1]);
    await t.test(
      'technical verification enforces session, administrator and input boundaries',
      async () => {
        const url = '/api/admin/technical-verification/table';
        assert.equal((await req('POST', url, { tableName: 'T000' })).statusCode, 401);
        assert.equal((await req('POST', url, { tableName: 'T000' }, m)).statusCode, 403);
        const invalid = await req('POST', url, { tableName: "T000' OR 1=1" }, a);
        assert.equal(invalid.statusCode, 400);
        assert.equal(invalid.json().code, 'INVALID_TABLE');
      },
    );
    await t.test('ordinary users cannot read or mutate admin data', async () => {
      assert.equal((await req('GET', '/api/admin/organization', undefined, m)).statusCode, 403);
      assert.equal(
        (
          await req(
            'POST',
            '/api/admin/customers',
            { name: 'No', code: 'NO', customerKind: 'external' },
            m,
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (await req('GET', '/api/session', undefined, a)).json().canManageOrganization,
        true,
      );
    });
    let customer, project;
    await t.test('customer create, duplicate and stale updates', async () => {
      let r = await req(
        'POST',
        '/api/admin/customers',
        { name: 'Customer', code: 'CUST', customerKind: 'external', description: '' },
        a,
      );
      assert.equal(r.statusCode, 201);
      customer = r.json();
      assert.equal(
        (
          await req(
            'POST',
            '/api/admin/customers',
            { name: 'Duplicate', code: 'CUST', customerKind: 'external' },
            a,
          )
        ).statusCode,
        409,
      );
      r = await req(
        'PATCH',
        '/api/admin/customers/' + customer.id,
        { ...customer, name: 'Updated' },
        a,
      );
      assert.equal(r.statusCode, 200);
      assert.equal(
        (
          await req(
            'PATCH',
            '/api/admin/customers/' + customer.id,
            { ...customer, name: 'Stale' },
            a,
          )
        ).statusCode,
        409,
      );
      customer = r.json();
      assert.equal(
        (await req('PATCH', '/api/admin/customers/' + randomUUID(), { ...customer }, a)).statusCode,
        404,
      );
      assert.equal(
        (
          await req(
            'POST',
            '/api/admin/customers',
            { name: 'bad', code: 'bad space', customerKind: 'external' },
            a,
          )
        ).statusCode,
        400,
      );
    });
    await t.test('project creation and scope', async () => {
      const foreign = (
        await db.query(
          "INSERT INTO app.customer(organization_id,code,name) VALUES($1,'FOREIGN','Foreign') RETURNING id",
          [otherOrg],
        )
      ).rows[0];
      assert.equal(
        (
          await req(
            'POST',
            '/api/admin/projects',
            { customerId: foreign.id, code: 'P', name: 'Project', projectType: 'implementation' },
            a,
          )
        ).statusCode,
        404,
      );
      const r = await req(
        'POST',
        '/api/admin/projects',
        {
          customerId: customer.id,
          code: 'P',
          name: 'Project',
          projectType: 'implementation',
          plannedStartDate: '2026-10-01',
          plannedEndDate: '2026-12-31',
        },
        a,
      );
      assert.equal(r.statusCode, 201);
      project = r.json();
      assert.equal(
        (
          await req(
            'POST',
            '/api/admin/projects',
            {
              customerId: customer.id,
              code: 'BAD',
              name: 'Project',
              plannedStartDate: '2026-12-31',
              plannedEndDate: '2026-01-01',
            },
            a,
          )
        ).statusCode,
        400,
      );
    });
    await t.test('project member assignment/revocation changes real access', async () => {
      assert.equal(
        (await req('POST', `/api/admin/projects/${project.id}/members`, { userId: member }, a))
          .statusCode,
        200,
      );
      assert.equal((await req('GET', '/api/projects', undefined, m)).json().length, 1);
      const rows = (
        await req('GET', `/api/admin/projects/${project.id}/members`, undefined, a)
      ).json();
      assert.equal(
        (
          await req(
            'DELETE',
            `/api/admin/projects/${project.id}/members/${member}`,
            { rowVersion: rows[0].rowVersion },
            a,
          )
        ).statusCode,
        200,
      );
      assert.equal((await req('GET', '/api/projects', undefined, m)).json().length, 0);
      assert.equal(
        (
          await req(
            'POST',
            `/api/admin/projects/${project.id}/members`,
            { userId: randomUUID() },
            a,
          )
        ).statusCode,
        404,
      );
    });
    await t.test('self protection and member disabling invalidates sessions', async () => {
      const users = (await req('GET', '/api/admin/users', undefined, a)).json();
      const self = users.find((u) => u.id === admin),
        target = users.find((u) => u.id === member);
      assert.equal(
        (
          await req(
            'PATCH',
            `/api/admin/users/${admin}`,
            { displayName: 'Admin', email: '', status: 'disabled', rowVersion: self.rowVersion },
            a,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await req(
            'PATCH',
            `/api/admin/members/${admin}`,
            { status: 'active', accessLevel: 'member', rowVersion: self.memberVersion },
            a,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await req(
            'PATCH',
            `/api/admin/members/${member}`,
            { status: 'disabled', accessLevel: 'member', rowVersion: target.memberVersion },
            a,
          )
        ).statusCode,
        200,
      );
      assert.equal((await req('GET', '/api/session', undefined, m)).statusCode, 401);
    });
    await t.test('new user has one-time password, forced change and can be reset', async () => {
      const name = 'new-' + suffix;
      logins.push(name);
      const r = await req(
        'POST',
        '/api/admin/users',
        { loginName: name, displayName: 'New user', email: '' },
        a,
      );
      assert.equal(r.statusCode, 201);
      createdUsers.push(r.json().user.id);
      assert.ok(r.json().temporaryPassword.length >= 12);
      const signed = await req('POST', '/api/login', {
        loginName: name,
        password: r.json().temporaryPassword,
      });
      assert.equal(signed.statusCode, 200);
      assert.equal(signed.json().mustChangePassword, true);
      const cookie = signed.headers['set-cookie'].split(';')[0];
      assert.equal((await req('GET', '/api/admin/users', undefined, cookie)).statusCode, 403);
      const reset = await req(
        'POST',
        `/api/admin/users/${r.json().user.id}/reset-password`,
        { rowVersion: r.json().user.rowVersion },
        a,
      );
      assert.equal(reset.statusCode, 200);
      assert.equal((await req('GET', '/api/session', undefined, cookie)).statusCode, 401);
      assert.equal(
        (await req('GET', '/api/admin/users', undefined, a)).body.includes('password_hash'),
        false,
      );
    });
    await t.test('archived projects reject edits and membership additions', async () => {
      const r = await req(
        'PATCH',
        '/api/admin/projects/' + project.id,
        { ...project, status: 'archived' },
        a,
      );
      assert.equal(r.statusCode, 200);
      assert.equal(
        (await req('POST', `/api/admin/projects/${project.id}/members`, { userId: admin }, a))
          .statusCode,
        409,
      );
      assert.equal(
        (
          await req(
            'PATCH',
            '/api/admin/projects/' + project.id,
            { ...r.json(), name: 'Changed' },
            a,
          )
        ).statusCode,
        409,
      );
    });
    assert.ok(
      (
        await db.query(
          "SELECT count(*) FROM app.audit_event WHERE organization_id=$1 AND action LIKE 'admin.%'",
          [org],
        )
      ).rows[0].count > 0,
    );
  } finally {
    await app?.close();
    await db.query('DELETE FROM app.auth_session WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.project_member WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.project WHERE organization_id=ANY($1::uuid[])', [
      [org, otherOrg],
    ]);
    await db.query('DELETE FROM app.customer WHERE organization_id=ANY($1::uuid[])', [
      [org, otherOrg],
    ]);
    await db.query('DELETE FROM app.organization_member WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.user_password WHERE user_id=ANY($1::uuid[])', [createdUsers]);
    await db.query('DELETE FROM app.app_user WHERE id=ANY($1::uuid[])', [createdUsers]);
    await db.query('DELETE FROM app.audit_event WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.organization WHERE id=ANY($1::uuid[])', [[org, otherOrg]]);
    for (const key of [testIp, ...logins])
      await db.query('DELETE FROM app.login_throttle WHERE key_hash=$1', [digest(key)]);
    await db.end();
  }
});
