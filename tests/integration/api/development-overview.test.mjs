import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';
import { digest } from '../../../apps/api/src/platform/auth.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';
import { addDays, matchesFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import { setLabels } from '../../../apps/api/src/modules/abap-fsd-agent/repository.mjs';
import { grantRole, dropOrganizations } from '../../fixtures/access.mjs';

const localToday = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
};

test('development overview: permissions, scope, judgments and drill-down counts', async () => {
  const db = await connectDatabase();
  const org = randomUUID(),
    customer = randomUUID(),
    project = randomUUID(),
    hidden = randomUUID();
  const people = { pm: randomUUID(), dev: randomUUID(), sub: randomUUID(), viewer: randomUUID() };
  const tokens = Object.fromEntries(
    Object.keys(people).map((k) => [k, randomBytes(32).toString('hex')]),
  );
  const today = localToday();
  let app;
  try {
    await db.query('INSERT INTO app.organization(id,code,name) VALUES($1,$2,$3)', [
      org,
      'O' + org.slice(0, 8).toUpperCase(),
      'Overview test',
    ]);
    for (const [key, id] of Object.entries(people)) {
      await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$3)', [
        id,
        'ov-' + id,
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
        'INSERT INTO app.project(id,organization_id,customer_id,code,name,dev_budget_days) VALUES($1,$2,$3,$4,$5,20)',
        [id, org, customer, id.slice(0, 8).toUpperCase(), '概览项目'],
      );
    await db.query(
      "INSERT INTO app.project_milestone(organization_id,project_id,milestone_key,name,planned_on) VALUES($1,$2,'code_freeze','开发冻结',$3)",
      [org, project, addDays(today, 5)],
    );
    await grantRole(db, org, people.pm, 'C_PM', { projectId: project });
    await grantRole(db, org, people.dev, 'C_DEV', { projectId: project });
    await grantRole(db, org, people.sub, 'C_SUBCON_DEV', { projectId: project, ownOnly: true });
    // A member who may enter the project but not see the overview.
    const viewOnly = (
      await db.query(
        "INSERT INTO app.access_role(organization_id,code,name,kind,scope) VALUES($1,'T_PROJECT_ONLY','只看项目','single','project') RETURNING id",
        [org],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO app.access_role_permission(organization_id,role_id,permission) VALUES($1,$2,'project:view')",
      [org, viewOnly],
    );
    await db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [org, project, people.viewer],
    );
    await db.query(
      'INSERT INTO app.access_project_role(organization_id,project_id,user_id,role_id) VALUES($1,$2,$3,$4)',
      [org, project, people.viewer, viewOnly],
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
            cookie: 'sapwb_local_session=' + tokens[who],
          },
        });
        assert.equal(r.statusCode, status, r.body);
        return r.json();
      };
    const pm = as('pm');
    const list = '/api/projects/' + project + '/development-items';
    const overview = '/api/projects/' + project + '/development-overview';
    const create = (body) => pm('POST', list, body, 201);
    const change = async (item, changes) =>
      pm('PATCH', list + '/' + item.id, { rowVersion: item.rowVersion, changes });

    // A: FSD declared late; development planned after the code freeze; FSD final, not started.
    let a = await create({ name: 'A', module: 'MM', kind: 'report', 'fsd.assigneeId': people.dev });
    a = await change(a, {
      'fsd.status': 'delayed',
      'development.plannedStart': today,
      'development.plannedEnd': addDays(today, 10),
      objects: [{ pgmid: 'R3TR', objectType: 'PROG', objectName: 'ZSHARED' }],
    });
    // B: the subcontractor's development is past its planned end, without a final FSD.
    let b = await create({ name: 'B', module: 'SD', kind: 'interface' });
    b = await change(b, {
      'development.assigneeId': people.sub,
      'development.effortDays': 4,
      'development.plannedStart': addDays(today, -3),
      'development.plannedEnd': addDays(today, -1),
      'development.status': 'in_progress',
      objects: [{ pgmid: 'R3TR', objectType: 'PROG', objectName: 'ZSHARED' }],
    });
    // C: developed, waiting for the consultant test; its FSD plan was pushed back.
    let c = await create({ name: 'C', module: 'MM', kind: 'enhancement' });
    c = await change(c, {
      'development.status': 'completed',
      'development.actualEnd': addDays(today, -2),
      'development.effortDays': 3,
      'fsd.plannedStart': today,
      'fsd.plannedEnd': addDays(today, 3),
    });
    c = await change(c, { 'fsd.plannedEnd': addDays(today, 8) });
    // D: every phase cancelled, out of scope.
    let d = await create({ name: 'D', module: 'PP', kind: 'function' });
    d = await change(d, {
      'fsd.status': 'cancelled',
      'development.status': 'cancelled',
      'consultant_test.status': 'cancelled',
      'user_test.status': 'cancelled',
    });
    const session = randomUUID();
    await db.query(
      'INSERT INTO app.abap_fsd_agent_session(id,organization_id,project_id,item_id,created_by) VALUES($1,$2,$3,$4,$5)',
      [session, org, project, a.id, people.pm],
    );
    await db.query(
      "INSERT INTO app.abap_fsd_agent_document(id,session_id,version,markdown,labels,created_by) VALUES($1,$2,1,'# FSD','{定稿}',$3)",
      [randomUUID(), session, people.pm],
    );
    // A's FSD changed after it was finalized, and has an open comment.
    await db.query(
      "INSERT INTO app.abap_fsd_agent_document(id,session_id,version,markdown,created_by,created_at) VALUES($1,$2,2,'# FSD v2',$3,now()+interval '1 second')",
      [randomUUID(), session, people.pm],
    );
    await db.query(
      "INSERT INTO app.abap_fsd_agent_comment(id,session_id,anchor_text,anchor_version,body,created_by) VALUES($1,$2,'范围',1,'请补充',$3)",
      [randomUUID(), session, people.pm],
    );

    // Recorded automatically (spec section 6): the status history and the actual start.
    assert.equal(b.phases.development.actualStart, today);
    const { rows: moves } = await db.query(
      "SELECT from_status,to_status FROM app.development_phase_transition WHERE item_id=$1 AND phase='development' ORDER BY id",
      [b.id],
    );
    assert.deepEqual(
      moves.map((m) => [m.from_status, m.to_status]),
      [
        [null, 'not_started'],
        ['not_started', 'in_progress'],
      ],
    );

    // Access: sign-in, project scope, permission.
    assert.equal((await app.inject({ method: 'GET', url: overview })).statusCode, 401);
    await pm('GET', '/api/projects/' + hidden + '/development-overview', undefined, 404);
    const denied = await as('viewer')('GET', overview, undefined, 403);
    assert.equal(denied.details.permission, 'delivery.overview:view');

    // Project manager: everything, budget and named load.
    const o = await pm('GET', overview);
    assert.equal(o.view, 'project');
    assert.equal(o.team, true);
    assert.deepEqual(o.scope, {});
    assert.deepEqual(o.counts, { items: 3, removed: 1, developmentDone: 1, deliveryDone: 0 });
    assert.equal(o.cards.risk.count, 2);
    assert.equal(o.cards.risk.declared, 1);
    assert.equal(o.cards.risk.stale, 1);
    assert.equal(o.cards.freeze.date, addDays(today, 5));
    assert.equal(o.cards.freeze.count, 1);
    assert.equal(o.cards.freeze.risk, 1);
    assert.deepEqual(
      o.development.handover.map((x) => x.name),
      ['A'],
    );
    assert.deepEqual(
      o.development.reverse.map((x) => x.name),
      ['B'],
    );
    assert.equal(o.development.conflicts.length, 1);
    assert.equal(o.development.conflicts[0].items.length, 2);
    assert.deepEqual(
      o.development.awaitingTest.map((x) => [x.name, x.waitDays]),
      [['C', 2]],
    );
    assert.deepEqual(o.development.fsdFinal, {
      total: 3,
      final: 1,
      byModule: { MM: { total: 2, final: 1 }, SD: { total: 1, final: 0 } },
    });
    assert.deepEqual(o.budget, { budgetDays: 20, plannedDays: 7, doneDays: 3 });
    const reasons = Object.fromEntries(
      o.attention.map((x) => [x.name, x.reasons.map((r) => r.type)]),
    );
    assert.deepEqual(reasons.A, ['risk']);
    assert.deepEqual(reasons.B, ['risk']);
    assert.deepEqual(reasons.C, ['drift']);
    assert.ok(o.load.rows.some((r) => r.userId === people.sub && r.name === '成员sub'));

    // Phase 2: handover radar, age, coverage, rework, comments, FSD backlog, readiness.
    const [handover] = o.development.handover;
    assert.equal(handover.estimated, true);
    assert.deepEqual(
      handover.objects.map((x) => x.shared.map((s) => s.name)),
      [['B']],
    );
    assert.deepEqual(o.people.map((m) => m.name).sort(), [
      '成员dev',
      '成员pm',
      '成员sub',
      '成员viewer',
    ]);
    assert.deepEqual(
      o.development.aging.development.points.map((x) => [x.name, x.days, x.estimated]),
      [['B', 0, false]],
    );
    assert.deepEqual(
      {
        ...o.development.coverage,
        missing: o.development.coverage.missing.map((x) => x.name).sort(),
      },
      { started: 2, session: 0, final: 0, sap: 0, missing: ['B', 'C'] },
    );
    assert.deepEqual(
      o.development.rework.map((x) => [x.name, x.laterVersions, x.retest]),
      [['A', 1, false]],
    );
    assert.equal(o.development.comments.open, 1);
    assert.deepEqual(o.fsdBacklog, {
      overdue: [a.id],
      week: [],
      later: [c.id],
      unplanned: [b.id],
    });
    assert.deepEqual(
      { total: o.readiness.all.total, ready: o.readiness.all.ready },
      { total: 3, ready: 0 },
    );

    // Labelling a version 定稿 now records when, so the date is no longer an estimate.
    await setLabels(db, session, 1, ['定稿'], people.pm);
    assert.equal((await pm('GET', overview)).development.handover[0].estimated, false);

    // Each card's drill-down filter selects exactly as many list items as the card counts.
    const { items } = await pm('GET', list);
    const ctx = { today, milestones: { code_freeze: addDays(today, 5) } };
    for (const key of ['risk', 'dueSoon', 'freeze', 'gaps']) {
      const card = o.cards[key];
      const filter = { ...card.filter, ...o.scope };
      const shown = items.filter((i) => matchesFilter(i, filter, ctx));
      // Out-of-scope items never count; the list still shows them.
      const live = shown.filter((i) => i.id !== d.id);
      assert.equal(live.length, card.count, key);
    }
    const freezeRisk = items.filter((i) => matchesFilter(i, o.cards.freeze.riskFilter, ctx));
    assert.equal(freezeRisk.length, o.cards.freeze.risk);

    // Developer: no budget, no other names.
    const mine = await as('dev')('GET', overview);
    assert.equal(mine.view, 'mine');
    assert.equal(mine.team, false);
    assert.equal(mine.budget, undefined);
    assert.ok(mine.load.rows.every((r) => r.userId === people.dev || r.name === '其他成员'));
    assert.ok(
      mine.attention
        .flatMap((x) => x.reasons)
        .every((r) => !r.assignee || r.assignee === '成员dev'),
    );
    assert.deepEqual(mine.people, []);
    // The FSD owner sees the risk and the open comment as their own to-dos.
    assert.deepEqual(mine.consultant, { fsdRisk: [a.id], comments: [a.id], awaiting: [] });
    assert.deepEqual(
      mine.mine.respond.map((r) => [r.name, r.type, r.source]),
      [['A', 'comment', 'fsd']],
    );
    assert.deepEqual(
      mine.mine.today.map((t) => [t.name, t.phase]),
      [['A', 'fsd']],
    );

    // Subcontractor limited to own items: only B, and the drill-down scope says so.
    const own = await as('sub')('GET', overview);
    assert.deepEqual(own.scope, { owner: people.sub });
    assert.equal(own.counts.items, 1);
    assert.equal(own.cards.risk.count, 1);
    assert.deepEqual(
      own.mine.today.map((t) => [t.name, t.phase, t.risk, t.stage]),
      [['B', 'development', 'stale', 'development']],
    );
    assert.deepEqual(
      items.filter((i) => matchesFilter(i, { ...own.cards.risk.filter, ...own.scope }, ctx)).length,
      1,
    );
  } finally {
    if (app) await app.close();
    await db.query(
      'DELETE FROM app.abap_fsd_agent_document WHERE session_id IN (SELECT id FROM app.abap_fsd_agent_session WHERE organization_id=$1)',
      [org],
    );
    await db.query(
      'DELETE FROM app.abap_fsd_agent_comment WHERE session_id IN (SELECT id FROM app.abap_fsd_agent_session WHERE organization_id=$1)',
      [org],
    );
    await db.query('DELETE FROM app.abap_fsd_agent_session WHERE organization_id=$1', [org]);
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
