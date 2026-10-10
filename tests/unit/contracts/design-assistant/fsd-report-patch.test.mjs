import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseFsdWire,
  toFsdWire,
} from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-wire';
import {
  mergeFsdPatch,
  orderSections,
} from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-patch';
import { validateFsdReport } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report';

const isc001 = async () =>
  JSON.parse(
    await readFile(
      new URL('../../../fixtures/design-assistant/fsd-report/isc001.json', import.meta.url),
      'utf8',
    ),
  );

test('WIRE-05 prompt V2 constructs: thought, basis, outline, deletions, analysis tables', () => {
  const wire = [
    '> 思路：先列出逻辑章节与消息。',
    '## 提纲',
    '| 编号 | 类型 | 标题 | 摘要 |',
    '| --- | --- | --- | --- |',
    '| LOG-QUERY | 逻辑 | 数据查询 | EBAN 取数 |',
    '## 选择屏幕',
    '| 编号 | 屏幕字段 | P/S | 参照 | 必填 | 描述 | 默认值 | 依据 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| SEL-WERKS | 工厂 | S | EBAN-WERKS | 是 | 工厂 |  | 客户：Q1、requirement |',
    '| SEL-MATNR | 物料 | S | EBAN-MATNR | 否 | 物料 |  | 系统：EV-001 |',
    '| SEL-BADAT | 创建日期 | S | EBAN-BADAT | 否 | 日期 |  | 推断 |',
    '## 逻辑 LOG-QUERY 数据查询',
    '依据：推断',
    '### BLK-QUERY-FETCH 取数逻辑',
    '1. 从 EBAN 取数。',
    '## 生命周期分析',
    '| 编号 | 环节 | 事务代码 | 业务动作 | 对本功能的影响 | 处理结论 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| LC-CREATE | 创建 | MD01 | MRP 生成采购申请 | 进入清单 | 纳入 |',
    '## 反向审查',
    '| 编号 | 审查对象 | 反例场景 | 业务影响 | 处理 | 状态 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| RV-OVERALL | LOG-QUERY | 整单审批只勾部分行 | 误审批 | 增加确认弹窗 | FIXED |',
    '## 删除',
    '- OUT-OLD',
  ].join('\n');
  const { doc, errors, outline, deletions, thoughts } = parseFsdWire(wire);
  assert.deepEqual(errors, []);
  assert.deepEqual(thoughts, ['先列出逻辑章节与消息。']);
  assert.deepEqual(outline, [
    { id: 'LOG-QUERY', type: '逻辑', title: '数据查询', summary: 'EBAN 取数' },
  ]);
  assert.deepEqual(deletions, ['OUT-OLD']);
  assert.deepEqual(
    doc.selection_screen.fields.map((f) => f.basis),
    [
      { kind: 'CUSTOMER_DECISION', refs: ['answer:Q1', 'requirement'] },
      { kind: 'FACT', refs: ['EV-001'] },
      { kind: 'INFERENCE' },
    ],
  );
  assert.deepEqual(doc.logic.sections[0].basis, { kind: 'INFERENCE' });
  assert.equal(doc.working.lifecycle[0].decision, '纳入');
  assert.equal(doc.working.reverse_review[0].status, 'FIXED');
  // basis survives the way back to the wire
  const again = parseFsdWire(toFsdWire(doc, { parts: ['selection_screen', 'sections'] }));
  assert.deepEqual(again.doc.selection_screen.fields, doc.selection_screen.fields);
  assert.deepEqual(again.doc.logic.sections, doc.logic.sections);
});

test('PATCH-01 a revision changes only the rows and sections it restates', async () => {
  const base = mergeFsdPatch(await isc001(), {}).doc;
  const revision = parseFsdWire(
    [
      '## 输出布局',
      '| 编号 | 字段 | 参照 | 字段描述 | 处理 |',
      '| --- | --- | --- | --- | --- |',
      '| OUT-MENGE | MENGE | EBAN-MENGE | 需求数量（可改为 0 删除） | 可修改 |',
      '| OUT-PRIO | PRIO | EBAN-PRIO_URG | 紧急程度 | 显示 |',
    ].join('\n'),
  );
  const { doc, changed } = mergeFsdPatch(base, revision.doc, revision.deletions);
  assert.deepEqual(changed.sort(), ['OUT-MENGE', 'OUT-PRIO']);
  const field = (id) => doc.output.fields.find((f) => f.id === id);
  assert.equal(field('OUT-MENGE').rev, 2);
  assert.equal(field('OUT-PRIO').rev, 1);
  assert.equal(field('OUT-BANFN').rev, undefined, 'untouched rows keep their content and rev');
  assert.deepEqual(doc.logic.sections, base.logic.sections);
  assert.deepEqual(doc.requirement.goals, base.requirement.goals, 'absent lists are kept');
  assert.equal(doc.output.fields.at(-1).id, 'OUT-PRIO', 'new rows are appended');
});

test('PATCH-02 a restated logic section replaces the whole section; deletions remove objects', async () => {
  const base = await isc001();
  const fragment = parseFsdWire(
    [
      '## 逻辑 LOG-NAVIGATION 界面跳转',
      '### BLK-NAV-RULES 规则',
      '1. 双击任意栏位跳转至 `ME53N`。',
      '## 删除',
      '- MSG-DONE',
      '- BLK-QUERY-OUTPUT',
    ].join('\n'),
  );
  const { doc, changed } = mergeFsdPatch(base, fragment.doc, fragment.deletions);
  const nav = doc.logic.sections.find((s) => s.id === 'LOG-NAVIGATION');
  assert.deepEqual(nav.blocks[0].items, ['双击任意栏位跳转至 `ME53N`。']);
  assert.equal(nav.sap_refs, undefined, 'a restated section is replaced, not merged');
  assert.equal(
    doc.logic.sections.findIndex((s) => s.id === 'LOG-NAVIGATION'),
    6,
  );
  assert.ok(!doc.messages.items.some((m) => m.id === 'MSG-DONE'));
  const query = doc.logic.sections.find((s) => s.id === 'LOG-QUERY');
  assert.ok(!query.blocks.some((b) => b.id === 'BLK-QUERY-OUTPUT'));
  assert.deepEqual(changed.sort(), ['BLK-QUERY-OUTPUT', 'LOG-NAVIGATION', 'MSG-DONE']);
});

test('PATCH-03 a document assembled part by part equals the sample, in outline order', async () => {
  const sample = await isc001();
  const strip = (d) =>
    JSON.parse(JSON.stringify(d, (k, v) => (k === 'rev' || k === 'basis' ? undefined : v)));
  let doc = { ...parseFsdWire('').doc, doc: sample.doc, target: sample.target };
  const sections = sample.logic.sections.map((s) => 'section:' + s.id).reverse();
  for (const parts of [
    ['overview', 'requirement'],
    ['authorizations', 'selection_screen', 'selection_checks', 'output', 'actions', 'logic'],
    ...sections.map((s) => [s]),
    ['messages', 'open_issues', 'evidence'],
  ])
    doc = mergeFsdPatch(doc, parseFsdWire(toFsdWire(sample, { parts })).doc).doc;
  const outline = sample.logic.sections.map((s) => ({ id: s.id, type: '逻辑' }));
  doc = orderSections(doc, outline);
  assert.deepEqual(strip(doc), strip(sample));
  assert.deepEqual(validateFsdReport(doc), { ok: true, errors: [] });
});
