import { PHASE_KEYS } from '@sap-delivery-workbench/contracts/delivery/fields';
import {
  addDays,
  awaitingTest,
  daysBetween,
  dueSoon,
  isOpen,
  phaseRisk,
} from '@sap-delivery-workbench/contracts/delivery/overview';
import { dateText } from '../delivery/store.mjs';

// Phase-2 views of the development overview (docs/specs/development-overview.md 2, 4): work in
// progress age (M12), assistant coverage (M14), FSD backlog (M16), comments (M18), FSD rework
// (M19), test readiness (M21), and the personal “mine” and consultant lists.
const WORKING = ['in_progress', 'delayed'];
const STARTED = ['in_progress', 'delayed', 'completed'];
const TOP = 5;
const brief = (item) => ({ id: item.id, code: item.code, name: item.name, module: item.module });
const ids = (list) => list.map((i) => i.id);
const dateOf = (value) => dateText(new Date(value));

// Nearest-rank percentile of a sorted list.
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

// M12: how long open phases have been running. The start is the recorded actual start, else the
// planned start (then `estimated`); phases with neither are left out.
export function aging(items, today) {
  return Object.fromEntries(
    PHASE_KEYS.map((key) => {
      const points = items
        .filter((i) => WORKING.includes(i.phases[key].status))
        .map((i) => {
          const p = i.phases[key];
          const start = p.actualStart ?? p.plannedStart;
          return start && start <= today
            ? { ...brief(i), days: daysBetween(start, today), estimated: !p.actualStart }
            : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.days - a.days);
      const days = points.map((x) => x.days).sort((a, b) => a - b);
      return [key, { points, p50: percentile(days, 50), p85: percentile(days, 85) }];
    }),
  );
}

// M14: of the items whose development has started, how many have a development conversation,
// a final code version and a version read back from SAP.
export function coverage(items, devCoverage) {
  const started = items.filter((i) => STARTED.includes(i.phases.development.status));
  const of = (test) => started.filter((i) => test(devCoverage.get(i.id)));
  const missing = of((c) => !c);
  return {
    started: started.length,
    session: started.length - missing.length,
    final: of((c) => c?.final).length,
    sap: of((c) => c?.sap).length,
    missing: missing.map(brief),
  };
}

// M16: open FSD phases by when they are due.
export function fsdBacklog(items, today) {
  const open = items.filter((i) => isOpen(i.phases.fsd));
  const risk = open.filter((i) => phaseRisk(i.phases.fsd, today));
  const week = open.filter((i) => !risk.includes(i) && dueSoon(i.phases.fsd, today, 7));
  const later = open.filter((i) => !risk.includes(i) && !week.includes(i));
  return {
    overdue: ids(risk),
    week: ids(week),
    later: ids(later.filter((i) => i.phases.fsd.plannedEnd)),
    unplanned: ids(later.filter((i) => !i.phases.fsd.plannedEnd)),
  };
}

// M18: open comments by age, the oldest ones, and how long resolved ones took (median).
export function commentStats(items, comments, today) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const mine = comments.filter((c) => byId.has(c.itemId));
  const open = mine
    .filter((c) => c.status === 'open')
    .map((c) => ({
      ...brief(byId.get(c.itemId)),
      source: c.source,
      days: daysBetween(dateOf(c.createdAt), today),
    }))
    .sort((a, b) => b.days - a.days);
  const took = mine
    .filter((c) => c.status === 'resolved' && c.resolvedAt)
    .map((c) => daysBetween(dateOf(c.createdAt), dateOf(c.resolvedAt)))
    .sort((a, b) => a - b);
  const bucket = (from, to) => open.filter((c) => c.days >= from && c.days <= to).length;
  return {
    open: open.length,
    ages: { within3: bucket(0, 3), within7: bucket(4, 7), older: bucket(8, Infinity) },
    oldest: open.slice(0, TOP),
    resolvedMedian: percentile(took, 50),
    itemIds: [...new Set(open.map((c) => c.id))],
  };
}

// M19: FSDs with new versions after their first final one; when development or testing has
// already started, the change may need a retest.
export function rework(items, finals) {
  return items
    .filter((i) => finals.get(i.id)?.laterVersions > 0)
    .map((i) => ({
      ...brief(i),
      laterVersions: finals.get(i.id).laterVersions,
      retest: ['development', 'consultant_test', 'user_test'].some((k) =>
        STARTED.includes(i.phases[k].status),
      ),
    }))
    .sort((a, b) => b.retest - a.retest || b.laterVersions - a.laterVersions);
}

// M21: per module, items whose development and consultant test are both completed, against
// the items still in scope for testing.
export function readiness(items, modules) {
  const inScope = items.filter((i) => i.phases.consultant_test.status !== 'cancelled');
  const ready = (i) =>
    i.phases.development.status === 'completed' && i.phases.consultant_test.status === 'completed';
  const row = (list) => ({
    total: list.length,
    ready: list.filter(ready).length,
    notReady: ids(list.filter((i) => !ready(i))),
  });
  return {
    all: row(inScope),
    byModule: Object.fromEntries(
      modules.map((m) => [m, row(inScope.filter((i) => i.module === m))]),
    ),
    noTester: ids(
      inScope.filter((i) =>
        ['consultant_test', 'user_test'].some(
          (k) => isOpen(i.phases[k]) && !i.phases[k].assigneeId,
        ),
      ),
    ),
  };
}

const PRIORITY = { high: 0, medium: 1, low: 2 };
const STAGE = { fsd: 'design', development: 'development' };

// The personal view (“mine”): what to do first, what waits for me, and my SAP objects.
export function mine(items, { userId, today, finals, comments, objectsShared }) {
  const todo = [];
  for (const i of items)
    for (const key of PHASE_KEYS) {
      const p = i.phases[key];
      if (p.assigneeId !== userId || !isOpen(p)) continue;
      todo.push({
        ...brief(i),
        phase: key,
        status: p.status,
        plannedEnd: p.plannedEnd,
        risk: phaseRisk(p, today),
        priority: i.priority,
        stage: STAGE[key] ?? null,
      });
    }
  todo.sort(
    (a, b) =>
      !!b.risk - !!a.risk ||
      (a.plannedEnd ?? '9999').localeCompare(b.plannedEnd ?? '9999') ||
      PRIORITY[a.priority] - PRIORITY[b.priority],
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const respond = [];
  // Open comments on the phases I own: FSD comments for the FSD owner, code comments for the
  // developer.
  for (const c of comments) {
    const i = byId.get(c.itemId);
    const owner = i?.phases[c.source === 'fsd' ? 'fsd' : 'development'].assigneeId;
    if (c.status === 'open' && owner === userId)
      respond.push({
        ...brief(i),
        type: 'comment',
        source: c.source,
        days: daysBetween(dateOf(c.createdAt), today),
      });
  }
  // FSDs finalized in the last week for items I develop.
  for (const i of items) {
    const f = finals.get(i.id);
    if (f && i.phases.development.assigneeId === userId && dateOf(f.finalAt) >= addDays(today, -7))
      respond.push({ ...brief(i), type: 'final', days: daysBetween(dateOf(f.finalAt), today) });
  }
  respond.sort((a, b) => b.days - a.days);
  const objects = [];
  for (const i of items) {
    const owns = PHASE_KEYS.some((k) => i.phases[k].assigneeId === userId && isOpen(i.phases[k]));
    if (owns)
      for (const o of i.objects)
        objects.push({
          ...o,
          item: brief(i),
          shared: objectsShared(o).filter((x) => x.id !== i.id),
        });
  }
  objects.sort((a, b) => b.shared.length - a.shared.length);
  return {
    today: todo.slice(0, TOP),
    todoTotal: todo.length,
    todoIds: ids(todo),
    respond,
    objects,
  };
}

// The consultant's own numbers (spec section 2): FSDs at risk, open comments on them, and
// developed items waiting for their consultant test.
export function consultant(items, { userId, today, comments }) {
  const fsdMine = items.filter((i) => i.phases.fsd.assigneeId === userId);
  const commentItems = new Set(
    comments
      .filter((c) => c.source === 'fsd' && c.status === 'open')
      .map((c) => c.itemId)
      .filter((id) => fsdMine.some((i) => i.id === id)),
  );
  const waiting = items.filter(
    (i) => awaitingTest(i) && i.phases.consultant_test.assigneeId === userId,
  );
  return {
    fsdRisk: ids(fsdMine.filter((i) => phaseRisk(i.phases.fsd, today))),
    comments: [...commentItems],
    awaiting: ids(waiting),
  };
}
