import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { dropOrganizations, grantRole } from '../../fixtures/access.mjs';

test('list views: owner only, one default, permissions, archived projects, audit', async () => {
  const db = await connectDatabase();
  const org = randomUUID(),
    customer = randomUUID(),
    project = randomUUID(),
    other = randomUUID();
  const people = { me: randomUUID(), peer: randomUUID(), reader: randomUUID() };
  const tokens = Object.fromEntries(
    Object.keys(people).map((k) => [k, randomBytes(32).toString('hex')]),
  );
  let app;
  try {
    await db.query('INSERT INTO app.organization(id,code,name) VALUES($1,$2,$3)', [
      org,
      'O' + org.slice(0, 8).toUpperCase(),
      'List view test',
    ]);
    for (const [key, id] of Object.entries(people)) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        'lv-' + id,
        '成员' + key,
      ]);
      await db.query(
        "INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,'unused-test-hash',false)",
        [id],
      );
      await db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
        org,
        id,
      ]);
      await db.query(
        "INSERT INTO app.auth_session(organization_id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours')",
        [org, id, digest(tokens[key])],
      );
    }
    await db.query(
      "INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$2,'C','客户')",
      [customer, org],
    );
    for (const id of [project, other])
      await db.query(
        'INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$2,$3,$4,$5)',
        [id, org, customer, id.slice(0, 8).toUpperCase(), '视图项目'],
      );
    await grantRole(db, org, people.me, 'PRJ_VIEW', { projectId: project });
    await grantRole(db, org, people.peer, 'PRJ_VIEW', { projectId: project });
    // A member who reads the list but may not save views.
    const readOnly = (
      await db.query(
        "INSERT INTO app.access_role(organization_id,code,name,kind,scope) VALUES($1,'T_LIST_READ','只读清单','single','project') RETURNING id",
        [org],
      )
    ).rows[0].id;
    for (const permission of ['project:view', 'delivery.item:view'])
      await db.query(
        'INSERT INTO app.access_role_permission(organization_id,role_id,permission) VALUES($1,$2,$3)',
        [org, readOnly, permission],
      );
    await db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [org, project, people.reader],
    );
    await db.query(
      'INSERT INTO app.access_project_role(organization_id,project_id,user_id,role_id) VALUES($1,$2,$3,$4)',
      [org, project, people.reader, readOnly],
    );

    app = await createApp({ organizationId: org });
    const as =
      (who) =>
      async (method, url, payload, status = 200) => {
        const r = await app.inject({
          method,
          url,
          payload,
          headers: {
            origin: 'http://127.0.0.1:5173',
            cookie: `sapwb_local_session=${tokens[who]}`,
          },
        });
        assert.equal(r.statusCode, status, `${method} ${url}: ${r.body}`);
        return r.json();
      };
    const me = as('me'),
      peer = as('peer'),
      reader = as('reader');
    const url = `/api/projects/${project}/list-views/delivery.items`;
    const state = {
      filterFields: ['module'],
      conditions: { module: [{ sign: 'I', option: 'EQ', low: 'SD' }] },
      sortField: 'code',
      sortOrder: 'asc',
    };

    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
    assert.deepEqual(await me('GET', url), { views: [], canSave: true });
    assert.equal((await reader('GET', url)).canSave, false);

    // Unknown lists and projects outside the person's own answer 404, without the permission 403.
    await me('GET', `/api/projects/${project}/list-views/nothing`, undefined, 404);
    await me('GET', `/api/projects/${other}/list-views/delivery.items`, undefined, 404);
    await me('POST', `/api/projects/${other}/list-views/delivery.items`, { name: 'x' }, 404);
    await reader('POST', url, { name: '我的', state }, 403);

    const first = await me('POST', url, { name: ' 本月开发 ', isDefault: true, state });
    assert.equal(first.name, '本月开发');
    assert.equal(first.isDefault, true);
    assert.equal(first.autoApply, true);
    assert.deepEqual(first.state.filterFields, ['module']);
    assert.equal(first.state.columns, null);

    await me('POST', url, { name: '本月开发', state }, 409);
    await me('POST', url, { name: '', state }, 400);
    await me('POST', url, { name: '标准', state }, 400);
    await me('POST', url, { name: 'x'.repeat(61), state }, 400);

    // A second default replaces the first.
    const second = await me('POST', url, { name: '待测试', isDefault: true, autoApply: false });
    assert.equal(second.autoApply, false);
    let list = (await me('GET', url)).views;
    assert.deepEqual(
      list.filter((v) => v.isDefault).map((v) => v.id),
      [second.id],
    );
    await me('PATCH', `${url}/${first.id}`, { isDefault: true });
    list = (await me('GET', url)).views;
    assert.deepEqual(
      list.filter((v) => v.isDefault).map((v) => v.id),
      [first.id],
    );

    // Another person neither sees nor touches a view; they may use the same name.
    assert.deepEqual((await peer('GET', url)).views, []);
    await peer('PATCH', `${url}/${first.id}`, { name: '抢走' }, 404);
    await peer('DELETE', `${url}/${first.id}`, {}, 404);
    await peer('POST', url, { name: '本月开发', state });

    const renamed = await me('PATCH', `${url}/${first.id}`, {
      name: '十一月开发',
      autoApply: false,
      state: { ...state, search: '接口', injected: 1 },
    });
    assert.equal(renamed.name, '十一月开发');
    assert.equal(renamed.autoApply, false);
    assert.equal(renamed.isDefault, true);
    assert.equal(renamed.state.search, '接口');
    assert.equal(renamed.state.injected, undefined);
    await me('PATCH', `${url}/${first.id}`, { name: '待测试' }, 409);
    await me('PATCH', `${url}/not-a-uuid`, { name: 'x' }, 404);

    await me('DELETE', `${url}/${second.id}`, {});
    assert.equal((await me('GET', url)).views.length, 1);
    const { rows: audit } = await db.query(
      "SELECT action FROM app.audit_event WHERE organization_id=$1 AND actor_user_id=$2 AND subject_type='list_view'",
      [org, people.me],
    );
    for (const action of ['list_view.create', 'list_view.update', 'list_view.delete'])
      assert.ok(
        audit.some((r) => r.action === action),
        action,
      );

    // An archived project keeps its views readable and takes no more writes.
    await db.query("UPDATE app.project SET status='archived',archived_at=now() WHERE id=$1", [
      project,
    ]);
    const archived = await me('GET', url);
    assert.equal(archived.views.length, 1);
    assert.equal(archived.canSave, false);
    await me('POST', url, { name: '归档后', state }, 409);
    await me('DELETE', `${url}/${first.id}`, {}, 409);
  } finally {
    if (app) await app.close();
    await dropOrganizations(db, [org], Object.values(people));
    await db.end();
  }
});
