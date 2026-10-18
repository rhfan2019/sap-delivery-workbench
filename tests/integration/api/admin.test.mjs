import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { hashPassword } from '../../../apps/api/src/platform/password.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { grantRole, dropOrganizations } from '../../fixtures/access.mjs';

// Organization profile, customers, projects with their master data, and accounts
// (docs/specs/project-access-admin.md sections 1 and 2.6).
test('organization administration, project master data and accounts follow the permissions', async (t) => {
  const db = await connectDatabase();
  const org = randomUUID(),
    otherOrg = randomUUID(),
    admin = randomUUID(),
    member = randomUUID(),
    pm = randomUUID();
  const suffix = org.slice(0, 8);
  const password = 'Admin test passphrase!';
  const testIp = 'admin-test-' + org;
  const users = [admin, member, pm];
  const logins = ['adm-' + suffix, 'mem-' + suffix, 'pm-' + suffix];
  let app;
  try {
    await db.query(
      "INSERT INTO app.organization(id,code,name) VALUES($1,$2,'Test'),($3,$4,'Other')",
      [org, 'T' + suffix.toUpperCase(), otherOrg, 'O' + suffix.toUpperCase()],
    );
    const hash = await hashPassword(password);
    for (const [i, id] of users.entries()) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        logins[i],
        ['Admin', 'Member', 'Manager'][i],
      ]);
      await db.query(
        'INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,$2,false)',
        [id, hash],
      );
      await db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
        org,
        id,
      ]);
    }
    await grantRole(db, org, admin, 'SYS_SUPER_ADMIN');
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
      m = await login(logins[1]),
      p = await login(logins[2]);

    await t.test('the session carries the organization permissions', async () => {
      const session = (await req('GET', '/api/session', undefined, a)).json();
      assert.ok(session.permissions.includes('role:manage'));
      assert.ok(session.permissions.includes('org.security:manage'));
      assert.equal(session.canManageOrganization, undefined);
      assert.deepEqual((await req('GET', '/api/session', undefined, m)).json().permissions, []);
    });
    await t.test('without a permission the answer names it', async () => {
      const r = await req('GET', '/api/admin/organization', undefined, m);
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().code, 'ACCESS_DENIED');
      assert.equal(r.json().details.permission, 'org.profile:view');
      assert.match(r.json().message, /查看企业资料/);
      assert.equal(
        (await req('POST', '/api/admin/customers', { name: 'No', code: 'NO' }, m)).statusCode,
        403,
      );
    });
    await t.test('the organization code can change (backlog FEAT-001)', async () => {
      const before = (await req('GET', '/api/admin/organization', undefined, a)).json();
      const denied = await req(
        'PATCH',
        '/api/admin/organization',
        { name: before.name, code: 'NOPE', rowVersion: before.rowVersion },
        m,
      );
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.json().details.permission, 'org.profile:edit');
      const invalid = await req(
        'PATCH',
        '/api/admin/organization',
        { name: before.name, code: 'Bad code', rowVersion: before.rowVersion },
        a,
      );
      assert.equal(invalid.statusCode, 400);
      const taken = await req(
        'PATCH',
        '/api/admin/organization',
        { name: before.name, code: 'O' + suffix, rowVersion: before.rowVersion },
        a,
      );
      assert.equal(taken.statusCode, 409);
      let r = await req(
        'PATCH',
        '/api/admin/organization',
        { name: before.name, code: 'r' + suffix, rowVersion: before.rowVersion },
        a,
      );
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().code, 'R' + suffix.toUpperCase());
      assert.equal(r.json().id, before.id);
      // Left out, the code stays; then it goes back for the tests that follow.
      r = await req(
        'PATCH',
        '/api/admin/organization',
        { name: before.name, rowVersion: r.json().rowVersion },
        a,
      );
      assert.equal(r.json().code, 'R' + suffix.toUpperCase());
      r = await req(
        'PATCH',
        '/api/admin/organization',
        { name: before.name, code: before.code, rowVersion: r.json().rowVersion },
        a,
      );
      assert.equal(r.json().code, before.code);
    });
    let customer;
    await t.test('customer create, duplicate and stale updates', async () => {
      let r = await req(
        'POST',
        '/api/admin/customers',
        { name: 'Customer', code: 'CUST', customerKind: 'external', description: '' },
        a,
      );
      assert.equal(r.statusCode, 201);
      customer = r.json();
      assert.equal(customer.projectCount, 0);
      assert.equal(
        (await req('POST', '/api/admin/customers', { name: 'Dup', code: 'CUST' }, a)).statusCode,
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
        (await req('POST', '/api/admin/customers', { name: 'bad', code: 'bad space' }, a))
          .statusCode,
        400,
      );
    });
    let project;
    await t.test('a new project starts with phases, milestones and its manager', async () => {
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
            { customerId: foreign.id, code: 'P', name: 'P' },
            a,
          )
        ).statusCode,
        404,
      );
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
      const r = await req(
        'POST',
        '/api/admin/projects',
        {
          customerId: customer.id,
          code: 'P',
          name: 'Project',
          shortName: 'P1',
          projectType: 'conversion',
          plannedStartDate: '2026-10-01',
          plannedEndDate: '2027-06-30',
          managerId: pm,
        },
        a,
      );
      assert.equal(r.statusCode, 201);
      project = (await req('GET', '/api/projects/' + r.json().id, undefined, p)).json();
      assert.equal(project.projectType, 'conversion');
      assert.equal(project.phases.length, 6);
      assert.equal(project.milestones.length, 9);
      assert.ok(project.milestones.some((x) => x.key === 'go_live'));
      assert.equal(project.keyRoles.manager.displayName, 'Manager');
      assert.ok(project.access.permissions.includes('project.member:manage'));
      const list = (await req('GET', '/api/admin/projects', undefined, a)).json();
      assert.equal(list[0].managerName, 'Manager');
      assert.equal(list[0].memberCount, 1);
      assert.equal((await req('GET', '/api/projects', undefined, m)).json().length, 0);
      assert.equal((await req('GET', '/api/projects/' + project.id, undefined, m)).statusCode, 404);
    });
    await t.test('the project manager maintains the master data', async () => {
      let r = await req(
        'PATCH',
        '/api/projects/' + project.id,
        {
          ...project,
          status: 'active',
          methodology: 'activate',
          contractRole: 'subcontract',
          primeContractor: 'Prime Ltd',
          sapProduct: 's4_onpremise',
          sapRelease: 'S/4HANA 2023 FPS02',
          deployment: 'private_cloud',
          modules: ['MM', 'FICO', 'SD'],
          language: 'zh',
          namespace: '/abc/',
          defaultPackage: 'zfi_report',
        },
        p,
      );
      assert.equal(r.statusCode, 200, r.body);
      project = r.json();
      assert.deepEqual(project.modules, ['FICO', 'MM', 'SD']);
      assert.equal(project.namespace, '/ABC/');
      assert.equal(project.defaultPackage, 'ZFI_REPORT');
      assert.equal(
        (await req('PATCH', '/api/projects/' + project.id, { ...project, rowVersion: '1' }, p))
          .statusCode,
        409,
      );
      assert.equal(
        (
          await req(
            'PATCH',
            '/api/projects/' + project.id,
            { ...project, contractRole: 'subcontract', primeContractor: '' },
            p,
          )
        ).statusCode,
        400,
      );
      r = await req(
        'PATCH',
        `/api/projects/${project.id}/commercial`,
        {
          contractNo: 'C-1',
          contractModel: 'fixed',
          contractDays: 820.5,
          devBudgetDays: 120,
          teamSize: 14,
          rowVersion: project.rowVersion,
        },
        p,
      );
      assert.equal(r.statusCode, 200);
      project = r.json();
      assert.equal(project.contractDays, 820.5);
      assert.equal(project.plannedDays, 0);
      assert.equal(
        (
          await req(
            'PATCH',
            `/api/projects/${project.id}/commercial`,
            { contractDays: 1.25, rowVersion: project.rowVersion },
            p,
          )
        ).statusCode,
        400,
      );
      // Key positions and module leads must be project members.
      assert.equal(
        (
          await req(
            'PUT',
            `/api/projects/${project.id}/team`,
            { keyRoles: { architect: member }, rowVersion: project.rowVersion },
            p,
          )
        ).statusCode,
        400,
      );
      r = await req(
        'PUT',
        `/api/projects/${project.id}/team`,
        {
          keyRoles: { manager: pm },
          moduleLeads: [{ module: 'MM', userId: pm }],
          rowVersion: project.rowVersion,
        },
        p,
      );
      assert.equal(r.statusCode, 200);
      project = r.json();
      assert.equal(project.moduleLeads[0].module, 'MM');
      r = await req(
        'POST',
        `/api/projects/${project.id}/contacts`,
        {
          name: '张经理',
          contactRole: 'customer_pm',
          phone: '13800000000',
          email: 'zhang@example.com',
          modules: ['MM'],
        },
        p,
      );
      assert.equal(r.statusCode, 200);
      project = r.json();
      assert.equal(project.contacts[0].phone, '13800000000');
      const phases = project.phases.map((ph) =>
        ph.key === 'prepare'
          ? { ...ph, status: 'in_progress', plannedStart: '2026-10-01', plannedEnd: '2026-10-31' }
          : ph,
      );
      r = await req('PUT', `/api/projects/${project.id}/phases`, { phases }, p);
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().currentPhase, '准备');
      assert.equal(
        (await req('PUT', `/api/projects/${project.id}/phases`, { phases }, p)).statusCode,
        409,
        'stale phase versions are refused',
      );
      const freeze = r.json().milestones.find((x) => x.key === 'code_freeze');
      assert.equal(
        (
          await req(
            'DELETE',
            `/api/projects/${project.id}/milestones/${freeze.id}`,
            { rowVersion: freeze.rowVersion },
            p,
          )
        ).statusCode,
        409,
      );
      r = await req(
        'PATCH',
        `/api/projects/${project.id}/milestones/${freeze.id}`,
        { ...freeze, plannedOn: '2027-01-15' },
        p,
      );
      assert.equal(r.statusCode, 200);
      r = await req(
        'POST',
        `/api/projects/${project.id}/milestones`,
        { name: '数据迁移彩排', phaseKey: 'deploy', plannedOn: '2027-03-01' },
        p,
      );
      const extra = r.json().milestones.find((x) => x.name === '数据迁移彩排');
      assert.equal(
        (
          await req(
            'DELETE',
            `/api/projects/${project.id}/milestones/${extra.id}`,
            { rowVersion: extra.rowVersion },
            p,
          )
        ).statusCode,
        200,
      );
      r = await req(
        'POST',
        `/api/projects/${project.id}/health`,
        {
          overall: 'yellow',
          schedule: 'yellow',
          scope: 'green',
          cost: 'green',
          quality: 'green',
          note: '蓝图延期一周',
        },
        p,
      );
      assert.equal(r.statusCode, 200);
      project = r.json();
      assert.equal(project.health[0].overall, 'yellow');
      assert.equal(project.healthStale, false);
    });
    await t.test(
      'observers see the project without commercial fields or contact details',
      async () => {
        await grantRole(db, org, member, 'C_OBSERVER', { projectId: project.id });
        const seen = (await req('GET', '/api/projects/' + project.id, undefined, m)).json();
        assert.equal(seen.contractDays, undefined);
        assert.equal(seen.plannedDays, undefined);
        assert.equal(seen.contacts[0].phone, '');
        assert.equal(seen.contacts[0].hidden, true);
        assert.equal(
          (await req('GET', '/api/projects', undefined, m)).json()[0].contractNo,
          undefined,
        );
        const denied = await req('PATCH', '/api/projects/' + project.id, { ...project }, m);
        assert.equal(denied.statusCode, 403);
        assert.equal(denied.json().details.permission, 'project:edit');
      },
    );
    await t.test('accounts: positions, one-time passwords and self protection', async () => {
      const positions = (await req('GET', '/api/admin/positions', undefined, a)).json();
      const pmo = positions.find((x) => x.code === 'PMO');
      const name = 'new-' + suffix;
      logins.push(name);
      const r = await req(
        'POST',
        '/api/admin/users',
        {
          loginName: name,
          displayName: 'New user',
          email: '',
          positionId: pmo.id,
          grantPositionRoles: true,
          skillModules: ['MM'],
        },
        a,
      );
      assert.equal(r.statusCode, 201);
      const created = r.json();
      users.push(created.user.id);
      assert.deepEqual(created.granted, ['C_PMO']);
      assert.equal(created.user.position.name, 'PMO');
      assert.ok(created.temporaryPassword.length >= 12);
      const signed = await req('POST', '/api/login', {
        loginName: name,
        password: created.temporaryPassword,
      });
      assert.equal(signed.json().mustChangePassword, true);
      const cookie = signed.headers['set-cookie'].split(';')[0];
      assert.equal((await req('GET', '/api/admin/users', undefined, cookie)).statusCode, 403);
      const reset = await req(
        'POST',
        `/api/admin/users/${created.user.id}/reset-password`,
        { rowVersion: created.user.rowVersion },
        a,
      );
      assert.equal(reset.statusCode, 200);
      assert.equal(
        (await req('GET', '/api/session', undefined, cookie)).json().authenticated,
        false,
      );
      const all = (await req('GET', '/api/admin/users', undefined, a)).json();
      assert.equal(JSON.stringify(all).includes('password_hash'), false);
      const self = all.find((u) => u.id === admin);
      assert.equal(
        (await req('PATCH', `/api/admin/users/${admin}`, { ...self, status: 'disabled' }, a))
          .statusCode,
        400,
      );
      const target = all.find((u) => u.id === member);
      assert.equal(
        (
          await req(
            'PATCH',
            `/api/admin/users/${member}`,
            { ...target, positionId: target.position?.id, status: 'disabled' },
            a,
          )
        ).statusCode,
        200,
      );
      assert.equal((await req('GET', '/api/session', undefined, m)).json().authenticated, false);
      const me = (await req('GET', '/api/me', undefined, p)).json();
      assert.equal(
        (
          await req(
            'PATCH',
            '/api/me',
            { displayName: '项目经理', email: 'pm@example.com', rowVersion: me.rowVersion },
            p,
          )
        ).json().displayName,
        '项目经理',
      );
    });
    await t.test('archiving makes the project read-only', async () => {
      const r = await req('POST', `/api/projects/${project.id}/archive`, { rowVersion: '1' }, p);
      assert.equal(r.statusCode, 409, 'stale version');
      const fresh = (await req('GET', '/api/projects/' + project.id, undefined, p)).json();
      assert.equal(
        (
          await req(
            'POST',
            `/api/projects/${project.id}/archive`,
            { rowVersion: fresh.rowVersion },
            p,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (await req('PATCH', '/api/projects/' + project.id, { ...fresh, name: 'Changed' }, p))
          .statusCode,
        409,
      );
      assert.equal(
        (
          await req(
            'POST',
            `/api/projects/${project.id}/health`,
            { overall: 'red', schedule: 'red', scope: 'red', cost: 'red', quality: 'red' },
            p,
          )
        ).statusCode,
        409,
      );
    });
    assert.ok(
      (
        await db.query(
          "SELECT count(*) FROM app.audit_event WHERE organization_id=$1 AND action IN ('admin.project.create','project.update','project.health.report')",
          [org],
        )
      ).rows[0].count >= 3,
    );
  } finally {
    await app?.close();
    await dropOrganizations(db, [org, otherOrg], users);
    for (const key of [testIp, ...logins])
      await db.query('DELETE FROM app.login_throttle WHERE key_hash=$1', [digest(key)]);
    await db.end();
  }
});
