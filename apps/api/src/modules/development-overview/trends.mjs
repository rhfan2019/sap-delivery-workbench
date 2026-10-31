import { PHASE_KEYS } from '@sap-delivery-workbench/contracts/delivery/fields';
import {
  addDays,
  daysBetween,
  isOpen,
  pastGate,
} from '@sap-delivery-workbench/contracts/delivery/overview';
import { dateText } from '../delivery/store.mjs';

// Phase-3 views of the development overview (docs/specs/development-overview.md 4, 5): the
// cumulative flow and burn-down replayed from the phase status history (M22, instead of a daily
// snapshot table), the freeze pace, the SIT forecast, the weekly report, plan drift against the
// baseline (M09) and the computed health signal for the portfolio (M23, M24).
const STATUSES = ['not_started', 'in_progress', 'delayed', 'completed', 'cancelled'];
const EFFORT = ['fsd', 'development'];
const FLOW_DAYS = 120;
const brief = (item) => ({ id: item.id, code: item.code, name: item.name, module: item.module });
const dateOf = (value) => dateText(new Date(value));

// Each item phase's status at the end of every day from `from` to `today`, from its history.
function replay(items, transitions, from, today) {
  const days = [];
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d);
  const live = new Set(items.map((i) => i.id));
  const history = new Map();
  for (const t of transitions) {
    if (!live.has(t.itemId)) continue;
    const key = t.itemId + ' ' + t.phase;
    if (!history.has(key)) history.set(key, []);
    history.get(key).push({ date: dateOf(t.at), status: t.status });
  }
  // statusOn(item, phase)[dayIndex]: the status that day, or null before the item existed.
  const timeline = new Map();
  for (const [key, list] of history) {
    let at = 0;
    let status = null;
    timeline.set(
      key,
      days.map((day) => {
        while (at < list.length && list[at].date <= day) status = list[at++].status;
        return status;
      }),
    );
  }
  return { days, timeline };
}

// M22: per phase, how many items were in each status each day; and the FSD and development
// effort still open each day (current estimates), with the ideal line to the code freeze and
// the pace the freeze asks for against the pace of the last four weeks.
export function flow(items, transitions, { today, milestones }) {
  const first = transitions.length ? dateOf(transitions[0].at) : today;
  const from = first > addDays(today, -FLOW_DAYS) ? first : addDays(today, -FLOW_DAYS);
  const { days, timeline } = replay(items, transitions, from, today);
  const status = Object.fromEntries(
    PHASE_KEYS.map((phase) => [
      phase,
      Object.fromEntries(STATUSES.map((s) => [s, days.map(() => 0)])),
    ]),
  );
  const remaining = days.map(() => 0);
  for (const item of items)
    for (const phase of PHASE_KEYS) {
      const line = timeline.get(item.id + ' ' + phase);
      if (!line) continue;
      const effort = EFFORT.includes(phase) ? (item.phases[phase].effortDays ?? 0) : 0;
      line.forEach((s, i) => {
        if (!s) return;
        status[phase][s][i] += 1;
        if (effort && s !== 'completed' && s !== 'cancelled') remaining[i] += effort;
      });
    }
  const round = (n) => Math.round(n * 10) / 10;
  const freeze = milestones.code_freeze ?? null;
  const now = remaining.at(-1) ?? 0;
  // Effort completed in each of the last four weeks: the latest completion of each FSD and
  // development phase in the history, at its current estimate.
  const done = [0, 0, 0, 0];
  const byId = new Map(items.map((i) => [i.id, i]));
  const latest = new Map();
  for (const t of transitions)
    if (t.status === 'completed' && EFFORT.includes(t.phase) && byId.has(t.itemId))
      latest.set(t.itemId + ' ' + t.phase, t);
  for (const t of latest.values()) {
    const ago = daysBetween(dateOf(t.at), today);
    const p = byId.get(t.itemId).phases[t.phase];
    if (ago < 28 && p.status === 'completed') done[Math.floor(ago / 7)] += p.effortDays ?? 0;
  }
  const weeksLeft = freeze && freeze > today ? daysBetween(today, freeze) / 7 : null;
  return {
    days,
    status,
    remaining: remaining.map(round),
    freeze,
    ideal:
      freeze && freeze > days[0]
        ? { from: { date: days[0], value: round(remaining[0]) }, to: { date: freeze, value: 0 } }
        : null,
    pace: {
      remaining: round(now),
      weeksLeft: weeksLeft === null ? null : round(weeksLeft),
      requiredPerWeek: weeksLeft ? round(now / weeksLeft) : null,
      recentPerWeek: round(done.reduce((a, b) => a + b, 0) / 4),
      lastWeeks: done.map(round).reverse(),
    },
  };
}

// The average slip of finished development and consultant test phases (actual end − planned end).
export function averageSlip(items) {
  const samples = items.flatMap((i) =>
    ['development', 'consultant_test']
      .map((k) => i.phases[k])
      .filter((p) => p.status === 'completed' && p.actualEnd && p.plannedEnd)
      .map((p) => daysBetween(p.plannedEnd, p.actualEnd)),
  );
  return {
    days: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0,
    samples: samples.length,
  };
}

// SIT forecast (spec section 5): per module, how many items will have finished development and
// the consultant test by the SIT start, shifting open plans by the project's average slip.
export function sitForecast(items, { milestones }) {
  const sit = milestones.sit_start ?? null;
  if (!sit) return null;
  const slip = averageSlip(items);
  const doneBy = (p) =>
    p.status === 'completed' ||
    (isOpen(p) && !!p.plannedEnd && addDays(p.plannedEnd, slip.days) <= sit);
  const inScope = items.filter((i) => i.phases.consultant_test.status !== 'cancelled');
  const ready = (i) =>
    i.phases.development.status === 'completed' && i.phases.consultant_test.status === 'completed';
  const predicted = (i) => doneBy(i.phases.development) && doneBy(i.phases.consultant_test);
  const row = (list) => ({
    total: list.length,
    readyNow: list.filter(ready).length,
    predicted: list.filter(predicted).length,
    missing: list.filter((i) => !predicted(i)).map((i) => i.id),
  });
  const modules = [...new Set(inScope.map((i) => i.module))].sort();
  return {
    sit,
    slip,
    all: row(inScope),
    byModule: Object.fromEntries(
      modules.map((m) => [m, row(inScope.filter((i) => i.module === m))]),
    ),
  };
}

// The weekly report draft (spec section 5): what finished, what was added, which plans moved
// and what falls due next week; the page turns it into text for the internal weekly meeting.
export function weekReport(items, transitions, drift, today) {
  const since = addDays(today, -6);
  const byId = new Map(items.map((i) => [i.id, i]));
  const completed = new Map();
  for (const t of transitions)
    if (t.status === 'completed' && byId.has(t.itemId) && dateOf(t.at) >= since)
      completed.set(t.itemId + t.phase, { ...brief(byId.get(t.itemId)), phase: t.phase });
  const due = [];
  for (const i of items)
    for (const k of PHASE_KEYS) {
      const p = i.phases[k];
      if (isOpen(p) && p.plannedEnd && p.plannedEnd > today && p.plannedEnd <= addDays(today, 7))
        due.push({ ...brief(i), phase: k, plannedEnd: p.plannedEnd });
    }
  return {
    from: since,
    to: today,
    completed: [...completed.values()],
    created: items.filter((i) => dateOf(i.createdAt) >= since).map(brief),
    pushed: drift
      .filter((d) => byId.has(d.itemId))
      .map((d) => ({
        ...brief(byId.get(d.itemId)),
        phase: d.phase,
        days: daysBetween(d.before, d.after),
      })),
    due: due.sort((a, b) => a.plannedEnd.localeCompare(b.plannedEnd)),
  };
}

// M09 against the baseline: phases whose planned end now lies after the first one promised.
export function planDrift(items) {
  const rows = [];
  let planned = 0;
  for (const i of items)
    for (const k of PHASE_KEYS) {
      const p = i.phases[k];
      if (!p.baselineEnd || !p.plannedEnd || p.status === 'cancelled') continue;
      planned += 1;
      const days = daysBetween(p.baselineEnd, p.plannedEnd);
      if (days > 0)
        rows.push({
          ...brief(i),
          phase: k,
          baselineEnd: p.baselineEnd,
          plannedEnd: p.plannedEnd,
          days,
        });
    }
  rows.sort((a, b) => b.days - a.days);
  return {
    planned,
    drifted: rows.length,
    totalDays: rows.reduce((n, r) => n + r.days, 0),
    top: rows.slice(0, 20),
    itemIds: [...new Set(rows.map((r) => r.id))],
  };
}

// M23: a health colour computed from the numbers, with the reasons, so it can be set beside the
// colour the project reports and nobody has to trust a black box.
export function healthSignal({ items, risk, freezeLate, freezeDays, budgetRatio, staleDays }) {
  const reasons = [];
  let level = 0;
  const raise = (to, text) => {
    level = Math.max(level, to);
    reasons.push({ level: to === 2 ? 'red' : 'yellow', text });
  };
  const rate = items ? risk / items : 0;
  if (rate >= 0.2) raise(2, `风险开发项占 ${Math.round(rate * 100)}%`);
  else if (rate >= 0.1) raise(1, `风险开发项占 ${Math.round(rate * 100)}%`);
  if (freezeLate > 0)
    raise(freezeDays !== null && freezeDays <= 14 ? 2 : 1, `${freezeLate} 项开发计划晚于开发冻结`);
  if (budgetRatio !== null && budgetRatio > 1.1)
    raise(2, `已计划人天超预算 ${Math.round((budgetRatio - 1) * 100)}%`);
  else if (budgetRatio !== null && budgetRatio > 1) raise(1, '已计划人天超出预算');
  if (staleDays !== null && staleDays > 14) raise(1, `${staleDays} 天没有更新开发清单`);
  return { color: ['green', 'yellow', 'red'][level], reasons };
}

export const freezeLateCount = (items, milestones) =>
  items.filter((i) => pastGate(i, 'development', milestones)).length;

// Section 9 pairs that keep the numbers honest: phases reopened after being completed (against
// the completed count), and the median estimate of recently added items against older ones
// (splitting work into small items would inflate the completion rate).
export function guards(items, transitions, today) {
  const since = addDays(today, -30);
  const live = new Set(items.map((i) => i.id));
  const reopened = transitions.filter(
    (t) =>
      live.has(t.itemId) && t.from === 'completed' && t.status !== 'completed' && dateOf(t.at) >= since,
  );
  const effort = (i) => EFFORT.reduce((n, k) => n + (i.phases[k].effortDays ?? 0), 0);
  const median = (list) => {
    const v = list.map(effort).filter((n) => n > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
  };
  const recent = items.filter((i) => i.registeredOn >= since);
  return {
    reopened: reopened.length,
    reopenedIds: [...new Set(reopened.map((t) => t.itemId))],
    effortMedian: { recent: median(recent), earlier: median(items.filter((i) => !recent.includes(i))) },
  };
}
