import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { hashPassword } from '../../../apps/api/src/platform/password.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { grantRole, dropOrganizations } from '../../fixtures/access.mjs';

// docs/specs/project-access-admin.md section 2: roles, assignments, data scope, no escalation,
// explanations. Every check here goes through the real HTTP API.
test('roles, assignments and project data scope decide what each person can do', async (t) => {
  const db = await connectDatabase();
  const org = randomUUID(),
    customer = randomUUID(),
    otherCustomer = randomUUID(),
    project = randomUUID(),
    other = randomUUID();
  const names = ['admin', 'roleadmin', 'pm', 'dev', 'sub', 'director', 'lead'];
  const ids = Object.fromEntries(names.map((n) => [n, randomUUID()]));
  const suffix = org.slice(0, 8);
  const password = 'Access test passphrase!';
  const testIp = 'access-test-' + org;
  const login = (n) => n + '-' + suffix;
  let app;
  try {
    await db.query('INSERT INTO app.organization(id,code,name) VALUES($1,$2,$3)', [
      org,
      'A' + suffix.toUpperCase(),
      'Access',
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
    await db.query(
      "INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$3,'C1','Customer'),($2,$3,'C2','Other')",
      [customer, otherCustomer, org],
    );
    await db.query(
      "INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$3,$4,'P1','Project'),($2,$3,$5,'P2','Other')",
      [project, other, org, customer, otherCustomer],
    );
    // Two items: an MM item the developer owns, a FICO item nobody assigned.
    const items = {};
    for (const [no, module] of [
      [1, 'MM'],
      [2, 'FICO'],
    ]) {
      const id = randomUUID();
      items[module] = id;
      await db.query(
        "INSERT INTO app.development_item(id,organization_id,project_id,item_no,name,module,kind,created_by) VALUES($1,$2,$3,$4,$5,$6,'report',$7)",
        [id, org, project, no, module + ' item', module, ids.admin],
      );
      for (const phase of ['fsd', 'development', 'consultant_test', 'user_test'])
        await db.query(
          'INSERT INTO app.development_item_phase(organization_id,project_id,item_id,phase) VALUES($1,$2,$3,$4)',
          [org, project, id, phase],
        );
    }
    await grantRole(db, org, ids.admin, 'SYS_SUPER_ADMIN');
    await grantRole(db, org, ids.roleadmin, 'SYS_ROLE_ADMIN');
    await grantRole(db, org, ids.pm, 'C_PM', { projectId: project });
    app = await createApp({ organizationId: org });
    const req = (method, url, body, cookie) =>
      app.inject({
        method,
        url,
        payload: body,
        remoteAddress: testIp,
        headers: { origin: 'http://127.0.0.1:5173', ...(cookie ? { cookie } : {}) },
      });
    const cookies = {};
    for (const n of names) {
      const r = await req('POST', '/api/login', { loginName: login(n), password });
      assert.equal(r.statusCode, 200);
      cookies[n] = r.headers['set-cookie'].split(';')[0];
    }
    const roles = (await req('GET', '/api/admin/roles', undefined, cookies.admin)).json();
    const role = (code) => roles.find((r) => r.code === code);
    const itemUrl = (module) => `/api/projects/${project}/development-items/${items[module]}`;
    const item = async (module, who) => (await req('GET', itemUrl(module), undefined, who)).json();

    await t.test('built-in roles follow the catalog and cannot be changed', async () => {
      assert.ok(role('SYS_SUPER_ADMIN').permissions.includes('org.security:manage'));
      assert.deepEqual(
        role('C_DEV')
          .members.map((m) => m.code)
          .sort(),
        ['AG_DEV', 'DL_EDIT', 'DL_LOAD', 'PRJ_VIEW'],
      );
      const r = await req(
        'PATCH',
        '/api/admin/roles/' + role('C_DEV').id,
        { name: 'x', rowVersion: role('C_DEV').rowVersion },
        cookies.admin,
      );
      assert.equal(r.statusCode, 409);
    });

    let custom;
    await t.test('custom roles add the view permission and refuse escalation', async () => {
      let r = await req(
        'POST',
        '/api/admin/roles',
        {
          code: 'Z_LIST_DELETE',
          name: '清单删除',
          kind: 'single',
          scope: 'project',
          permissions: ['delivery.item:delete'],
        },
        cookies.admin,
      );
      assert.equal(r.statusCode, 201);
      custom = r.json();
      assert.deepEqual(custom.permissions, ['delivery.item:view', 'delivery.item:delete']);
      // The role administrator holds no project permissions, so cannot grant them.
      r = await req(
        'POST',
        '/api/admin/roles',
        {
          code: 'Z_ESCALATE',
          name: 'x',
          kind: 'single',
          scope: 'organization',
          permissions: ['model:manage'],
        },
        cookies.roleadmin,
      );
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().code, 'ACCESS_ESCALATION');
      assert.deepEqual(r.json().details.permissions, ['model:view', 'model:manage']);
      r = await req(
        'POST',
        '/api/admin/roles',
        { code: 'Z_BAD', name: 'x', kind: 'single', scope: 'project', permissions: ['model:view'] },
        cookies.admin,
      );
      assert.equal(r.statusCode, 400, 'a project role holds project permissions only');
      r = await req(
        'POST',
        '/api/admin/roles',
        { code: 'C_PM', name: 'x', kind: 'single', scope: 'project', permissions: [] },
        cookies.admin,
      );
      assert.equal(r.statusCode, 409, 'built-in codes are reserved');
    });

    await t.test('project members: module scope, own items and sensitive roles', async () => {
      // The project manager adds a developer limited to MM, and a subcontractor on own items.
      let r = await req(
        'POST',
        `/api/projects/${project}/members`,
        { userId: ids.dev, roles: [{ roleId: role('C_DEV').id, modules: ['MM'] }] },
        cookies.pm,
      );
      assert.equal(r.statusCode, 201, r.body);
      r = await req(
        'POST',
        `/api/projects/${project}/members`,
        { userId: ids.sub, roles: [{ roleId: role('C_SUBCON_DEV').id, ownOnly: true }] },
        cookies.pm,
      );
      assert.equal(r.statusCode, 400, 'a subcontractor needs an end date');
      r = await req(
        'POST',
        `/api/projects/${project}/members`,
        {
          userId: ids.sub,
          roles: [{ roleId: role('C_SUBCON_DEV').id, ownOnly: true, validTo: '2099-12-31' }],
        },
        cookies.pm,
      );
      assert.equal(r.statusCode, 201);
      const dev = await item('MM', cookies.dev);
      assert.equal(
        (
          await req(
            'PATCH',
            itemUrl('MM'),
            { rowVersion: dev.rowVersion, changes: { name: 'MM edited' } },
            cookies.dev,
          )
        ).statusCode,
        200,
      );
      const fico = await item('FICO', cookies.dev);
      r = await req(
        'PATCH',
        itemUrl('FICO'),
        { rowVersion: fico.rowVersion, changes: { name: 'nope' } },
        cookies.dev,
      );
      assert.equal(r.statusCode, 403, 'other modules are read-only');
      assert.equal(r.json().details.permission, 'delivery.item:edit');
      // Backlog BUG-004: new items only go into the creator's modules; a mis-filed item can be
      // handed over by whoever may edit it where it is, and then it is out of their hands.
      const list = `/api/projects/${project}/development-items`;
      r = await req('POST', list, { name: 'Wrong', module: 'FICO', kind: 'report' }, cookies.dev);
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().details.permission, 'delivery.item:create');
      r = await req('POST', list, { name: 'Moved', module: 'MM', kind: 'report' }, cookies.dev);
      assert.equal(r.statusCode, 201, r.body);
      const url = list + '/' + r.json().id;
      r = await req(
        'PATCH',
        url,
        { rowVersion: r.json().rowVersion, changes: { module: 'FICO' } },
        cookies.dev,
      );
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().module, 'FICO');
      r = await req(
        'PATCH',
        url,
        { rowVersion: r.json().rowVersion, changes: { module: 'MM' } },
        cookies.dev,
      );
      assert.equal(r.statusCode, 403, 'another module cannot pull an item in');
      r = await req('POST', list + '/batch', { action: 'copy', ids: [items.FICO] }, cookies.dev);
      assert.equal(r.statusCode, 403, 'copies stay within the creator’s modules');
      // The subcontractor may use the development agent only on items assigned to them.
      const agent = (module) =>
        `/api/projects/${project}/development-items/${items[module]}/abap-dev-agent/sessions`;
      assert.equal((await req('POST', agent('MM'), {}, cookies.sub)).statusCode, 403);
      await db.query(
        "UPDATE app.development_item_phase SET assignee_id=$2 WHERE item_id=$1 AND phase='development'",
        [items.MM, ids.sub],
      );
      assert.equal((await req('POST', agent('MM'), {}, cookies.sub)).statusCode, 201);
      assert.equal((await req('POST', agent('FICO'), {}, cookies.sub)).statusCode, 403);
      // Nobody changes their own roles; a role carrying sensitive permissions needs them.
      assert.equal(
        (
          await req(
            'PUT',
            `/api/projects/${project}/members/${ids.pm}/roles`,
            { roles: [{ roleId: role('C_OBSERVER').id }] },
            cookies.pm,
          )
        ).statusCode,
        400,
      );
      const memberManager = await req(
        'POST',
        '/api/admin/roles',
        {
          code: 'Z_MEMBERS',
          name: '成员管理',
          kind: 'single',
          scope: 'project',
          permissions: ['project.member:manage'],
        },
        cookies.admin,
      );
      // A member who sees the project and may manage members, without commercial rights.
      await grantRole(db, org, ids.lead, 'C_OBSERVER', { projectId: project });
      await db.query(
        'INSERT INTO app.access_project_role(organization_id,project_id,user_id,role_id) VALUES($1,$2,$3,$4)',
        [org, project, ids.lead, memberManager.json().id],
      );
      r = await req(
        'POST',
        `/api/projects/${project}/members`,
        { userId: ids.director, roles: [{ roleId: role('C_PM').id }] },
        cookies.lead,
      );
      assert.equal(r.statusCode, 403, 'C_PM carries commercial permissions the lead does not hold');
      assert.equal(r.json().code, 'ACCESS_ESCALATION');
      r = await req(
        'POST',
        `/api/projects/${project}/members`,
        { userId: ids.director, roles: [{ roleId: role('C_OBSERVER').id }] },
        cookies.lead,
      );
      assert.equal(r.statusCode, 201);
      const members = (
        await req('GET', `/api/projects/${project}/members`, undefined, cookies.dev)
      ).json();
      assert.deepEqual(
        members.find((m) => m.id === ids.dev).roles.map((x) => [x.roleCode, x.modules]),
        [['C_DEV', ['MM']]],
      );
      const access = (
        await req('GET', `/api/projects/${project}/access`, undefined, cookies.dev)
      ).json();
      assert.deepEqual(access.limits['delivery.item:edit'], [{ modules: ['MM'], ownOnly: false }]);
      assert.deepEqual(access.limits['delivery.item:create'], [
        { modules: ['MM'], ownOnly: false },
      ]);
      // Removing a member takes their roles away at once.
      const row = members.find((m) => m.id === ids.director);
      assert.equal(
        (
          await req(
            'DELETE',
            `/api/projects/${project}/members/${ids.director}`,
            { rowVersion: row.rowVersion },
            cookies.pm,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (await req('GET', '/api/projects/' + project, undefined, cookies.director)).statusCode,
        404,
      );
    });

    await t.test('organization assignments reach projects by scope and validity', async () => {
      const director = role('C_DELIVERY_DIRECTOR');
      let r = await req(
        'POST',
        `/api/admin/users/${ids.director}/assignments`,
        { roleId: director.id, projectScope: 'customers', scopeIds: [otherCustomer] },
        cookies.admin,
      );
      assert.equal(r.statusCode, 201, r.body);
      let visible = (await req('GET', '/api/projects', undefined, cookies.director)).json();
      assert.deepEqual(
        visible.map((p) => p.id),
        [other],
      );
      assert.equal(
        typeof visible[0].contractDays,
        'object',
        'commercial fields are visible (null)',
      );
      const assignment = r.json().find((x) => x.roleCode === 'C_DELIVERY_DIRECTOR');
      r = await req(
        'PATCH',
        `/api/admin/assignments/${assignment.id}`,
        {
          projectScope: 'all',
          validFrom: '2020-01-01',
          validTo: '2020-12-31',
          rowVersion: assignment.rowVersion,
        },
        cookies.admin,
      );
      assert.equal(r.statusCode, 200);
      visible = (await req('GET', '/api/projects', undefined, cookies.director)).json();
      assert.deepEqual(visible, [], 'an expired assignment no longer counts');
      assert.equal(
        (
          await req(
            'POST',
            `/api/admin/users/${ids.admin}/assignments`,
            { roleId: director.id },
            cookies.admin,
          )
        ).statusCode,
        400,
        'nobody changes their own roles',
      );
      r = await req(
        'POST',
        `/api/admin/users/${ids.dev}/assignments`,
        { roleId: role('SYS_PLATFORM').id },
        cookies.roleadmin,
      );
      assert.equal(r.statusCode, 403, 'the role administrator does not hold platform permissions');
    });

    await t.test('the last super administrator stays', async () => {
      const own = (
        await req('GET', `/api/admin/users/${ids.admin}/access`, undefined, cookies.admin)
      ).json();
      const sup = own.assignments.find((a) => a.roleCode === 'SYS_SUPER_ADMIN');
      // Even someone allowed to manage assignments cannot remove the only super administrator.
      const r = await req(
        'DELETE',
        `/api/admin/assignments/${sup.id}`,
        { rowVersion: sup.rowVersion },
        cookies.roleadmin,
      );
      assert.equal(r.statusCode, 409);
      assert.match(r.json().message, /超级管理员/);
    });

    await t.test('reports explain where a permission comes from', async () => {
      const view = (
        await req('GET', `/api/admin/users/${ids.dev}/access`, undefined, cookies.admin)
      ).json();
      const edit = view.projects[0].permissions.find((x) => x.code === 'delivery.item:edit');
      assert.equal(edit.sources[0].roleCode, 'C_DEV');
      assert.deepEqual(edit.sources[0].modules, ['MM']);
      const holders = (
        await req(
          'GET',
          '/api/admin/permissions/project.commercial:view/holders',
          undefined,
          cookies.admin,
        )
      ).json();
      assert.ok(holders.some((h) => h.userId === ids.pm && h.viaCode === 'C_PM'));
      const detail = (
        await req('GET', '/api/admin/roles/' + custom.id, undefined, cookies.roleadmin)
      ).json();
      assert.deepEqual(detail.holders, []);
      assert.equal(
        (
          await req(
            'DELETE',
            '/api/admin/roles/' + custom.id,
            { rowVersion: custom.rowVersion },
            cookies.admin,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await req(
            'DELETE',
            '/api/admin/roles/' + role('C_DEV').id,
            { rowVersion: role('C_DEV').rowVersion },
            cookies.admin,
          )
        ).statusCode,
        409,
      );
    });

    await t.test('positions carry default roles', async () => {
      const positions = (await req('GET', '/api/admin/positions', undefined, cookies.admin)).json();
      assert.equal(positions.length, 10);
      const r = await req(
        'POST',
        '/api/admin/positions',
        { code: 'SAP_TRAINER', name: '培训顾问', roleIds: [role('C_OBSERVER').id] },
        cookies.admin,
      );
      assert.equal(r.statusCode, 201);
      assert.deepEqual(
        r.json().roles.map((x) => x.code),
        ['C_OBSERVER'],
      );
      const candidates = (
        await req('GET', `/api/projects/${project}/member-candidates`, undefined, cookies.pm)
      ).json();
      assert.ok(candidates.some((c) => c.id === ids.director));
      assert.ok(!candidates.some((c) => c.id === ids.dev));
    });
    const actions = (
      await db.query(
        "SELECT DISTINCT action FROM app.audit_event WHERE organization_id=$1 AND action LIKE 'access.%'",
        [org],
      )
    ).rows.map((r) => r.action);
    for (const action of [
      'access.role.create',
      'access.project_member.add',
      'access.assignment.create',
    ])
      assert.ok(actions.includes(action), action);
  } finally {
    await app?.close();
    await db.query('DELETE FROM app.abap_dev_agent_session WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.development_event WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.development_item_phase WHERE organization_id=$1', [org]);
    await db.query('DELETE FROM app.development_item WHERE organization_id=$1', [org]);
    await dropOrganizations(db, [org], Object.values(ids));
    for (const n of [testIp, ...names.map(login)])
      await db.query('DELETE FROM app.login_throttle WHERE key_hash=$1', [digest(n)]);
    await db.end();
  }
});
