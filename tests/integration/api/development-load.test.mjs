import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { addDays, matchesFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import { loadWindow, mondayOf } from '@sap-delivery-workbench/contracts/delivery/load';
import { grantRole, dropOrganizations } from '../../fixtures/access.mjs';

const localToday = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
};

// docs/specs/development-load.md: permission and project scope, who gets a row and in which
// order, what counts, the member sort code, and every number equal to its drill-down list.
test('development load: permissions, rows, counts and sort code', async () => {
  const db = await connectDatabase();
  const org = randomUUID(),
    customer = randomUUID(),
    project = randomUUID(),
    hidden = randomUUID();
  const people = { pm: randomUUID(), dev: randomUUID(), idle: randomUUID(), tester: randomUUID() };
  const tokens = Object.fromEntries(
    Object.keys(people).map((k) => [k, randomBytes(32).toString('hex')]),
  );
  const today = localToday();
  const monday = mondayOf(today);
  let app;
  try {
    await db.query('INSERT INTO app.organization(id,code,name) VALUES($1,$2,$3)', [
      org,
      'L' + org.slice(0, 8).toUpperCase(),
      'Load test',
    ]);
    for (const [key, id] of Object.entries(people)) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        'ld-' + id,
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
    for (const id of [project, hidden])
      await db.query(
        'INSERT INTO app.project(id,organization_id,customer_id,code,name,planned_start_date,planned_end_date) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, org, customer, id.slice(0, 8).toUpperCase(), '排期项目', '2026-03-01', '2026-12-31'],
      );
    await grantRole(db, org, people.pm, 'C_PM', { projectId: project });
    await grantRole(db, org, people.dev, 'C_DEV', { projectId: project });
    await grantRole(db, org, people.idle, 'C_DEV', { projectId: project });
    await grantRole(db, org, people.tester, 'C_TESTER', { projectId: project });

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
            cookie: 'sapwb_local_session=' + tokens[who],
          },
        });
        assert.equal(r.statusCode, status, r.body);
        return r.json();
      };
    const pm = as('pm');
    const list = '/api/projects/' + project + '/development-items';
    const load = '/api/projects/' + project + '/development-load';
    const members = '/api/projects/' + project + '/members/';
    const create = async (body, changes) => {
      const item = await pm('POST', list, body, 201);
      return pm('PATCH', list + '/' + item.id, { rowVersion: item.rowVersion, changes });
    };

    // A: this week, 3 days. B: last week, finished on time. C: nobody, no date. D: cancelled.
    // E: the project manager's, two weeks out (an assignee without a developer role).
    await create(
      { name: 'A', module: 'MM', kind: 'report' },
      {
        'development.assigneeId': people.dev,
        'development.effortDays': 3,
        'development.plannedEnd': addDays(monday, 2),
      },
    );
    await create(
      { name: 'B', module: 'MM', kind: 'report' },
      {
        'development.assigneeId': people.dev,
        'development.effortDays': 2,
        'development.plannedEnd': addDays(monday, -5),
        'development.status': 'completed',
        'development.actualEnd': addDays(monday, -5),
        'consultant_test.status': 'completed',
        'consultant_test.actualEnd': addDays(monday, -4),
      },
    );
    await create({ name: 'C', module: 'SD', kind: 'report' }, { 'development.effortDays': 1 });
    await create(
      { name: 'D', module: 'SD', kind: 'report' },
      { 'development.assigneeId': people.dev, 'development.status': 'cancelled' },
    );
    await create(
      { name: 'E', module: 'SD', kind: 'report' },
      { 'development.assigneeId': people.pm, 'development.plannedEnd': addDays(monday, 15) },
    );

    // Access: sign-in, project scope, permission.
    assert.equal((await app.inject({ method: 'GET', url: load })).statusCode, 401);
    await pm('GET', '/api/projects/' + hidden + '/development-load', undefined, 404);
    const denied = await as('tester')('GET', load, undefined, 403);
    assert.equal(denied.details.permission, 'delivery.load:view');

    // Sort code: managers only, their own included; 0–9999 or empty.
    await as('dev')('PUT', members + people.idle + '/sort-code', { sortCode: 1 }, 403);
    await pm('PUT', members + people.idle + '/sort-code', { sortCode: 10000 }, 400);
    await pm('PUT', members + people.idle + '/sort-code', { sortCode: 1.5 }, 400);
    await pm('PUT', members + randomUUID() + '/sort-code', { sortCode: 1 }, 404);
    await pm('PUT', members + people.pm + '/sort-code', { sortCode: 5 }, 200);
    const saved = await pm('PUT', members + people.idle + '/sort-code', { sortCode: 1 }, 200);
    assert.equal(saved.find((m) => m.id === people.idle).sortCode, 1);

    // A developer sees every row, not only their own.
    const data = await as('dev')('GET', load);
    assert.equal(data.today, today);
    assert.equal(data.options[0], '2026-02-23');
    assert.equal(data.options.at(-1), '2027-01-25');
    assert.deepEqual(data.totals, { items: 4, developed: 1, tested: 1 });
    // Sort code first (idle 1, pm 5), then the developer without one; the idle developer has
    // a row although nothing is assigned, the project manager because something is.
    assert.deepEqual(
      data.people.map((p) => p.id),
      [people.idle, people.pm, people.dev],
    );
    const row = (id) => data.rows.find((r) => r.id === id);
    assert.equal(row(people.idle), undefined);
    assert.deepEqual(
      { items: row(people.dev).items, done: row(people.dev).done, effort: row(people.dev).effort },
      { items: 2, done: 1, effort: 5 },
    );
    assert.equal(row(null).unplanned, 1);
    const cols = loadWindow(row(people.dev), monday);
    assert.deepEqual(
      cols.weeks.slice(0, 2).map((w) => [w.monday, w.effort, w.planned, w.actual, w.diff]),
      [
        [addDays(monday, -7), 2, 1, 1, 0],
        [monday, 3, 1, 0, -1],
      ],
    );
    assert.equal(cols.total.diff, -1);
    assert.equal(loadWindow(row(people.pm), monday, 1).after.planned, 1);

    // Every number equals the length of the list it opens (the same test as the list).
    const { items } = await pm('GET', list);
    const count = (filter) =>
      items.filter((i) => matchesFilter(i, { phase: 'development', ...filter })).length;
    const range = (m) => `${m}~${addDays(m, 6)}`;
    for (const r of data.rows) {
      const who = r.id ? { assignee: r.id } : { unassigned: true };
      const c = loadWindow(r, monday);
      assert.equal(count({ ...who, active: true }), c.total.planned);
      assert.equal(count({ ...who, status: 'completed' }), c.total.actual);
      assert.equal(count({ ...who, unplanned: true }), r.unplanned);
      const before = '~' + addDays(c.weeks[0].monday, -1);
      assert.equal(count({ ...who, planned: before }), c.before.planned);
      assert.equal(count({ ...who, actual: before }), c.before.actual);
      for (const w of c.weeks) {
        assert.equal(count({ ...who, planned: range(w.monday) }), w.planned);
        assert.equal(count({ ...who, actual: range(w.monday) }), w.actual);
      }
      // One week ahead puts E (two weeks after the base) into “以后”.
      for (const ahead of [1, 3]) {
        const { after } = loadWindow(r, monday, ahead);
        assert.equal(count({ ...who, planned: after.from + '~' }), after.planned);
        assert.equal(count({ ...who, actual: after.from + '~' }), after.actual);
      }
    }
  } finally {
    if (app) await app.close();
    for (const table of [
      'development_event',
      'development_item_object',
      'development_item_phase',
      'development_item',
    ])
      await db.query('DELETE FROM app.' + table + ' WHERE organization_id=$1', [org]);
    await dropOrganizations(db, [org], Object.values(people));
    await db.end();
  }
});
