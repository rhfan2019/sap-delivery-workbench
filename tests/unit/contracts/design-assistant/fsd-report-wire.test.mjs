import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  toFsdWire,
  parseFsdWire,
  createFsdWireParser,
} from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-wire';
import { renderFsdMarkdown } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-render';
import { validateFsdReport } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report';

const fixture = (name) =>
  readFile(
    new URL(`../../../fixtures/design-assistant/fsd-report/${name}`, import.meta.url),
    'utf8',
  );
const isc001 = async () => JSON.parse(await fixture('isc001.json'));
// basis and rev are process data that the wire format does not carry.
const withoutProcessData = (doc) =>
  JSON.parse(JSON.stringify(doc, (k, v) => (k === 'basis' || k === 'rev' ? undefined : v)));
// Markdown equality up to table padding and blank lines (the fixture is Prettier-formatted).
const lines = (md) =>
  md
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^\|( ?:?-+:? ?\|)+$/, '|---|')
        .replace(/ ?\| ?/g, '|'),
    )
    .filter(Boolean);

test('WIRE-01 ISC001 survives JSON -> wire -> JSON without loss', async () => {
  const doc = await isc001();
  const { doc: parsed, errors } = parseFsdWire(toFsdWire(doc));
  assert.deepEqual(errors, []);
  assert.deepEqual(parsed, withoutProcessData(doc));
  assert.deepEqual(validateFsdReport(parsed), { ok: true, errors: [] });
});

test('WIRE-02 streamed in small chunks, objects arrive before the stream ends', async () => {
  const wire = toFsdWire(await isc001());
  const events = [];
  let pushed = 0;
  const parser = createFsdWireParser({ onEvent: (e) => events.push({ ...e, pushed }) });
  for (let i = 0; i < wire.length; i += 7) {
    parser.push(wire.slice(i, i + 7));
    pushed = i + 7;
  }
  const { doc, errors } = parser.end();
  assert.deepEqual(errors, []);
  assert.deepEqual(doc, parseFsdWire(wire).doc);
  const firstField = events.find((e) => e.path === '/selection_screen/fields/0');
  assert.equal(firstField.value.id, 'SEL-WERKS');
  assert.ok(
    firstField.pushed < wire.indexOf('## 输出布局'),
    'row emitted as soon as its line is complete',
  );
  const sections = events.filter((e) => e.type === 'section').map((e) => e.id);
  assert.equal(sections.length, 7);
  assert.equal(sections[0], 'LOG-QUERY');
});

test('WIRE-03 malformed lines are reported with line numbers and the rest still parses', () => {
  const wire = [
    '## 选择屏幕',
    '| 编号 | 屏幕字段 | P/S | 参照 | 必填 | 描述 | 默认值 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| SEL-WERKS | 工厂 | S | EBAN-WERKS | 是 | 工厂 |',
    '| SEL-MATNR | 物料 | S | EBAN-MATNR | 否 | 物料编号 | |',
    '这一行不符合任何格式',
    '## 不存在的部分',
    '## 消息',
    '| 编号 | 场景 | 类型 | 提示文本 | 处理 |',
    '| --- | --- | --- | --- | --- |',
    '| MSG-A | 场景 | E | 文本 \\| 含竖线<br>第二行 | 处理 |',
  ].join('\n');
  const { doc, errors } = parseFsdWire(wire);
  assert.deepEqual(
    errors.map((e) => e.line),
    [4, 6, 7],
  );
  assert.deepEqual(doc.selection_screen.fields, [
    {
      id: 'SEL-MATNR',
      label: '物料',
      kind: 'S',
      ref: 'EBAN-MATNR',
      required: false,
      description: '物料编号',
    },
  ]);
  assert.equal(doc.messages.items[0].text, '文本 | 含竖线\n第二行');
});

test('WIRE-04 list items keep indented sub-steps; bullet blocks are unordered', () => {
  const wire = [
    '## 逻辑 LOG-A 审批',
    '触发：点击审批。',
    'SAP对象：BAPI BAPI_PR_CHANGE；TABLE EBAN',
    '### BLK-A-RULES 规则',
    '1. 第一步：',
    '   1. 子步骤一；',
    '',
    '   2. 子步骤二。',
    '2. 第二步。',
    '### BLK-A-RESULT 结果反馈',
    '- 见 [[LOG-A]]。',
  ].join('\n');
  const { doc, errors } = parseFsdWire(wire);
  assert.deepEqual(errors, []);
  const [section] = doc.logic.sections;
  assert.deepEqual(section.sap_refs, [
    { type: 'BAPI', name: 'BAPI_PR_CHANGE' },
    { type: 'TABLE', name: 'EBAN' },
  ]);
  assert.deepEqual(section.blocks[0].items, [
    '第一步：\n   1. 子步骤一；\n   2. 子步骤二。',
    '第二步。',
  ]);
  assert.equal(section.blocks[0].ordered, undefined);
  assert.equal(section.blocks[1].ordered, false);
});

test('RENDER-01 ISC001 renders to the reviewed standard sample', async () => {
  assert.deepEqual(lines(renderFsdMarkdown(await isc001())), lines(await fixture('isc001.md')));
});

test('RENDER-02 rendered document carries no object ids or raw references', async () => {
  const md = renderFsdMarkdown(await isc001());
  assert.doesNotMatch(md, /\[\[|\b(LOG|BLK|MSG|SEL|OUT|AUTH|AN|CHK|ACT|SEC|ISS|EV)-[A-Z0-9]/);
  assert.match(md, /各类校验失败的消息类型与提示文本见 3\.8。/);
});
