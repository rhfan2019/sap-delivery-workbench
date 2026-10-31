import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atRisk,
  awaitingTest,
  deliveryDone,
  developmentDone,
  dueSoon,
  freezeRisk,
  handoverReady,
  matchesFilter,
  pastGate,
  phaseRisk,
  planGaps,
  reverseHandover,
  scopeRemoved,
} from '@sap-delivery-workbench/contracts/delivery/overview';

const TODAY = '2026-10-30';
const phase = (overrides = {}) => ({
  assigneeId: 'u1',
  effortDays: 2,
  plannedStart: '2026-10-01',
  plannedEnd: '2026-11-20',
  actualEnd: null,
  status: 'not_started',
  ...overrides,
});
const item = (phases = {}, overrides = {}) => ({
  id: 'i1',
  module: 'MM',
  phases: {
    fsd: phase(phases.fsd),
    development: phase(phases.development),
    consultant_test: phase({ effortDays: null, ...phases.consultant_test }),
    user_test: phase({ effortDays: null, ...phases.user_test }),
  },
  ...overrides,
});

test('risk merges a hand-set delay with a passed planned end on an open phase', () => {
  assert.equal(
    phaseRisk(phase({ status: 'delayed', plannedEnd: '2026-12-01' }), TODAY),
    'declared',
  );
  assert.equal(
    phaseRisk(phase({ status: 'in_progress', plannedEnd: '2026-10-29' }), TODAY),
    'stale',
  );
  // Due today is not late yet; closed phases and phases without a plan never are.
  assert.equal(phaseRisk(phase({ plannedEnd: TODAY }), TODAY), null);
  assert.equal(phaseRisk(phase({ status: 'completed', plannedEnd: '2026-10-01' }), TODAY), null);
  assert.equal(phaseRisk(phase({ status: 'cancelled', plannedEnd: '2026-10-01' }), TODAY), null);
  assert.equal(phaseRisk(phase({ plannedEnd: null }), TODAY), null);
  assert.equal(atRisk(item({ user_test: { status: 'delayed' } }), TODAY), true);
  assert.equal(atRisk(item(), TODAY), false);
});

test('development done and delivery done are two separate levels', () => {
  const coded = item({ fsd: { status: 'completed' }, development: { status: 'completed' } });
  assert.equal(developmentDone(coded), true);
  assert.equal(deliveryDone(coded), false);
  // The user test is cancelled, so the consultant test is the last phase that counts.
  const delivered = item({
    fsd: { status: 'completed' },
    development: { status: 'completed' },
    consultant_test: { status: 'completed' },
    user_test: { status: 'cancelled' },
  });
  assert.equal(deliveryDone(delivered), true);
  const removed = item({
    fsd: { status: 'cancelled' },
    development: { status: 'cancelled' },
    consultant_test: { status: 'cancelled' },
    user_test: { status: 'cancelled' },
  });
  assert.equal(scopeRemoved(removed), true);
  assert.equal(deliveryDone(removed), false);
});

test('due soon covers today to fourteen days ahead on open phases', () => {
  assert.equal(dueSoon(phase({ plannedEnd: TODAY }), TODAY), true);
  assert.equal(dueSoon(phase({ plannedEnd: '2026-11-13' }), TODAY), true);
  assert.equal(dueSoon(phase({ plannedEnd: '2026-11-14' }), TODAY), false);
  assert.equal(dueSoon(phase({ plannedEnd: '2026-10-29' }), TODAY), false);
  assert.equal(dueSoon(phase({ plannedEnd: TODAY, status: 'completed' }), TODAY), false);
});

test('plan gaps list missing assignees, dates and estimates of open phases only', () => {
  const gaps = planGaps(
    item({
      fsd: { status: 'completed', assigneeId: null },
      development: { effortDays: null },
      consultant_test: { assigneeId: null, plannedStart: null },
      user_test: { status: 'cancelled', assigneeId: null },
    }),
  );
  assert.deepEqual(gaps, [
    { phase: 'development', gap: 'effort' },
    { phase: 'consultant_test', gap: 'assignee' },
    { phase: 'consultant_test', gap: 'dates' },
  ]);
});

test('gates compare planned ends with milestones; freeze risk adds a risky development phase', () => {
  const late = item({ development: { plannedEnd: '2026-12-01' } });
  assert.equal(pastGate(late, 'development', { code_freeze: '2026-11-30' }), true);
  assert.equal(pastGate(late, 'development', { code_freeze: '2026-12-01' }), false);
  assert.equal(pastGate(late, 'development', {}), false);
  assert.equal(pastGate(late, 'fsd', { code_freeze: '2026-11-30' }), false);
  const stale = item({ development: { plannedEnd: '2026-10-01', status: 'in_progress' } });
  assert.equal(freezeRisk(stale, TODAY, { code_freeze: '2026-12-31' }), true);
});

test('handover and test waiting follow phase statuses and the final FSD', () => {
  assert.equal(handoverReady(item(), true), true);
  assert.equal(handoverReady(item(), false), false);
  assert.equal(reverseHandover(item({ development: { status: 'in_progress' } }), false), true);
  assert.equal(reverseHandover(item({ development: { status: 'in_progress' } }), true), false);
  assert.equal(awaitingTest(item({ development: { status: 'completed' } })), true);
  assert.equal(
    awaitingTest(
      item({ development: { status: 'completed' }, consultant_test: { status: 'in_progress' } }),
    ),
    false,
  );
});

test('filter conditions on phases must hold on the same phase', () => {
  const it = item({
    fsd: { assigneeId: 'a', status: 'delayed' },
    development: { assigneeId: 'b', status: 'in_progress' },
  });
  const ctx = { today: TODAY };
  assert.equal(matchesFilter(it, { assignee: 'a', risk: 'any' }, ctx), true);
  assert.equal(matchesFilter(it, { assignee: 'b', risk: 'any' }, ctx), false);
  assert.equal(matchesFilter(it, { risk: 'declared', phase: 'development' }, ctx), false);
  assert.equal(matchesFilter(it, { module: 'SD' }, ctx), false);
  assert.equal(matchesFilter(it, { ids: ['i1'] }, ctx), true);
  assert.equal(matchesFilter(it, { ids: ['other'] }, ctx), false);
  assert.equal(matchesFilter(it, {}, ctx), true);
});
