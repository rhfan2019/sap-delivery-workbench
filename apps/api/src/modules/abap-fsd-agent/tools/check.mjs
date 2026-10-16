import { splitSections } from '../document.mjs';

// Sections the delivery format requires (system prompt part 8), matched loosely by title.
export const REQUIRED_SECTIONS = [
  ['1.1', '开发概览'],
  ['1.2', '业务需求描述'],
  ['2.1', '权限校验'],
  ['2.2', '选择屏幕'],
  ['2.3', '选择屏幕检查'],
  ['2.4', '输出布局'],
  ['2.5', '功能按钮'],
  ['3', '业务逻辑'],
  ['', '消息与异常处理'],
  ['附录 A', '未决事项'],
  ['附录 B', '生命周期分析'],
  ['附录 C', '反向审查'],
  ['附录 D', '测试案例'],
];

// Appendix D (system prompt part 8) is parsed by the development and test agents, so its
// subsections, column names and cell vocabularies are fixed.
export const TEST_SUBSECTIONS = [
  ['D.1', '测试范围'],
  ['D.2', '测试数据'],
  ['D.3', '测试案例'],
  ['D.4', '未覆盖'],
];
export const TEST_DATA_COLUMNS = [
  '数据编号',
  '对象',
  '单据号',
  '数据特征',
  '核实条件',
  '来源',
  '核实时间',
];
export const TEST_CASE_COLUMNS = [
  '编号',
  '场景',
  '维度',
  '类型',
  '测试数据',
  '操作',
  '预期结果',
  '对应条款',
  '优先级',
];
const SOURCES = ['系统已有', '本次新建', '未找到'];
const DIMENSIONS = ['生命周期', '颗粒度', '粒度', '状态', '取数', '权限', '消息'];
const CASE_KINDS = ['正向', '排除', '边界', '异常'];
const NONE = /^(—|-|–|无)?$/;

// TABLE-FIELD references such as EBAN-WERKS; ignores numbered ids like ISS-1.
const FIELD_REF = /\b([A-Z][A-Z0-9_]{2,15})-([A-Z][A-Z0-9_]{1,29})\b/g;

// Deterministic checks of a draft. `verifyTable(name)` (optional) resolves to the table's
// field definition text, or null when the table cannot be read. `seenInSap(value)`
// (optional) tells whether a document number occurred in this session's SAP results.
// `ignoreRefs` lists names that look like TABLE-FIELD but are not, e.g. the system code.
// `verifiedBetween` ([from, to], YYYY-MM-DD) bounds the dates test data can have been checked.
export async function checkDocument(
  markdown,
  { verifyTable, seenInSap, ignoreRefs = [], verifiedBetween, maxTables = 30 } = {},
) {
  const problems = [];
  const sections = splitSections(markdown);
  const headings = sections.map((s) => s.heading);
  for (const [number, title] of REQUIRED_SECTIONS)
    if (!headings.some((h) => h.includes(title) && (!number || h.includes(number))))
      problems.push({ kind: 'missing_section', message: `缺少章节：${number} ${title}`.trim() });

  for (const section of sections) {
    const lines = section.body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*\|/.test(lines[i]) || (i > 0 && /^\s*\|/.test(lines[i - 1]))) continue;
      const table = [];
      for (let j = i; j < lines.length && /^\s*\|/.test(lines[j]); j++) table.push(lines[j]);
      const width = cells(table[0]).length;
      if (table.length < 2 || !/^\s*\|[\s:|-]+\|\s*$/.test(table[1]))
        problems.push({ kind: 'table', message: `「${section.heading}」中的表格缺少表头分隔行。` });
      const bad = table.findIndex((row, n) => n > 1 && cells(row).length !== width);
      if (bad > 0)
        problems.push({
          kind: 'table',
          message: `「${section.heading}」中的表格第 ${bad + 1} 行列数与表头不一致。`,
        });
    }
  }

  const numbers = new Set(headings.map((h) => /^(\d+(?:\.\d+)*)\b/.exec(h)?.[1]).filter(Boolean));
  for (const match of markdown.matchAll(/见\s*(\d+(?:\.\d+)+)/g))
    if (!numbers.has(match[1]))
      problems.push({ kind: 'reference', message: `引用了不存在的章节：见 ${match[1]}` });
  problems.push(...checkTestCases(sections, numbers, seenInSap, verifiedBetween));

  const verified = { tables: 0, unknownTables: [], unknownFields: [] };
  if (verifyTable) {
    const fieldsByTable = new Map();
    for (const [ref, table, field] of markdown.matchAll(FIELD_REF)) {
      if (ignoreRefs.some((name) => String(name).toUpperCase().includes(ref))) continue;
      if (!fieldsByTable.has(table)) fieldsByTable.set(table, new Set());
      fieldsByTable.get(table).add(field);
    }
    for (const [table, fields] of [...fieldsByTable].slice(0, maxTables)) {
      const definition = await verifyTable(table);
      if (definition === null) {
        verified.unknownTables.push(table);
        continue;
      }
      verified.tables++;
      const upper = definition.toUpperCase();
      for (const field of fields)
        if (!new RegExp(`\\b${field}\\b`).test(upper))
          verified.unknownFields.push(`${table}-${field}`);
    }
    if (verified.unknownTables.length)
      problems.push({
        kind: 'sap_object',
        message: `SAP 中未能读取这些表（可能不存在或名称错误）：${verified.unknownTables.join('、')}`,
      });
    if (verified.unknownFields.length)
      problems.push({
        kind: 'sap_object',
        message: `这些字段在表定义中未找到：${verified.unknownFields.join('、')}`,
      });
  }
  return { ok: problems.length === 0, problems, verified };
}

function checkTestCases(sections, numbers, seenInSap, verifiedBetween) {
  const appendix = sections.find((s) => /附录\s*D/.test(s.heading));
  if (!appendix) return [];
  const parts = sections.filter((s) => /^D\.\d/.test(s.heading));
  if (!parts.length)
    return /无需测试案例/.test(appendix.body) && appendix.body.length >= 20
      ? []
      : [
          {
            kind: 'test_case',
            message:
              '附录 D 缺少 D.1～D.4 小节；确实不需要测试案例时，写明“无需测试案例”及具体原因。',
          },
        ];
  const problems = [];
  const add = (message) => problems.push({ kind: 'test_case', message });
  const part = (number) => parts.find((s) => s.heading.startsWith(number));
  for (const [number, title] of TEST_SUBSECTIONS)
    if (!part(number)?.heading.includes(title)) add(`附录 D 缺少小节：${number} ${title}`);

  const data = tableOf(part('D.2'), TEST_DATA_COLUMNS, 'D.2 测试数据', add);
  const dataIds = new Set();
  const unverified = [];
  for (const row of data ?? []) {
    const [id, , number, , condition, source, checkedOn] = row;
    if (!/^TD-\d+$/.test(id)) add(`D.2 的数据编号“${id}”应写成 TD-01 的形式。`);
    else if (dataIds.has(id)) add(`D.2 的数据编号 ${id} 重复。`);
    dataIds.add(id);
    if (!SOURCES.includes(source)) add(`D.2 ${id} 的来源“${source}”应为：${SOURCES.join('、')}。`);
    if (source !== '未找到' && NONE.test(number)) add(`D.2 ${id} 来源为“${source}”但没有单据号。`);
    if (NONE.test(condition)) add(`D.2 ${id} 没有写核实条件。`);
    if (
      verifiedBetween &&
      source !== '未找到' &&
      !(
        /^\d{4}-\d{2}-\d{2}$/.test(checkedOn) &&
        checkedOn >= verifiedBetween[0] &&
        checkedOn <= verifiedBetween[1]
      )
    )
      add(`D.2 ${id} 的核实时间“${checkedOn}”应为实际查询的日期（会话事实中的日期，YYYY-MM-DD）。`);
    if (seenInSap && source !== '未找到')
      for (const token of documentNumbers(number))
        if (!seenInSap(token)) unverified.push(`${id} ${token}`);
  }
  if (unverified.length)
    add(
      `这些单据号没有在本会话的 SAP 查询结果中出现：${unverified.join('、')}。` +
        '请用 runQuery 查到后再写；查不到时来源写“未找到”、单据号写“—”。',
    );

  const cases = tableOf(part('D.3'), TEST_CASE_COLUMNS, 'D.3 测试案例', add);
  if (cases && !cases.length) add('D.3 没有测试案例。');
  const caseIds = new Set();
  for (const row of cases ?? []) {
    const [id, , dimension, kind, dataRef, , expected, clauses, priority] = row;
    if (!/^TC-\d+$/.test(id)) add(`D.3 的编号“${id}”应写成 TC-01 的形式。`);
    else if (caseIds.has(id)) add(`D.3 的编号 ${id} 重复。`);
    caseIds.add(id);
    const dims = dimension.split(/[、,，/／\s]+/).filter(Boolean);
    if (!dims.length || dims.some((d) => !DIMENSIONS.includes(d)))
      add(`D.3 ${id} 的维度“${dimension}”应为：生命周期、颗粒度、状态、取数、权限、消息。`);
    if (!CASE_KINDS.some((k) => kind.startsWith(k)))
      add(`D.3 ${id} 的类型“${kind}”应为：${CASE_KINDS.join('、')}。`);
    if (!NONE.test(dataRef)) {
      const refs = dataRef.match(/TD-\d+/g) ?? [];
      if (!refs.length) add(`D.3 ${id} 的测试数据应写 D.2 的数据编号，不需要数据时写“—”。`);
      for (const ref of refs)
        if (!dataIds.has(ref)) add(`D.3 ${id} 引用了不存在的测试数据 ${ref}。`);
    }
    if (NONE.test(expected) || /^(结果正确|符合预期|正确|正常)。?$/.test(expected))
      add(`D.3 ${id} 的预期结果要写成可核对的事实。`);
    const refs = clauses.match(/\d+(?:\.\d+)+|\b\d+\b/g) ?? [];
    if (!refs.length) add(`D.3 ${id} 没有写对应的正文条款。`);
    for (const ref of refs) if (!numbers.has(ref)) add(`D.3 ${id} 对应了不存在的章节 ${ref}。`);
    if (!/^P[123]$/.test(priority)) add(`D.3 ${id} 的优先级“${priority}”应为 P1、P2 或 P3。`);
  }
  return problems;
}

// Rows (as trimmed cells) of the first table in `section`, or null after reporting why
// the table cannot be read. Width mismatches are reported by the generic table check.
function tableOf(section, columns, label, add) {
  if (!section) return null;
  const lines = section.body.split('\n');
  const start = lines.findIndex((l) => /^\s*\|/.test(l));
  if (start < 0) {
    add(`${label} 缺少表格。`);
    return null;
  }
  const rows = [];
  for (let i = start; i < lines.length && /^\s*\|/.test(lines[i]); i++)
    rows.push(cells(lines[i]).map((c) => c.trim()));
  if (rows[0].join('|') !== columns.join('|')) {
    add(`${label} 的表头应为：${columns.join(' | ')}`);
    return null;
  }
  return rows.slice(2).filter((r) => r.length === columns.length);
}

// Document numbers in a D.2 cell, e.g. "4381" (leading zeros dropped) or "4500000012/00010";
// one- and two-digit tokens such as item numbers cannot identify a document and are left out.
function documentNumbers(cell) {
  if (NONE.test(cell)) return [];
  return (cell.replace(/`/g, '').match(/[A-Z0-9]+/gi) ?? []).filter(
    (t) => t.length >= 3 && /\d/.test(t),
  );
}

// Document numbers already recorded in the D.2 table of `markdown`; a previous version's
// numbers were checked when they were written.
export function testDataNumbers(markdown) {
  const section = splitSections(markdown).find((s) => /^D\.2\b/.test(s.heading));
  const rows = tableOf(section, TEST_DATA_COLUMNS, '', () => {}) ?? [];
  return rows.flatMap((r) => documentNumbers(r[2]));
}

// True when `number` occurs in `text` as a whole value, ignoring leading zeros on either side.
export function containsDocumentNumber(text, number) {
  const bare = String(number)
    .toUpperCase()
    .replace(/^0+(?=.)/, '');
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![0-9A-Z])0*${escaped}(?![0-9A-Z])`).test(String(text).toUpperCase());
}

function cells(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/);
}

export function formatCheck(result) {
  if (result.ok) return '自动校验通过。';
  return (
    '自动校验发现以下问题（能改的请修改，改不好的列入附录 A 未决事项）：\n' +
    result.problems.map((p, i) => `${i + 1}. ${p.message}`).join('\n')
  );
}
