import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitSections,
  applyEdit,
  changedSections,
  compareDeclarations,
} from '../../../../apps/api/src/modules/abap-fsd-agent/document.mjs';

const doc = '# 1 开发需求部分\n\n## 1.1 开发概览\n概览正文\n\n## 1.2 业务需求描述\n需求正文\n';

test('sections are keyed by heading text', () => {
  assert.deepEqual(
    splitSections(doc).map((s) => [s.heading, s.level, s.body]),
    [
      ['1 开发需求部分', 1, ''],
      ['1.1 开发概览', 2, '概览正文'],
      ['1.2 业务需求描述', 2, '需求正文'],
    ],
  );
});

test('edits replace exactly one occurrence and report the touched sections', () => {
  const result = applyEdit(doc, '需求正文', '新的需求正文');
  assert.match(result.markdown, /新的需求正文/);
  assert.deepEqual(result.sections, ['1.2 业务需求描述']);
  assert.deepEqual(
    applyEdit(doc, '## 1.2 业务需求描述\n需求正文', '## 1.2 业务需求\n改').sections,
    ['1.2 业务需求描述', '1.2 业务需求'],
  );
  assert.throws(() => applyEdit(doc, '不存在的原文', 'x'), /找不到/);
  assert.throws(() => applyEdit(doc + '\n需求正文', '需求正文', 'x'), /多次/);
  assert.throws(() => applyEdit(doc, '', 'x'), /不能为空/);
});

test('version comparison flags changes nobody declared and declarations that did not land', () => {
  const after = doc.replace('概览正文', '概览改了').replace('需求正文', '需求也改了');
  assert.deepEqual(
    changedSections(doc, after).map((c) => c.heading),
    ['1.1 开发概览', '1.2 业务需求描述'],
  );
  const comparison = compareDeclarations(doc, after, [
    { sections: ['1.1 开发概览'] },
    { sections: ['附录 A 未决事项'] },
  ]);
  assert.deepEqual(comparison.undeclared, ['1.2 业务需求描述']);
  assert.deepEqual(comparison.unapplied, ['附录 A 未决事项']);
  assert.deepEqual(compareDeclarations('', after, []).undeclared, []);
});
