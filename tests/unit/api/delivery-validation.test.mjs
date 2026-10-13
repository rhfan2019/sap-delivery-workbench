import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeChanges,
  objectList,
  settlePhase,
} from '../../../apps/api/src/modules/delivery/validation.mjs';

test('rich text keeps useful formatting and strips active content', () => {
  const { item } = normalizeChanges({
    businessFunction:
      '<p>自然语言 <strong>重点</strong></p><ul><li>条件</li></ul><table><tbody><tr><th>字段</th><td>值</td></tr></tbody></table><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">危险链接</a>',
  });
  assert.match(item.businessFunction, /<strong>重点<\/strong>/);
  assert.match(item.businessFunction, /<table>/);
  assert.match(item.businessFunction, /<li>条件<\/li>/);
  assert.doesNotMatch(item.businessFunction, /script|onerror|javascript:|<img|<a/);
  assert.equal(normalizeChanges({ notes: '<p></p>' }).item.notes, '');
  assert.throws(() => normalizeChanges({ businessFunction: 'x'.repeat(100001) }));
});

test('change keys follow the shared catalog and reject removed fields', () => {
  const result = normalizeChanges({
    name: ' 报表 ',
    'fsd.status': 'in_progress',
    'development.effortDays': '1.5',
    'consultant_test.progress': '30%',
  });
  assert.equal(result.item.name, '报表');
  assert.deepEqual(result.phases, {
    fsd: { status: 'in_progress' },
    development: { effortDays: 1.5 },
    consultant_test: { progress: 30 },
  });
  for (const removed of ['stage', 'acceptance', 'blockedReason', 'summary', 'code'])
    assert.throws(() => normalizeChanges({ [removed]: 'x' }), /不允许修改/);
  assert.throws(() => normalizeChanges({ kind: 'form' }), /类型/);
  assert.throws(() => normalizeChanges({ 'user_test.effortDays': 1 }), /不允许修改/);
  assert.throws(() => normalizeChanges({ 'fsd.effortDays': 0.25 }), /一位小数/);
});

test('phase rules and SAP object normalization', () => {
  assert.equal(
    settlePhase('fsd', { status: 'in_progress' }, { status: 'completed' }).progress,
    100,
  );
  assert.throws(() => settlePhase('fsd', { status: 'completed' }, { progress: 60 }), /100%/);
  assert.throws(
    () => settlePhase('fsd', { plannedStart: '2026-10-10' }, { plannedEnd: '2026-10-01' }),
    /不能早于/,
  );
  assert.deepEqual(objectList([{ objectType: ' prog', objectName: 'zr_a ' }]), [
    { pgmid: 'R3TR', objectType: 'PROG', objectName: 'ZR_A' },
  ]);
  assert.throws(() => objectList([{ objectType: 'PRO', objectName: 'X' }]), /4 位/);
  assert.throws(
    () =>
      objectList([
        { objectType: 'PROG', objectName: 'X' },
        { objectType: 'prog', objectName: 'x' },
      ]),
    /重复/,
  );
});
