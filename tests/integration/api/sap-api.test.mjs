import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { hashPassword } from '../../../apps/api/src/platform/password.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { resolveProjectSap } from '../../../apps/api/src/modules/sap/targets.mjs';
import { grantRole, dropOrganizations } from '../../fixtures/access.mjs';

const probeServer = new URL(
  '../../fixtures/sap-probe-server.mjs',
  import.meta.url,
).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
async function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

// Contract 3.4 / docs/specs/project-access-admin.md section 3: project SAP systems without
// passwords, personal credentials, the saving policy and what the agents receive.
test('project SAP systems, personal credentials and the saving policy', async (t) => {
  const db = await connectDatabase(),
    org = randomUUID(),
    customer = randomUUID(),
    project = randomUUID(),
    sibling = randomUUID();
  const names = ['admin', 'pm', 'consultant', 'observer', 'sub'];
  const ids = Object.fromEntries(names.map((n) => [n, randomUUID()]));
  const suffix = org.slice(0, 8),
    password = 'SAP test login passphrase!',
    secret = 'Private SAP password ' + suffix;
  const originalKey = process.env.SAP_CREDENTIAL_KEY;
  process.env.SAP_CREDENTIAL_KEY = 'c'.repeat(64);
  const login = (n) => 'sap-' + n + '-' + suffix;
  let app;
  try {
    await db.query("INSERT INTO app.organization(id,code,name) VALUES($1,$2,'SAP Test')", [
      org,
      'S' + suffix.toUpperCase(),
    ]);
    const hash = await hashPassword(password);
    for (const n of names) {
      await db.query(
        'INSERT INTO app.app_user(id,login_name,display_name,person_type) VALUES($1,$2,$3,$4)',
        [ids[n], login(n), n, n === 'sub' ? 'subcontractor' : 'employee'],
      );
      await db.query(
        'INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,$2,false)',
        [ids[n], hash],
      );
      await db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
        org,
        ids[n],
      ]);
    }
    await db.query("INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$2,'C','C')", [
      customer,
      org,
    ]);
    await db.query(
      "INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$3,$4,'P1','Project'),($2,$3,$4,'P2','Sibling')",
      [project, sibling, org, customer],
    );
    await grantRole(db, org, ids.admin, 'SYS_SUPER_ADMIN');
    await grantRole(db, org, ids.pm, 'C_PM', { projectId: project });
    await grantRole(db, org, ids.pm, 'C_PM', { projectId: sibling });
    await grantRole(db, org, ids.consultant, 'C_FUNC', { projectId: project });
    await grantRole(db, org, ids.observer, 'C_OBSERVER', { projectId: project });
    await grantRole(db, org, ids.sub, 'C_SUBCON_DEV', {
      projectId: project,
      validTo: '2099-12-31',
    });
    app = await createApp({ organizationId: org });
    const req = (method, url, body, cookie) =>
      app.inject({
        method,
        url,
        payload: body,
        remoteAddress: 'sap-test-' + suffix,
        headers: { origin: 'http://127.0.0.1:5173', ...(cookie ? { cookie } : {}) },
      });
    const c = {};
    for (const n of names) {
      const r = await req('POST', '/api/login', { loginName: login(n), password });
      assert.equal(r.statusCode, 200);
      c[n] = r.headers['set-cookie'].split(';')[0];
    }
    const base = `/api/projects/${project}/sap-systems`;
    const input = {
      name: 'S/4 开发 100',
      purpose: 'development',
      sid: 's4d',
      sapUrl: 'https://sap.invalid',
      client: '100',
      language: 'zh',
    };
    let dev, qas;

    await t.test(
      'the project manager registers systems; never with credentials or paths',
      async () => {
        assert.equal((await req('POST', base, input, c.observer)).statusCode, 403);
        for (const sapUrl of [
          'https://user:pw@sap.invalid',
          'https://sap.invalid/sap/bc/adt',
          'ftp://sap.invalid',
        ])
          assert.equal((await req('POST', base, { ...input, sapUrl }, c.pm)).statusCode, 400);
        assert.equal(
          (await req('POST', base, { ...input, purpose: 'production' }, c.pm)).statusCode,
          400,
        );
        let r = await req('POST', base, input, c.pm);
        assert.equal(r.statusCode, 201, r.body);
        dev = r.json().systems.find((s) => s.purpose === 'development');
        assert.deepEqual([dev.sid, dev.language, dev.isDefault], ['S4D', 'ZH', true]);
        assert.equal((await req('POST', base, input, c.pm)).statusCode, 409);
        r = await req(
          'POST',
          base,
          { ...input, name: 'S/4 测试 200', purpose: 'test', sid: 'S4Q', client: '200' },
          c.pm,
        );
        qas = r.json().systems.find((s) => s.purpose === 'test');
        assert.equal(qas.isDefault, true);
        r = await req('POST', base, { ...input, name: 'BW 开发', sid: 'BWD', client: '300' }, c.pm);
        const bw = r.json().systems.find((s) => s.sid === 'BWD');
        assert.equal(bw.isDefault, false);
        r = await req('POST', `${base}/${bw.id}/default`, {}, c.pm);
        assert.deepEqual(
          r
            .json()
            .systems.filter((s) => s.purpose === 'development' && s.isDefault)
            .map((s) => s.sid),
          ['BWD'],
        );
        // Switching the default off hands the default back to another active system.
        r = await req(
          'PATCH',
          `${base}/${bw.id}`,
          {
            ...input,
            name: 'BW 开发',
            sid: 'BWD',
            client: '300',
            status: 'inactive',
            rowVersion: r.json().systems.find((s) => s.sid === 'BWD').rowVersion,
          },
          c.pm,
        );
        assert.equal(r.statusCode, 200, r.body);
        assert.deepEqual(
          r
            .json()
            .systems.filter((s) => s.purpose === 'development' && s.isDefault)
            .map((s) => s.sid),
          ['S4D'],
        );
        dev = r.json().systems.find((s) => s.sid === 'S4D');
        assert.equal(JSON.stringify(r.json()).includes('password'), false);
        const seen = (await req('GET', base, undefined, c.observer)).json();
        assert.equal(seen.canManage, false);
        assert.equal(seen.systems.find((s) => s.sid === 'S4D').canRead, false);
      },
    );

    await t.test(
      'a credential is kept only after SAP accepts it, and only for its owner',
      async () => {
        const credential = `${base}/${dev.id}/credential`;
        await withEnv({ SAP_MCP_ENTRY: probeServer }, async () => {
          assert.equal(
            (await req('PUT', credential, { username: 'ok', password: secret }, c.observer))
              .statusCode,
            403,
            'reading the development system needs sap.development:read',
          );
          const refused = await req(
            'PUT',
            credential,
            { username: 'bad-auth', password: secret, mode: 'saved' },
            c.consultant,
          );
          assert.equal(refused.statusCode, 400);
          assert.equal(refused.json().code, 'SAP_LOGIN_FAILED');
          assert.ok(!refused.body.includes(secret));
          const ok = await req(
            'PUT',
            credential,
            { username: 'ok', password: secret, mode: 'saved' },
            c.consultant,
          );
          assert.equal(ok.statusCode, 200, ok.body);
          assert.ok(!ok.body.includes(secret));
          const state = ok.json().systems.find((s) => s.id === dev.id).credential;
          assert.deepEqual([state.state, state.username], ['saved', 'ok']);
          assert.ok(Date.parse(state.expiresAt) - Date.now() <= 30 * 86400000 + 60000);
        });
        const row = (
          await db.query(
            'SELECT password_cipher FROM app.sap_user_credential WHERE system_id=$1 AND user_id=$2',
            [dev.id, ids.consultant],
          )
        ).rows[0];
        assert.ok(row && !row.password_cipher.includes(secret));
        // Someone else sees no credential; the agents of the owner get it.
        assert.equal(
          (await req('GET', base, undefined, c.pm)).json().systems.find((s) => s.id === dev.id)
            .credential.state,
          'none',
        );
        const scope = {
          organizationId: org,
          projectId: project,
          actorId: ids.consultant,
          sessionId: randomUUID(),
        };
        const resolved = await resolveProjectSap(db, scope, { purpose: 'development' });
        assert.deepEqual(
          [resolved.env.SAP_USER, resolved.env.SAP_PASSWORD, resolved.env.SAP_CLIENT],
          ['ok', secret, '100'],
        );
        assert.equal(resolved.target.systemCode, 'S4D');
        await assert.rejects(
          resolveProjectSap(db, { ...scope, actorId: ids.sub }, { purpose: 'development' }),
          (e) => e.code === 'SAP_LOGIN_REQUIRED' && e.details.systemId === dev.id,
        );
        await assert.rejects(
          resolveProjectSap(db, { ...scope, actorId: ids.observer }, { purpose: 'development' }),
          (e) => e.code === 'ACCESS_DENIED',
        );
        // SAP refusing the saved password discards it (no second try that could lock the user).
        await resolved.rejected();
        assert.equal(
          (await req('GET', base, undefined, c.consultant))
            .json()
            .systems.find((s) => s.id === dev.id).credential.state,
          'none',
        );
      },
    );

    await t.test(
      'this-login credentials stay in memory; changed systems forget saved ones',
      async () => {
        const credential = `${base}/${qas.id}/credential`;
        await withEnv({ SAP_MCP_ENTRY: probeServer }, async () => {
          const r = await req(
            'PUT',
            credential,
            { username: 'ok', password: secret, mode: 'session' },
            c.consultant,
          );
          assert.equal(r.json().systems.find((s) => s.id === qas.id).credential.state, 'session');
          const stored = await db.query(
            'SELECT count(*)::int AS n FROM app.sap_user_credential WHERE system_id=$1',
            [qas.id],
          );
          assert.equal(stored.rows[0].n, 0);
          await req(
            'PUT',
            `${base}/${dev.id}/credential`,
            { username: 'ok', password: secret, mode: 'saved' },
            c.consultant,
          );
        });
        const current = (await req('GET', base, undefined, c.pm))
          .json()
          .systems.find((s) => s.id === dev.id);
        await req(
          'PATCH',
          `${base}/${dev.id}`,
          { ...input, client: '110', rowVersion: current.rowVersion },
          c.pm,
        );
        const after = (await req('GET', base, undefined, c.consultant)).json().systems;
        assert.equal(
          after.find((s) => s.id === dev.id).credential.state,
          'none',
          'the client changed',
        );
        assert.equal(after.find((s) => s.id === qas.id).credential.state, 'session');
        assert.equal(
          (await req('DELETE', `${base}/${qas.id}/credential`, undefined, c.consultant))
            .json()
            .systems.find((s) => s.id === qas.id).credential.state,
          'none',
        );
        const mine = (await req('GET', '/api/sap-credentials', undefined, c.consultant)).json();
        assert.deepEqual(mine.items.map((i) => i.system.sid).sort(), ['S4D', 'S4Q']);
      },
    );

    await t.test('the organization policy decides who may save passwords', async () => {
      await withEnv({ SAP_MCP_ENTRY: probeServer }, async () => {
        const r = await req(
          'PUT',
          `${base}/${dev.id}/credential`,
          { username: 'ok', password: secret, mode: 'saved' },
          c.sub,
        );
        assert.equal(r.statusCode, 403, 'subcontractors may not save by default');
        await req(
          'PUT',
          `${base}/${dev.id}/credential`,
          { username: 'ok', password: secret, mode: 'saved' },
          c.consultant,
        );
      });
      assert.equal(
        (await req('GET', '/api/admin/sap-credential-policy', undefined, c.pm)).statusCode,
        403,
      );
      const policy = (
        await req('GET', '/api/admin/sap-credential-policy', undefined, c.admin)
      ).json();
      assert.deepEqual([policy.allowSave, policy.maxDays, policy.idleDays], [true, 30, 14]);
      assert.equal(
        (await req('GET', '/api/admin/sap-credentials', undefined, c.admin)).json().length,
        1,
      );
      const off = await req(
        'PUT',
        '/api/admin/sap-credential-policy',
        { ...policy, allowSave: false },
        c.admin,
      );
      assert.equal(off.statusCode, 200);
      assert.equal(
        (await req('GET', '/api/admin/sap-credentials', undefined, c.admin)).json().length,
        0,
      );
      assert.equal((await req('GET', base, undefined, c.consultant)).json().canSave, false);
      await req(
        'PUT',
        '/api/admin/sap-credential-policy',
        { ...off.json(), allowSave: true },
        c.admin,
      );
      const purge = await req(
        'DELETE',
        `/api/admin/users/${ids.consultant}/sap-credentials`,
        {},
        c.admin,
      );
      assert.equal(purge.statusCode, 200);
    });

    await t.test('local development may log in with the credentials file', async () => {
      const { mkdtemp, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const profile = join(await mkdtemp(join(tmpdir(), 'sap-profile-')), 'profile.json');
      await writeFile(
        profile,
        JSON.stringify({
          SAP_URL: 'https://sap.invalid',
          SAP_CLIENT: '200',
          SAP_USER: 'ok',
          SAP_PASSWORD: secret,
        }),
      );
      await withEnv({ SAP_MCP_ENTRY: probeServer, SAP_MCP_PROFILE_FILE: profile }, async () => {
        const view = (await req('GET', base, undefined, c.consultant)).json();
        assert.equal(view.systems.find((s) => s.id === qas.id).credential.state, 'profile');
        const r = await req('POST', `${base}/${qas.id}/credential/profile`, {}, c.consultant);
        assert.equal(r.statusCode, 200, r.body);
        assert.ok(!r.body.includes(secret));
        assert.equal(r.json().systems.find((s) => s.id === qas.id).credential.state, 'session');
        assert.equal(
          (await req('POST', `${base}/${dev.id}/credential/profile`, {}, c.consultant)).statusCode,
          409,
        );
      });
    });

    await t.test('copying, the directory and archived projects', async () => {
      const r = await req(
        'POST',
        `/api/projects/${sibling}/sap-systems/copy`,
        { sourceProjectId: project },
        c.pm,
      );
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().copied, 3);
      assert.equal((await req('GET', '/api/admin/sap-systems', undefined, c.pm)).statusCode, 403);
      assert.equal(
        (await req('GET', '/api/admin/sap-systems', undefined, c.admin)).json().length,
        6,
      );
      await db.query("UPDATE app.project SET status='archived',archived_at=now() WHERE id=$1", [
        project,
      ]);
      assert.equal((await req('POST', base, { ...input, client: '900' }, c.pm)).statusCode, 409);
      assert.equal((await req('GET', base, undefined, c.pm)).json().readOnly, true);
    });
    assert.ok(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM app.audit_event WHERE organization_id=$1 AND action IN ('sap.credential.save','sap.credential.login','sap.system.create')",
          [org],
        )
      ).rows[0].n >= 3,
    );
  } finally {
    await app?.close();
    await dropOrganizations(db, [org], Object.values(ids));
    for (const value of ['sap-test-' + suffix, ...names.map(login)])
      await db.query('DELETE FROM app.login_throttle WHERE key_hash=$1', [digest(value)]);
    await db.end();
    if (originalKey === undefined) delete process.env.SAP_CREDENTIAL_KEY;
    else process.env.SAP_CREDENTIAL_KEY = originalKey;
  }
});
