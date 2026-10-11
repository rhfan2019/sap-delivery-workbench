import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDocument,
  formatCheck,
  REQUIRED_SECTIONS,
} from '../../../../apps/api/src/modules/abap-fsd-agent/tools/check.mjs';

const complete = REQUIRED_SECTIONS.map(([n, t]) => `## ${n} ${t}\n内容`).join('\n\n');

test('a complete skeleton passes; missing sections are named', async () => {
  assert.equal((await checkDocument(complete)).ok, true);
  const result = await checkDocument(complete.replace('## 2.5 功能按钮', '## 2.5 其他'));
  assert.deepEqual(
    result.problems.map((p) => p.message),
    ['缺少章节：2.5 功能按钮'],
  );
  assert.match(formatCheck(result), /未决事项/);
});

test('tables need a separator row and consistent columns; references must exist', async () => {
  const bad =
    complete +
    '\n\n## 3.1 数据查询\n| 字段 | 参照 |\n| --- | --- |\n| A | B | C |\n\n| 无分隔 | 行 |\n| x | y |\n见 3.9';
  const kinds = (await checkDocument(bad)).problems.map((p) => p.message);
  assert.ok(kinds.some((m) => /第 3 行列数/.test(m)));
  assert.ok(kinds.some((m) => /缺少表头分隔行/.test(m)));
  assert.ok(kinds.some((m) => /见 3.9/.test(m)));
  assert.ok(!kinds.some((m) => /见 3.1/.test(m)));
});

test('table and field references are verified against SAP definitions', async () => {
  const calls = [];
  const result = await checkDocument(complete + '\n取 EBAN-WERKS、EBAN-NOPE 和 ZZFAKE-COL', {
    verifyTable: async (t) => {
      calls.push(t);
      return t === 'EBAN' ? '{"fields":["BANFN","WERKS"]}' : null;
    },
  });
  assert.deepEqual(calls, ['EBAN', 'ZZFAKE']);
  assert.deepEqual(result.verified.unknownFields, ['EBAN-NOPE']);
  assert.deepEqual(result.verified.unknownTables, ['ZZFAKE']);
  assert.equal(result.ok, false);
});
