import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEdit,
  bareCode,
  codeOutline,
  compareDeclarations,
  diffLines,
  formatDiff,
  readCodeLines,
  staleComments,
} from '../../../../apps/api/src/modules/abap-dev-agent/artifacts.mjs';

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

test('code is read by numbered line ranges of at most 400 lines', () => {
  const out = readCodeLines(lines(1000), 10, 2000);
  assert.match(out, /第 10～409 行（共 1000 行）/);
  assert.match(out, /^ {3}10 {2}line 10$/m);
  assert.match(out, /start_line=410/);
  assert.match(readCodeLines(lines(3), 9), /没有第 9 行/);
});

test('fences are stripped and edits must hit exactly one place', () => {
  assert.equal(bareCode('```abap\nREPORT z.\n```'), 'REPORT z.');
  assert.equal(applyEdit('a b c', 'b', 'x').text, 'a x c');
  assert.throws(() => applyEdit('a a', 'a', 'x'), /多次/);
  assert.throws(() => applyEdit('a', 'z', 'x'), /找不到/);
});

test('line diffs report additions, removals and where they are', () => {
  const before = lines(50);
  const after = before.replace('line 20', 'line twenty').concat('\nline 51');
  const diff = diffLines(before, after);
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.equal(diff.hunks.length, 2);
  assert.match(formatDiff(diff), /- line 20\n\+ line twenty/);
  assert.equal(formatDiff(diffLines(before, before)), '与上一版本相同。');
});

test('declarations are compared with actual changes', () => {
  const before = { plan: '## 1 业务口径\na\n## 2 技术方案\nb', code: 'REPORT z.\n' };
  const after = { plan: '## 1 业务口径\nA\n## 2 技术方案\nB', code: 'REPORT z.\nWRITE 1.\n' };
  const c = compareDeclarations(before, after, [
    { target: 'plan', sections: ['1 业务口径', '3 手工步骤'] },
  ]);
  assert.deepEqual(c.plan.undeclared, ['2 技术方案']);
  assert.deepEqual(c.plan.unapplied, ['3 手工步骤']);
  assert.equal(c.code.undeclared, true);
});

test('comments whose text is gone become stale; outline lists blocks', () => {
  const comments = [
    { id: 'a', status: 'open', target: 'code', anchorText: 'WRITE 1.' },
    { id: 'b', status: 'open', target: 'plan', anchorText: '口径' },
    { id: 'c', status: 'resolved', target: 'code', anchorText: 'gone' },
  ];
  assert.deepEqual(staleComments(comments, { plan: '业务口径', code: 'REPORT z.' }), ['a']);
  assert.match(
    codeOutline('REPORT z.\nCLASS lcl_report IMPLEMENTATION.\n  METHOD select.'),
    /3 {2}METHOD select/,
  );
});
