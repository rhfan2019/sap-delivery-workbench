import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { hashPassword } from '../../../apps/api/src/platform/password.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';

test('SAP configuration HTTP and database boundaries', async (t) => {
  const db = await connectDatabase(),
    org = randomUUID(),
    other = randomUUID(),
    admin = randomUUID(),
    member = randomUUID(),
    outsider = randomUUID(),
    customer = randomUUID(),
    borrower = randomUUID(),
    project = randomUUID();
  const suffix = org.slice(0, 8),
    password = 'SAP test login passphrase!',
    secret = 'Private SAP password ' + suffix;
  const originalKey = process.env.SAP_CREDENTIAL_KEY;
  process.env.SAP_CREDENTIAL_KEY = 'c'.repeat(64);
  let app;
  try {
    await db.query(
      "INSERT INTO app.organization(id,code,name) VALUES($1,$2,'SAP Test'),($3,$4,'Other')",
      [org, 'S' + suffix.toUpperCase(), other, 'O' + suffix.toUpperCase()],
    );
    const hash = await hashPassword(password);
    for (const [index, user] of [admin, member, outsider].entries()) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        user,
        'sap' + index + '-' + suffix,
        'SAP Test',
      ]);
      await db.query(
        'INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,$2,false)',
        [user, hash],
      );
      await db.query(
        'INSERT INTO app.organization_member(organization_id,user_id,access_level) VALUES($1,$2,$3)',
        [org, user, index === 0 ? 'admin' : 'member'],
      );
    }
    await db.query(
      "INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$2,'OWNER','Owner'),($3,$2,'BORROW','Borrower')",
      [customer, org, borrower],
    );
    await db.query(
      "INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$2,$3,'TEST','SAP Project')",
      [project, org, borrower],
    );
    await db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3),($1,$2,$4)',
      [org, project, admin, member],
    );
    app = await createApp({ organizationId: org });
    const req = (method, url, body, cookie) =>
      app.inject({
        method,
        url,
        payload: body,
        remoteAddress: 'sap-test-' + suffix,
        headers: { origin: 'http://127.0.0.1:5173', ...(cookie ? { cookie } : {}) },
      });
    const cookies = [];
    for (let i = 0; i < 3; i++) {
      const login = await req('POST', '/api/login', {
        loginName: 'sap' + i + '-' + suffix,
        password,
      });
      assert.equal(login.statusCode, 200);
      cookies.push(login.headers['set-cookie'].split(';')[0]);
    }
    const [a, m, o] = cookies;
    const adminUrl = '/api/admin/projects/' + project + '/sap',
      personalUrl = '/api/projects/' + project + '/sap';
    let system,
      grantRevision = '1',
      defaults,
      personal;
    await t.test('only admin creates systems; URL rejects credentials and ADT paths', async () => {
      assert.equal((await req('GET', '/api/admin/sap-systems', undefined, m)).statusCode, 403);
      for (const sapUrl of ['https://user:secret@host.invalid', 'https://host.invalid/sap/bc/adt'])
        assert.equal(
          (await req('POST', '/api/admin/sap-systems', { code: 'S', name: 'System', sapUrl }, a))
            .statusCode,
          400,
        );
      const r = await req(
        'POST',
        '/api/admin/sap-systems',
        { code: 'S', name: 'Owner SAP', sapUrl: 'https://sap.invalid', ownerCustomerId: customer },
        a,
      );
      assert.equal(r.statusCode, 200, r.body);
      system = r.json();
      assert.equal((await req('GET', personalUrl, undefined, o)).statusCode, 404);
    });
    await t.test(
      'MCP connection tests persist versions and failures, enforce scope and never return passwords',
      async () => {
        const originalEntry = process.env.SAP_MCP_ENTRY;
        process.env.SAP_MCP_ENTRY = new URL(
          '../../fixtures/sap-probe-server.mjs',
          import.meta.url,
        ).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
        try {
          const url = '/api/admin/sap-systems/' + system.id + '/test';
          const body = () => ({
            rowVersion: system.rowVersion,
            client: '100',
            username: 'ok',
            password: secret,
          });
          assert.equal((await req('POST', url, body(), m)).statusCode, 403);
          assert.equal((await req('POST', url, { ...body(), client: '1' }, a)).statusCode, 400);
          assert.equal(
            (await req('POST', '/api/admin/sap-systems/' + randomUUID() + '/test', body(), a))
              .statusCode,
            404,
          );
          for (const [username, status] of [
            ['ok', 'passed'],
            ['bad-auth', 'failed'],
            ['bad-network', 'failed'],
          ]) {
            const response = await req('POST', url, { ...body(), username }, a);
            assert.equal(response.statusCode, 200, response.body);
            const result = response.json();
            assert.equal(result.status, status);
            assert.ok(!response.body.includes(secret));
            system = result.system;
            assert.match(system.backendVersion, /SAP_BASIS 758/);
            const saved = (await req('GET', '/api/admin/sap-systems', undefined, a))
              .json()
              .find((s) => s.id === system.id);
            assert.equal(saved.testStatus, status);
            assert.equal(saved.backendVersion, system.backendVersion);
          }
          assert.equal((await req('POST', url, { ...body(), rowVersion: '1' }, a)).statusCode, 409);
        } finally {
          if (originalEntry === undefined) delete process.env.SAP_MCP_ENTRY;
          else process.env.SAP_MCP_ENTRY = originalEntry;
        }
      },
    );
    await t.test(
      'customer borrowing must be granted; cross-organization FK rejects corruption',
      async () => {
        defaults = (await req('GET', adminUrl, undefined, a)).json();
        assert.equal(defaults.systems.length, 0);
        const body = { rows: defaults.rows.map((r) => ({ ...r, systemId: system.id })) };
        assert.equal((await req('POST', adminUrl, body, a)).statusCode, 403);
        await assert.rejects(
          db.query(
            "INSERT INTO app.project_sap_config(organization_id,project_id,environment,system_id) VALUES($1,$2,'DEV',$3)",
            [other, project, system.id],
          ),
          { code: '23503' },
        );
        const r = await req(
          'POST',
          '/api/admin/sap-systems/' + system.id + '/grants',
          {
            customerId: borrower,
            expiresAt: '2099-01-01T00:00:00Z',
            active: true,
            rowVersion: '0',
          },
          a,
        );
        assert.equal(r.statusCode, 200, r.body);
      },
    );
    await t.test(
      'three defaults save atomically, encrypted and never echoed; stale version rejects',
      async () => {
        defaults = (await req('GET', adminUrl, undefined, a)).json();
        const rows = defaults.rows.map((r) => ({
          ...r,
          systemId: system.id,
          client: '000',
          username: 'DEVUSER',
          passwordAction: 'replace',
          password: secret,
        }));
        const saved = await req('POST', adminUrl, { rows }, a);
        assert.equal(saved.statusCode, 200, saved.body);
        assert.ok(!saved.body.includes(secret));
        defaults = saved.json();
        assert.equal(defaults.effective[0].credentialReady, true);
        assert.equal((await req('POST', adminUrl, { rows }, a)).statusCode, 409);
        const raw = (
          await db.query('SELECT password_cipher FROM app.project_sap_config WHERE project_id=$1', [
            project,
          ])
        ).rows;
        assert.equal(raw.length, 3);
        assert.ok(
          raw.every(
            (r) => r.password_cipher.startsWith('v1.') && !r.password_cipher.includes(secret),
          ),
        );
        const bad = defaults.rows.map((r) => ({
          ...r,
          language: r.environment === 'PRD' ? 'INVALID' : 'ZH',
        }));
        assert.equal((await req('POST', adminUrl, { rows: bad }, a)).statusCode, 400);
        assert.equal(
          (await req('GET', adminUrl, undefined, a)).json().rows[0].rowVersion,
          defaults.rows[0].rowVersion,
        );
      },
    );
    await t.test(
      'own parameters inherit and username changes invalidate default password',
      async () => {
        personal = (await req('GET', personalUrl, undefined, m)).json();
        assert.equal(personal.effective[0].credentialReady, true);
        const rows = personal.rows.map((r) => ({
          ...r,
          username: r.environment === 'DEV' ? 'PERSONAL' : null,
        }));
        const saved = await req('POST', personalUrl, { rows }, m);
        assert.equal(saved.statusCode, 200, saved.body);
        personal = saved.json();
        assert.equal(personal.effective[0].hasPassword, false);
        assert.equal(personal.effective[1].hasPassword, true);
        assert.equal((await req('GET', personalUrl, undefined, a)).json().rows[0].username, null);
        assert.equal((await req('POST', personalUrl, { rows }, m)).statusCode, 409);
      },
    );
    await t.test(
      'temporary password resolves without persistence and rejects arbitrary system',
      async () => {
        const before = (await req('GET', personalUrl, undefined, m)).body;
        const resolved = await req(
          'POST',
          personalUrl + '/resolve',
          {
            environment: 'DEV',
            temporary: { passwordAction: 'replace', password: secret, client: '100' },
          },
          m,
        );
        assert.equal(resolved.statusCode, 200, resolved.body);
        assert.equal(resolved.json().credentialReady, true);
        assert.ok(!resolved.body.includes(secret));
        assert.equal((await req('GET', personalUrl, undefined, m)).body, before);
        assert.equal(
          (
            await req(
              'POST',
              personalUrl + '/resolve',
              { environment: 'DEV', temporary: { systemId: randomUUID() } },
              m,
            )
          ).statusCode,
          403,
        );
      },
    );
    await t.test(
      'no allowlist endpoint remains; QAS login is per login session and memory only',
      async () => {
        // Contract 1.9: test data code may call any BAPI, function module or class.
        const allowUrl = '/api/admin/sap-systems/' + system.id + '/allowlist';
        assert.equal((await req('GET', allowUrl, undefined, a)).statusCode, 404);

        const qasUrl = personalUrl.replace(/\/sap$/, '/sap/test-system');
        const status = (await req('GET', qasUrl, undefined, m)).json();
        assert.deepEqual([status.configured, status.ready, status.client], [true, false, '000']);
        const originalEntry = process.env.SAP_MCP_ENTRY;
        process.env.SAP_MCP_ENTRY = new URL(
          '../../fixtures/sap-probe-server.mjs',
          import.meta.url,
        ).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
        try {
          const refused = await req('POST', qasUrl, { username: 'bad-auth', password: secret }, m);
          assert.equal(refused.statusCode, 400);
          const login = await req('POST', qasUrl, { username: 'ok', password: secret }, m);
          assert.equal(login.statusCode, 200, login.body);
          assert.ok(!login.body.includes(secret));
          assert.deepEqual([login.json().ready, login.json().username], [true, 'ok']);
        } finally {
          if (originalEntry === undefined) delete process.env.SAP_MCP_ENTRY;
          else process.env.SAP_MCP_ENTRY = originalEntry;
        }
        assert.equal((await req('GET', qasUrl, undefined, a)).json().ready, false);
        const stored = await db.query(
          'SELECT count(*)::int AS n FROM app.user_project_sap_config WHERE project_id=$1 AND username=$2',
          [project, 'ok'],
        );
        assert.equal(stored.rows[0].n, 0);
        assert.equal((await req('DELETE', qasUrl, undefined, m)).json().ready, false);
      },
    );
    await t.test('expired grant blocks execution and archived project blocks changes', async () => {
      await db.query(
        "UPDATE app.sap_system_grant SET expires_at=now()-interval '1 second' WHERE organization_id=$1",
        [org],
      );
      assert.equal(
        (await req('POST', personalUrl + '/resolve', { environment: 'QAS' }, m)).statusCode,
        403,
      );
      assert.equal(
        (await req('POST', personalUrl + '/table', { environment: 'QAS', tableName: 'T000' }, m))
          .statusCode,
        403,
      );
      await db.query("UPDATE app.project SET status='archived',archived_at=now() WHERE id=$1", [
        project,
      ]);
      assert.equal((await req('POST', personalUrl, { rows: personal.rows }, m)).statusCode, 409);
      assert.equal((await req('POST', adminUrl, { rows: defaults.rows }, a)).statusCode, 409);
    });
    await t.test(
      'inactive customers still allow system shutdown and grant revocation',
      async () => {
        await db.query("UPDATE app.customer SET status='inactive' WHERE organization_id=$1", [org]);
        const shutdown = await req(
          'PATCH',
          '/api/admin/sap-systems/' + system.id,
          { ...system, status: 'inactive' },
          a,
        );
        assert.equal(shutdown.statusCode, 200, shutdown.body);
        const revoke = await req(
          'POST',
          '/api/admin/sap-systems/' + system.id + '/grants',
          {
            customerId: borrower,
            expiresAt: '2099-01-01T00:00:00Z',
            active: false,
            rowVersion: grantRevision,
          },
          a,
        );
        assert.equal(revoke.statusCode, 200, revoke.body);
      },
    );
  } finally {
    if (originalKey === undefined) delete process.env.SAP_CREDENTIAL_KEY;
    else process.env.SAP_CREDENTIAL_KEY = originalKey;
    await app?.close();
    for (const table of [
      'user_project_sap_config',
      'project_sap_config',
      'sap_system_grant',
      'sap_system',
      'auth_session',
      'project_member',
      'project',
      'customer',
      'organization_member',
      'audit_event',
    ])
      await db.query('DELETE FROM app.' + table + ' WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.user_password WHERE user_id=ANY($1::uuid[])', [
      [admin, member, outsider],
    ]);
    await db.query('DELETE FROM app.app_user WHERE id=ANY($1::uuid[])', [
      [admin, member, outsider],
    ]);
    await db.query('DELETE FROM app.organization WHERE id=ANY($1::uuid[])', [[org, other]]);
    for (const value of ['sap-test-' + suffix, ...[0, 1, 2].map((i) => 'sap' + i + '-' + suffix)])
      await db.query('DELETE FROM app.login_throttle WHERE key_hash=$1', [digest(value)]);
    await db.end();
  }
});
