// Development overview judgments (docs/specs/development-overview.md 3), shared by the API
// aggregation and the web list so an overview number and its drill-down list always agree.
// Items use the API JSON shape: `phases.<key>.{status, plannedStart, plannedEnd, ...}`.
// Dates are `YYYY-MM-DD` strings; `today` is passed in so results do not depend on the clock.
import { PHASE_KEYS } from './fields.mjs';

export const RISK_SOURCES = { declared: '已申报延误', stale: '逾期未更新' };
// The milestone each phase should finish before (M20); the development gate is the code freeze.
export const PHASE_GATES = {
  development: 'code_freeze',
  consultant_test: 'sit_start',
  user_test: 'uat_done',
};
export const DUE_SOON_DAYS = 14;

export const isOpen = (phase) => phase.status !== 'completed' && phase.status !== 'cancelled';

export function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (from, to) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

// Risk merges a hand-set “已延误” with a planned end that passed while the phase is still open.
export function phaseRisk(phase, today) {
  if (phase.status === 'delayed') return 'declared';
  if (isOpen(phase) && phase.plannedEnd && phase.plannedEnd < today) return 'stale';
  return null;
}
export const riskPhases = (item, today) =>
  PHASE_KEYS.filter((key) => phaseRisk(item.phases[key], today));
export const atRisk = (item, today) => riskPhases(item, today).length > 0;

export const developmentDone = (item) => item.phases.development.status === 'completed';
export const scopeRemoved = (item) =>
  PHASE_KEYS.every((key) => item.phases[key].status === 'cancelled');
// Delivered when the last phase that is not cancelled is completed.
export function deliveryDone(item) {
  const last = PHASE_KEYS.findLast((key) => item.phases[key].status !== 'cancelled');
  return !!last && item.phases[last].status === 'completed';
}

export function dueSoon(phase, today, days = DUE_SOON_DAYS) {
  return (
    isOpen(phase) &&
    !!phase.plannedEnd &&
    phase.plannedEnd >= today &&
    phase.plannedEnd <= addDays(today, days)
  );
}

// What an open phase still lacks to be planned: an assignee, both dates, an estimate (FSD and
// development only).
export function planGaps(item) {
  const gaps = [];
  for (const key of PHASE_KEYS) {
    const p = item.phases[key];
    if (!isOpen(p)) continue;
    if (!p.assigneeId) gaps.push({ phase: key, gap: 'assignee' });
    if (!p.plannedStart || !p.plannedEnd) gaps.push({ phase: key, gap: 'dates' });
    if ((key === 'fsd' || key === 'development') && p.effortDays == null)
      gaps.push({ phase: key, gap: 'effort' });
  }
  return gaps;
}

// `milestones` maps a milestone key to its date (achieved date, else planned date).
export function pastGate(item, phaseKey, milestones) {
  const gate = milestones?.[PHASE_GATES[phaseKey]];
  const p = item.phases[phaseKey];
  return !!gate && isOpen(p) && !!p.plannedEnd && p.plannedEnd > gate;
}
export const freezeRisk = (item, today, milestones) =>
  pastGate(item, 'development', milestones) || !!phaseRisk(item.phases.development, today);

export const awaitingTest = (item) =>
  developmentDone(item) && item.phases.consultant_test.status === 'not_started';

// `fsdFinal`: the item has an FSD version labelled final (from the design assistant).
export const handoverReady = (item, fsdFinal) =>
  fsdFinal && item.phases.development.status === 'not_started';
export const reverseHandover = (item, fsdFinal) =>
  !fsdFinal && ['in_progress', 'delayed'].includes(item.phases.development.status);

// Drill-down filters an overview number links to; the list applies the same test. Item-level
// keys: ids, module, modules and owner (what the viewer's grant covers), awaiting. Phase-level keys must all hold on one phase (`phase` narrows which):
// assignee, status, risk (any | declared | stale), due, gap, gate; and for the development
// load table (docs/specs/development-load.md): unassigned, active (not cancelled), unplanned
// (open without a planned end), planned (`from~to`, either end may be empty) and actual
// (completed, with its actual end in `from~to`).
export const FILTER_KEYS = [
  'ids',
  'module',
  'modules',
  'owner',
  'awaiting',
  'phase',
  'assignee',
  'status',
  'risk',
  'due',
  'gap',
  'gate',
  'unassigned',
  'active',
  'unplanned',
  'planned',
  'actual',
];
// Is a date inside a `from~to` range (either end may be empty)?
export function inRange(date, range) {
  if (!date) return false;
  const [from, to] = range.split('~');
  return (!from || date >= from) && (!to || date <= to);
}
export const unplanned = (phase) =>
  !phase.plannedEnd && !['completed', 'cancelled'].includes(phase.status);
export function matchesFilter(item, filter, { today, milestones } = {}) {
  if (filter.ids && !filter.ids.includes(item.id)) return false;
  if (filter.module && item.module !== filter.module) return false;
  if (filter.modules && !filter.modules.includes(item.module)) return false;
  if (
    filter.owner &&
    item.createdBy !== filter.owner &&
    !PHASE_KEYS.some((key) => item.phases[key].assigneeId === filter.owner)
  )
    return false;
  if (filter.awaiting && !awaitingTest(item)) return false;
  const gaps = filter.gap ? planGaps(item) : [];
  return (filter.phase ? [filter.phase] : PHASE_KEYS).some((key) => {
    const p = item.phases[key];
    const risk = phaseRisk(p, today);
    return (
      (!filter.assignee || p.assigneeId === filter.assignee) &&
      (!filter.status || p.status === filter.status) &&
      (!filter.risk || (filter.risk === 'any' ? !!risk : risk === filter.risk)) &&
      (!filter.due || dueSoon(p, today)) &&
      (!filter.gap || gaps.some((g) => g.phase === key)) &&
      (!filter.gate || pastGate(item, key, milestones)) &&
      (!filter.unassigned || !p.assigneeId) &&
      (!filter.active || p.status !== 'cancelled') &&
      (!filter.unplanned || unplanned(p)) &&
      (!filter.planned || (p.status !== 'cancelled' && inRange(p.plannedEnd, filter.planned))) &&
      (!filter.actual || (p.status === 'completed' && inRange(p.actualEnd, filter.actual)))
    );
  });
}
