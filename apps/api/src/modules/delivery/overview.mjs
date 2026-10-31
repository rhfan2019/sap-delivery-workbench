import { PHASE_KEYS } from '@sap-delivery-workbench/contracts/delivery/fields';
import {
  PHASE_GATES,
  addDays,
  atRisk,
  awaitingTest,
  daysBetween,
  deliveryDone,
  developmentDone,
  dueSoon,
  handoverReady,
  isOpen,
  pastGate,
  phaseRisk,
  planGaps,
  reverseHandover,
  scopeRemoved,
} from '@sap-delivery-workbench/contracts/delivery/overview';
import { dateText, loadItems, members } from './store.mjs';

// Development overview, phase 1 (docs/specs/development-overview.md, plan 2026-10-30): the
// project and development-team views. Numbers are computed here with the shared judgments the
// list uses, so each number and its drill-down list agree.
const IDLE_DAYS = 7;
const DRIFT_DAYS = 7;
const LOAD_WEEKS = 6;
const LIST_LIMIT = 30;
// The default view by the user's built-in roles (spec section 11); it only orders the page.
const VIEW_ROLES = [
  ['C_PM', 'project'],
  ['C_DELIVERY_DIRECTOR', 'project'],
  ['C_PMO', 'project'],
  ['C_DEV_LEAD', 'team'],
  ['C_FUNC', 'consultant'],
  ['C_TESTER', 'tester'],
];

const owners = (item) => [
  item.createdBy,
  ...PHASE_KEYS.map((k) => item.phases[k].assigneeId).filter(Boolean),
];
const brief = (item) => ({ id: item.id, code: item.code, name: item.name, module: item.module });
const monday = (date) => addDays(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7));

// The list filter matching what the grant lets this user see, when it can be said as one
// filter: own items only, or a set of modules. Grants without limits need none.
function visibleScope(grant, userId) {
  const sources = grant.sources().find((s) => s.code === 'delivery.overview:view')?.sources ?? [];
  if (!sources.length || sources.some((s) => !s.ownOnly && !s.modules.length)) return {};
  const scope = {};
  if (sources.every((s) => s.ownOnly)) scope.owner = userId;
  if (sources.every((s) => s.modules.length))
    scope.modules = [...new Set(sources.flatMap((s) => s.modules))];
  return scope;
}

async function facts(db, org, projectId) {
  const [milestones, budget, finals, activity, drift] = await Promise.all([
    db.query(
      `SELECT milestone_key AS key,name,planned_on::text AS "plannedOn",achieved_on::text AS "achievedOn"
       FROM app.project_milestone WHERE organization_id=$1 AND project_id=$2 AND milestone_key IS NOT NULL
       ORDER BY planned_on NULLS LAST,sort`,
      [org, projectId],
    ),
    db.query(
      'SELECT dev_budget_days::float8 AS "budgetDays" FROM app.project WHERE organization_id=$1 AND id=$2',
      [org, projectId],
    ),
    // The first FSD version labelled final per item; its creation time stands in for the
    // finalization time until that is recorded (spec section 6, D3).
    db.query(
      `SELECT s.item_id AS "itemId",min(d.created_at) AS "finalAt"
       FROM app.abap_fsd_agent_session s JOIN app.abap_fsd_agent_document d ON d.session_id=s.id
       WHERE s.organization_id=$1 AND s.project_id=$2 AND '定稿'=ANY(d.labels) GROUP BY s.item_id`,
      [org, projectId],
    ),
    // The last thing that happened to an item: its own change, or a turn of either assistant.
    db.query(
      `SELECT item_id AS "itemId",max(at) AS at FROM (
         SELECT item_id,created_at AS at FROM app.development_event WHERE organization_id=$1 AND project_id=$2
         UNION ALL SELECT s.item_id,t.started_at FROM app.abap_fsd_agent_session s
           JOIN app.abap_fsd_agent_turn t ON t.session_id=s.id WHERE s.organization_id=$1 AND s.project_id=$2
         UNION ALL SELECT s.item_id,t.started_at FROM app.abap_dev_agent_session s
           JOIN app.abap_dev_agent_turn t ON t.session_id=s.id WHERE s.organization_id=$1 AND s.project_id=$2
       ) a GROUP BY item_id`,
      [org, projectId],
    ),
    // Planned ends pushed later in the recent days (M09), from the change history.
    db.query(
      `SELECT e.item_id AS "itemId",k.phase,(e.changes->(k.phase||'.plannedEnd')->>'before') AS before,
              (e.changes->(k.phase||'.plannedEnd')->>'after') AS after
       FROM app.development_event e CROSS JOIN unnest($3::text[]) AS k(phase)
       WHERE e.organization_id=$1 AND e.project_id=$2 AND e.created_at>=now()-make_interval(days=>$4)
         AND (e.changes->(k.phase||'.plannedEnd')->>'before') IS NOT NULL
         AND (e.changes->(k.phase||'.plannedEnd')->>'after')>(e.changes->(k.phase||'.plannedEnd')->>'before')
       ORDER BY e.created_at`,
      [org, projectId, PHASE_KEYS, DRIFT_DAYS],
    ),
  ]);
  return {
    milestones: milestones.rows,
    budgetDays: budget.rows[0]?.budgetDays ?? null,
    finals: new Map(finals.rows.map((r) => [r.itemId, r.finalAt])),
    activity: new Map(activity.rows.map((r) => [r.itemId, r.at])),
    drift: drift.rows,
  };
}

// Planned effort of open phases spread evenly over their planned days, per person and week.
function loadOf(items, today, people, { team, userId }) {
  const start = monday(today);
  const weeks = Array.from({ length: LOAD_WEEKS }, (_, i) => addDays(start, i * 7));
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { userId: id, open: 0, days: weeks.map(() => 0) });
    return rows.get(id);
  };
  for (const item of items)
    for (const key of PHASE_KEYS) {
      const p = item.phases[key];
      if (!p.assigneeId || !isOpen(p)) continue;
      const r = row(p.assigneeId);
      r.open += 1;
      if (p.effortDays == null || !p.plannedStart || !p.plannedEnd) continue;
      const span = daysBetween(p.plannedStart, p.plannedEnd) + 1;
      weeks.forEach((w, i) => {
        const from = p.plannedStart > w ? p.plannedStart : w;
        const weekEnd = addDays(w, 6);
        const to = p.plannedEnd < weekEnd ? p.plannedEnd : weekEnd;
        if (to >= from) r.days[i] += (p.effortDays * (daysBetween(from, to) + 1)) / span;
      });
    }
  const names = new Map(people.map((m) => [m.id, m.displayName]));
  let list = [...rows.values()].map((r) => ({
    ...r,
    name: names.get(r.userId) ?? '',
    days: r.days.map((d) => Math.round(d * 10) / 10),
  }));
  // Without the team permission, other people are merged into one row (spec section 7).
  if (!team) {
    const others = list.filter((r) => r.userId !== userId);
    list = list.filter((r) => r.userId === userId);
    if (others.length)
      list.push({
        userId: null,
        name: '其他成员',
        open: others.reduce((n, r) => n + r.open, 0),
        days: weeks.map((_, i) => Math.round(others.reduce((n, r) => n + r.days[i], 0) * 10) / 10),
      });
  }
  return {
    weeks,
    rows: list.sort((a, b) => (a.userId === null) - (b.userId === null) || b.open - a.open),
  };
}

export function buildOverview({ items, people, facts: f, today, grant, userId }) {
  const team = grant.has('delivery.overview.team:view');
  const commercial = grant.has('project.commercial:view');
  const milestoneDates = Object.fromEntries(
    f.milestones.map((m) => [m.key, m.achievedOn ?? m.plannedOn]).filter(([, d]) => d),
  );
  const ctx = { today, milestones: milestoneDates };
  const visible = items.filter((i) =>
    grant.has('delivery.overview:view', { module: i.module, owners: owners(i) }),
  );
  const live = visible.filter((i) => !scopeRemoved(i));
  const count = (test) => live.filter(test).length;
  const name = (id) =>
    team || id === userId ? (people.find((m) => m.id === id)?.displayName ?? '') : null;

  const riskBy = (source) =>
    count((i) => PHASE_KEYS.some((k) => phaseRisk(i.phases[k], today) === source));
  const gaps = { assignee: 0, dates: 0, effort: 0 };
  for (const i of live) for (const g of new Set(planGaps(i).map((x) => x.gap))) gaps[g] += 1;
  const matrix = Object.fromEntries(
    PHASE_KEYS.map((k) => [
      k,
      live.reduce((m, i) => ((m[i.phases[k].status] = (m[i.phases[k].status] ?? 0) + 1), m), {}),
    ]),
  );
  const modules = [...new Set(live.map((i) => i.module))].sort();
  const freezeDate = milestoneDates.code_freeze ?? null;

  // This week's attention list: risks, idle work and pushed plans, one row per item.
  const attention = new Map();
  const flag = (item, reason) => {
    if (!attention.has(item.id)) attention.set(item.id, { ...brief(item), reasons: [] });
    attention.get(item.id).reasons.push(reason);
  };
  for (const i of live) {
    for (const k of PHASE_KEYS) {
      const source = phaseRisk(i.phases[k], today);
      if (source)
        flag(i, {
          type: 'risk',
          phase: k,
          source,
          days: i.phases[k].plannedEnd ? daysBetween(i.phases[k].plannedEnd, today) : null,
          assignee: name(i.phases[k].assigneeId),
        });
    }
    const working = PHASE_KEYS.some((k) => ['in_progress', 'delayed'].includes(i.phases[k].status));
    const last = [f.activity.get(i.id), i.updatedAt].filter(Boolean).map((d) => new Date(d));
    const lastDay = last.length ? dateText(new Date(Math.max(...last))) : null;
    if (working && lastDay && daysBetween(lastDay, today) > IDLE_DAYS)
      flag(i, { type: 'idle', days: daysBetween(lastDay, today) });
  }
  const byId = new Map(live.map((i) => [i.id, i]));
  for (const d of f.drift) {
    const i = byId.get(d.itemId);
    if (i) flag(i, { type: 'drift', phase: d.phase, days: daysBetween(d.before, d.after) });
  }

  // Development team view.
  const conflicts = new Map();
  for (const i of live.filter((x) => !deliveryDone(x)))
    for (const o of i.objects) {
      const key = [o.pgmid, o.objectType, o.objectName].join(' ');
      if (!conflicts.has(key)) conflicts.set(key, { ...o, items: [] });
      conflicts.get(key).items.push(brief(i));
    }
  const finalCount = (list) => list.filter((i) => f.finals.has(i.id)).length;

  const result = {
    today,
    view: VIEW_ROLES.find(([role]) => roleCodes(grant).includes(role))?.[1] ?? 'mine',
    team,
    commercial,
    scope: visibleScope(grant, userId),
    milestones: f.milestones,
    modules,
    counts: {
      items: live.length,
      removed: visible.length - live.length,
      developmentDone: count(developmentDone),
      deliveryDone: count(deliveryDone),
    },
    cards: {
      risk: {
        count: count((i) => atRisk(i, today)),
        declared: riskBy('declared'),
        stale: riskBy('stale'),
        filter: { risk: 'any' },
      },
      dueSoon: {
        count: count((i) => PHASE_KEYS.some((k) => dueSoon(i.phases[k], today))),
        filter: { due: true },
      },
      freeze: {
        date: freezeDate,
        daysLeft: freezeDate ? daysBetween(today, freezeDate) : null,
        count: count((i) => pastGate(i, 'development', milestoneDates)),
        filter: { phase: 'development', gate: true },
        risk: count((i) => !!phaseRisk(i.phases.development, today)),
        riskFilter: { phase: 'development', risk: 'any' },
      },
      gaps: { count: count((i) => planGaps(i).length > 0), ...gaps, filter: { gap: true } },
    },
    matrix,
    moduleMatrix: Object.fromEntries(
      modules.map((m) => [
        m,
        Object.fromEntries(
          PHASE_KEYS.map((k) => {
            const list = live.filter((i) => i.module === m);
            return [
              k,
              {
                total: list.length,
                completed: list.filter((i) => i.phases[k].status === 'completed').length,
                risk: list.filter((i) => phaseRisk(i.phases[k], today)).length,
              },
            ];
          }),
        ),
      ]),
    ),
    attention: [...attention.values()]
      .sort((a, b) => b.reasons.length - a.reasons.length || a.code.localeCompare(b.code))
      .slice(0, LIST_LIMIT),
    attentionTotal: attention.size,
    load: loadOf(live, today, people, { team, userId }),
    development: {
      handover: live
        .filter((i) => handoverReady(i, f.finals.has(i.id)))
        .map((i) => ({
          ...brief(i),
          finalOn: dateText(new Date(f.finals.get(i.id))),
          waitDays: daysBetween(dateText(new Date(f.finals.get(i.id))), today),
        }))
        .sort((a, b) => b.waitDays - a.waitDays),
      reverse: live.filter((i) => reverseHandover(i, f.finals.has(i.id))).map(brief),
      conflicts: [...conflicts.values()].filter((c) => c.items.length > 1),
      awaitingTest: live
        .filter(awaitingTest)
        .map((i) => ({
          ...brief(i),
          waitDays: i.phases.development.actualEnd
            ? daysBetween(i.phases.development.actualEnd, today)
            : null,
          tester: name(i.phases.consultant_test.assigneeId),
        }))
        .sort((a, b) => (b.waitDays ?? -1) - (a.waitDays ?? -1)),
      fsdFinal: {
        total: live.length,
        final: finalCount(live),
        byModule: Object.fromEntries(
          modules.map((m) => {
            const list = live.filter((i) => i.module === m);
            return [m, { total: list.length, final: finalCount(list) }];
          }),
        ),
      },
      gates: Object.fromEntries(
        Object.keys(PHASE_GATES).map((k) => [k, count((i) => pastGate(i, k, milestoneDates))]),
      ),
    },
  };
  if (commercial) {
    const effort = (test) =>
      live.reduce(
        (n, i) =>
          n +
          ['fsd', 'development'].reduce(
            (m, k) => m + (test(i.phases[k]) ? (i.phases[k].effortDays ?? 0) : 0),
            0,
          ),
        0,
      );
    result.budget = {
      budgetDays: f.budgetDays,
      plannedDays: Math.round(effort((p) => p.status !== 'cancelled') * 10) / 10,
      doneDays: Math.round(effort((p) => p.status === 'completed') * 10) / 10,
    };
  }
  return result;
}

const roleCodes = (grant) => [
  ...new Set(grant.sources().flatMap((s) => s.sources.map((x) => x.roleCode))),
];

export function overviewRoutes(app, c) {
  app.get('/api/projects/:projectId/development-overview', async (req) => {
    const { project, current } = await c.read(req, 'delivery.overview:view');
    const [items, people, f] = await Promise.all([
      loadItems(c.pool, c.organizationId, project.id),
      members(c.pool, c.organizationId, project.id),
      facts(c.pool, c.organizationId, project.id),
    ]);
    const today = dateText(new Date());
    return buildOverview({
      items,
      people,
      facts: f,
      today,
      grant: project.grant,
      userId: current.user.id,
    });
  });
}
