import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseOptions,
  defaultBase,
  isoWeek,
  loadRows,
  loadWindow,
  mondayOf,
  sumRows,
} from '@sap-delivery-workbench/contracts/delivery/load';
import { inRange, unplanned } from '@sap-delivery-workbench/contracts/delivery/overview';

test('load weeks: Mondays, ISO weeks and base date options', () => {
  assert.equal(mondayOf('2026-10-31'), '2026-10-26');
  assert.equal(mondayOf('2026-10-26'), '2026-10-26');
  assert.equal(isoWeek('2026-10-19'), '2026W43');
  assert.equal(isoWeek('2026-12-28'), '2026W53');
  assert.equal(isoWeek('2027-01-04'), '2027W01');
  assert.equal(isoWeek('2024-12-30'), '2025W01');
  // Start − 7 days is a Sunday: the first option is the Monday after it; end + 30 days likewise.
  const options = baseOptions('2026-03-01', '2026-12-31', '2026-10-31');
  assert.equal(options[0], '2026-02-23');
  assert.equal(options.at(-1), '2027-01-25');
  assert.ok(options.every((d) => mondayOf(d) === d));
  assert.equal(defaultBase(options, '2026-10-31'), '2026-10-26');
  assert.equal(defaultBase(options, '2028-01-01'), '2027-01-25');
  assert.equal(defaultBase(options, '2020-01-01'), '2026-02-23');
  // Without project dates: half a year around today.
  const open = baseOptions(null, null, '2026-10-31');
  assert.ok(open.includes('2026-10-26') && open.length >= 52);
});

const phase = (extra = {}) => ({
  assigneeId: 'u',
  effortDays: null,
  plannedEnd: null,
  actualEnd: null,
  status: 'not_started',
  ...extra,
});
const item = (development, test = {}) => ({
  phases: {
    fsd: phase(),
    development: phase(development),
    consultant_test: phase(test),
    user_test: phase(),
  },
});

test('load rows: development phase only, cancelled left out, cumulative difference', () => {
  const { totals, rows } = loadRows([
    item({ effortDays: 2, plannedEnd: '2026-09-30', actualEnd: '2026-10-02', status: 'completed' }),
    item({ effortDays: 3, plannedEnd: '2026-10-14' }),
    item(
      { effortDays: 1, plannedEnd: '2026-10-20', actualEnd: '2026-10-21', status: 'completed' },
      { status: 'completed' },
    ),
    item({ effortDays: 4 }),
    item({ status: 'cancelled', plannedEnd: '2026-10-20' }),
    item({ assigneeId: null, effortDays: 1 }),
  ]);
  assert.deepEqual(totals, { items: 5, developed: 2, tested: 1 });
  const u = rows.find((r) => r.id === 'u');
  assert.deepEqual([u.items, u.done, u.effort, u.unplanned], [4, 2, 10, 1]);
  assert.equal(rows.find((r) => r.id === null).unplanned, 1);

  // Base 2026-10-19: the first column is the week of 10-12; 09-28 falls before it.
  const cols = loadWindow(u, '2026-10-19');
  assert.equal(cols.weeks.length, 9);
  assert.equal(cols.weeks[0].monday, '2026-10-12');
  assert.deepEqual(cols.before, { effort: 2, planned: 1, actual: 1, diff: 0 });
  assert.deepEqual(
    cols.weeks.slice(0, 2).map((w) => [w.effort, w.planned, w.actual, w.diff]),
    [
      [3, 1, 0, -1],
      [1, 1, 1, -1],
    ],
  );
  assert.equal(cols.weeks.at(-1).diff, -1);
  assert.deepEqual(cols.total, { effort: 10, planned: 4, actual: 2, diff: -2 });

  const sum = sumRows(rows);
  assert.deepEqual([sum.items, sum.unplanned, sum.effort], [5, 2, 11]);
  assert.equal(sum.weeks['2026-10-12'].planned, 1);
});

test('load filters: date ranges and unplanned phases', () => {
  assert.ok(inRange('2026-10-20', '2026-10-19~2026-10-25'));
  assert.ok(!inRange('2026-10-26', '2026-10-19~2026-10-25'));
  assert.ok(inRange('2026-01-01', '~2026-10-18'));
  assert.ok(inRange('2026-10-20', '~'));
  assert.ok(!inRange(null, '~'));
  assert.ok(unplanned(phase()));
  assert.ok(!unplanned(phase({ status: 'completed' })));
  assert.ok(!unplanned(phase({ plannedEnd: '2026-10-20' })));
});
