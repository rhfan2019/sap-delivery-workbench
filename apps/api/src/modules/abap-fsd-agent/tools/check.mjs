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
];

// TABLE-FIELD references such as EBAN-WERKS; ignores numbered ids like ISS-1.
const FIELD_REF = /\b([A-Z][A-Z0-9_]{2,15})-([A-Z][A-Z0-9_]{1,29})\b/g;

// Deterministic checks of a draft. `verifyTable(name)` (optional) resolves to the table's
// field definition text, or null when the table cannot be read.
export async function checkDocument(markdown, { verifyTable, maxTables = 30 } = {}) {
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

  const verified = { tables: 0, unknownTables: [], unknownFields: [] };
  if (verifyTable) {
    const fieldsByTable = new Map();
    for (const [, table, field] of markdown.matchAll(FIELD_REF)) {
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
