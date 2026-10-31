// Development load table (docs/specs/development-load.md), shared by the API, which groups the
// items per developer and week, and the web, which lays out the weeks around the chosen base
// Monday. Only the development phase counts; a cancelled development phase (and so an item
// removed from scope) is left out. Dates are `YYYY-MM-DD` strings.
import { addDays, unplanned } from './overview.mjs';

export const WEEKS_BEFORE = 1;
// Weeks shown after the base week (展望周数), chosen on the page.
export const AHEAD_DEFAULT = 3;
export const AHEAD_MAX = 12;
// The look-ahead from the address: a whole number 1..AHEAD_MAX, else the default.
export function aheadOf(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= AHEAD_MAX ? n : AHEAD_DEFAULT;
}

const weekday = (date) => (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
// The Monday of the week a date falls in.
export const mondayOf = (date) => addDays(date, -weekday(date));
// ISO week label of a Monday, e.g. 2026W43 (the ISO year is the year of that week's Thursday).
export function isoWeek(monday) {
  const thursday = addDays(monday, 3);
  const year = thursday.slice(0, 4);
  const first = mondayOf(year + '-01-04');
  const week = Math.round((Date.parse(monday) - Date.parse(first)) / (7 * 86400000)) + 1;
  return `${year}W${String(week).padStart(2, '0')}`;
}

// The Mondays offered as base dates: from project start − 7 days to project end + 30 days. A
// project without dates gets half a year either side of today.
export function baseOptions(start, end, today) {
  const from = start ? addDays(start, -7) : addDays(today, -182);
  const to = end ? addDays(end, 30) : addDays(today, 182);
  const options = [];
  let monday = mondayOf(from);
  if (monday < from) monday = addDays(monday, 7);
  for (; monday <= to; monday = addDays(monday, 7)) options.push(monday);
  return options;
}
// This week's Monday, else the option nearest to it.
export function defaultBase(options, today) {
  const now = mondayOf(today);
  if (!options.length || options.includes(now)) return now;
  return now < options[0] ? options[0] : options[options.length - 1];
}

const bucket = () => ({ effort: 0, planned: 0, actual: 0 });
// One row per development assignee (null: not assigned yet). `items` counts every development
// item of the row, `done` those completed; `weeks` is keyed by Monday.
export function loadRows(items) {
  const rows = new Map();
  const totals = { items: 0, developed: 0, tested: 0 };
  for (const item of items) {
    const p = item.phases.development;
    if (p.status === 'cancelled') continue;
    totals.items++;
    if (p.status === 'completed') totals.developed++;
    if (item.phases.consultant_test.status === 'completed') totals.tested++;
    const key = p.assigneeId ?? null;
    let row = rows.get(key);
    if (!row) {
      row = { id: key, items: 0, done: 0, effort: 0, unplanned: 0, weeks: {} };
      rows.set(key, row);
    }
    row.items++;
    row.effort += p.effortDays ?? 0;
    if (unplanned(p)) row.unplanned++;
    if (p.plannedEnd) {
      const w = (row.weeks[mondayOf(p.plannedEnd)] ??= bucket());
      w.planned++;
      w.effort += p.effortDays ?? 0;
    }
    // Finished means completed (so the total equals 已开发); the week is its actual end, and a
    // completed phase without one counts in the total only.
    if (p.status === 'completed') {
      row.done++;
      if (p.actualEnd) (row.weeks[mondayOf(p.actualEnd)] ??= bucket()).actual++;
    }
  }
  return { totals, rows: [...rows.values()] };
}

// The columns of one row for a base Monday: everything before the first week, the weeks (one
// before the base, the base, `ahead` after), everything after the last week and the row total.
// `diff` is cumulative from the left: actual minus planned up to and including that column.
export function loadWindow(row, base, ahead = AHEAD_DEFAULT) {
  const first = addDays(base, -7 * WEEKS_BEFORE);
  const mondays = Array.from({ length: WEEKS_BEFORE + 1 + ahead }, (_, n) => addDays(first, 7 * n));
  const next = addDays(base, 7 * (ahead + 1));
  const before = bucket();
  const after = bucket();
  for (const [monday, w] of Object.entries(row.weeks)) {
    const into = monday < first ? before : monday >= next ? after : null;
    if (!into) continue;
    into.effort += w.effort;
    into.planned += w.planned;
    into.actual += w.actual;
  }
  let diff = before.actual - before.planned;
  const weeks = mondays.map((monday) => {
    const w = row.weeks[monday] ?? bucket();
    diff += w.actual - w.planned;
    return { monday, ...w, diff };
  });
  return {
    before: { ...before, diff: before.actual - before.planned },
    weeks,
    after: { ...after, from: next, diff: diff + after.actual - after.planned },
    total: { effort: row.effort, planned: row.items, actual: row.done, diff: row.done - row.items },
  };
}

// Adds rows up (the total line).
export function sumRows(rows) {
  const sum = { id: null, items: 0, done: 0, effort: 0, unplanned: 0, weeks: {} };
  for (const row of rows) {
    sum.items += row.items;
    sum.done += row.done;
    sum.effort += row.effort;
    sum.unplanned += row.unplanned;
    for (const [monday, w] of Object.entries(row.weeks)) {
      const s = (sum.weeks[monday] ??= bucket());
      s.effort += w.effort;
      s.planned += w.planned;
      s.actual += w.actual;
    }
  }
  return sum;
}
