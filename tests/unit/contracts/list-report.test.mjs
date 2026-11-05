import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesRanges,
  presetRange,
} from '@sap-delivery-workbench/contracts/list-report/conditions';
import { normalizeViewState } from '@sap-delivery-workbench/contracts/list-report/views';

const today = '2026-11-04';
const I = (option, low, high) => ({ sign: 'I', option, low, high });
const E = (option, low, high) => ({ sign: 'E', option, low, high });

test('ranges follow SELECT-OPTIONS: any including range, and no excluding one', () => {
  assert.equal(matchesRanges('SD', [], today), true);
  assert.equal(matchesRanges('SD', [I('EQ', 'SD'), I('EQ', 'MM')], today), true);
  assert.equal(matchesRanges('PP', [I('EQ', 'SD'), I('EQ', 'MM')], today), false);
  assert.equal(matchesRanges('report', [E('EQ', 'report')], today), false);
  assert.equal(matchesRanges('interface', [E('EQ', 'report')], today), true);
  assert.equal(matchesRanges('SRM 接口', [I('CP', '接口'), E('CP', 'srm')], today), false);
});

test('multi-valued fields match on any value; an excluded value removes the row', () => {
  assert.equal(matchesRanges(['t1', 't2'], [I('EQ', 't2')], today), true);
  assert.equal(matchesRanges(['t1', 't2'], [E('EQ', 't2')], today), false);
  assert.equal(matchesRanges([], [I('EQ', 't2')], today), false);
  assert.equal(matchesRanges([], [E('EQ', 't2')], today), true);
});

test('empty is its own condition, and combines with values', () => {
  for (const blank of [null, undefined, '', []])
    assert.equal(matchesRanges(blank, [I('EMPTY')], today), true);
  assert.equal(matchesRanges('u1', [I('EMPTY')], today), false);
  assert.equal(matchesRanges(null, [I('EMPTY'), I('EQ', 'u1')], today), true);
  assert.equal(matchesRanges('u1', [I('EMPTY'), I('EQ', 'u1')], today), true);
  assert.equal(matchesRanges(null, [E('EMPTY')], today), false);
});

test('between compares numbers as numbers and dates as text, either end may be open', () => {
  assert.equal(matchesRanges(9, [I('BT', 5, 10)], today), true);
  assert.equal(matchesRanges(100, [I('BT', 5, 10)], today), false);
  assert.equal(matchesRanges(0, [I('BT', '', 10)], today), true);
  assert.equal(matchesRanges('2026-11-30', [I('BT', '2026-11-01', '2026-11-30')], today), true);
  assert.equal(matchesRanges('2026-12-01', [I('BT', '2026-11-01', '2026-11-30')], today), false);
  assert.equal(matchesRanges(null, [I('BT', '2026-11-01', '')], today), false);
});

test('date presets are worked out from today, so a saved view keeps meaning 本月', () => {
  assert.deepEqual(presetRange('this_month', today), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(presetRange('this_week', today), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(presetRange('this_week', '2026-11-08'), {
    from: '2026-11-02',
    to: '2026-11-08',
  });
  assert.deepEqual(presetRange('next_7', today), { from: today, to: '2026-11-10' });
  assert.deepEqual(presetRange('past', today), { from: '', to: '2026-11-03' });
  assert.equal(presetRange('nonsense', today), null);
  assert.equal(matchesRanges('2026-11-30', [I('PRESET', 'this_month')], today), true);
  assert.equal(matchesRanges('2026-12-01', [I('PRESET', 'this_month')], today), false);
  assert.equal(matchesRanges('2026-12-01', [I('PRESET', 'this_month')], '2026-12-15'), true);
  assert.equal(matchesRanges('2026-11-03', [I('PRESET', 'past')], today), true);
  assert.equal(matchesRanges('2026-11-01', [I('PRESET', 'nonsense')], today), false);
});

test('a view state is reduced to its known shape', () => {
  const state = normalizeViewState({
    search: 'x',
    filterFields: ['module', 3],
    conditions: {
      module: [{ sign: 'E', option: 'EQ', low: 'SD', extra: true }, { option: 'DROP TABLE' }],
      kind: [],
    },
    columns: [{ key: 'name', width: 200.4 }, { nope: 1 }],
    sortOrder: 'sideways',
    injected: true,
  });
  assert.deepEqual(state, {
    search: 'x',
    scope: 'all',
    filterFields: ['module'],
    conditions: { module: [{ sign: 'E', option: 'EQ', low: 'SD', high: null }] },
    columns: [{ key: 'name', visible: true, width: 200 }],
    sortField: '',
    sortOrder: null,
  });
  assert.equal(normalizeViewState(null).columns, null);
  assert.deepEqual(normalizeViewState('x').filterFields, []);
});
