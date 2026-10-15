import { splitSections } from '../artifacts.mjs';

// Static checks of generated ABAP (decision section 7). Only problems that are certain are
// reported: a false alarm would steer the model wrong. Text-level only, no ABAP parser:
// comments and string contents are masked first, then statements are matched by keyword.

// Per line: `code` without the comment (literals intact) and `bare` with literal contents
// blanked, so keywords inside strings never match.
export function lexLines(source) {
  return source.split('\n').map((raw) => {
    if (raw.startsWith('*')) return { raw, code: '', bare: '', comment: raw };
    let code = '',
      bare = '',
      quote = null;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) {
        code += ch;
        if (ch === quote) {
          if (quote === "'" && raw[i + 1] === "'") {
            code += raw[++i];
            bare += '  ';
            continue;
          }
          quote = null;
          bare += ch;
        } else bare += ' ';
      } else if (ch === '"') return { raw, code, bare, comment: raw.slice(i) };
      else {
        if (ch === "'" || ch === '`' || ch === '|') quote = ch;
        code += ch;
        bare += ch;
      }
    }
    return { raw, code, bare, comment: '' };
  });
}

// Statements of the masked source with the line each starts on.
export function statements(lines) {
  const out = [];
  let text = '',
    start = 0,
    raw = '';
  lines.forEach((l, i) => {
    for (let k = 0; k < l.bare.length; k++) {
      const ch = l.bare[k];
      if (!text.trim()) start = i + 1;
      if (ch === '.') {
        if (text.trim()) out.push({ text: text.trim(), raw: raw.trim(), line: start });
        text = '';
        raw = '';
      } else {
        text += ch;
        raw += l.code[k];
      }
    }
    text += ' ';
    raw += ' ';
  });
  if (text.trim()) out.push({ text: text.trim(), raw: raw.trim(), line: start, open: true });
  return out;
}

const OPENERS = {
  IF: 'ENDIF',
  LOOP: 'ENDLOOP',
  DO: 'ENDDO',
  WHILE: 'ENDWHILE',
  CASE: 'ENDCASE',
  TRY: 'ENDTRY',
  METHOD: 'ENDMETHOD',
  FORM: 'ENDFORM',
  MODULE: 'ENDMODULE',
  CLASS: 'ENDCLASS',
};
const CLOSERS = new Set(Object.values(OPENERS));
const EVENTS =
  /^(INITIALIZATION|START-OF-SELECTION|END-OF-SELECTION|AT\s+SELECTION-SCREEN|AT\s+LINE-SELECTION|AT\s+USER-COMMAND|TOP-OF-PAGE|LOAD-OF-PROGRAM|CLASS|FORM|MODULE)\b/i;
const LOCAL_NAME = /^(?:[lgiecr][vstor]_|t[ysty]_|lcl_|lif_|sy$|syst$|abap$)/i;

const firstWord = (s) => (/^([A-Z][A-Z0-9_-]*)/i.exec(s)?.[1] ?? '').toUpperCase();

function blockProblems(stmts) {
  const problems = [],
    stack = [];
  for (const s of stmts) {
    const word = firstWord(s.text);
    if (word === 'CLASS' && !/\b(DEFINITION|IMPLEMENTATION)\b/i.test(s.text)) continue;
    if (word === 'CLASS' && /\b(DEFERRED|LOAD)\b/i.test(s.text)) continue;
    if (OPENERS[word]) stack.push({ word, line: s.line });
    else if (CLOSERS.has(word)) {
      const top = stack.pop();
      if (!top || OPENERS[top.word] !== word)
        problems.push({
          rule: 'block',
          line: s.line,
          message: top
            ? `第 ${top.line} 行的 ${top.word} 与第 ${s.line} 行的 ${word} 不配对。`
            : `第 ${s.line} 行的 ${word} 没有对应的开始语句。`,
        });
    }
  }
  for (const top of stack)
    problems.push({
      rule: 'block',
      line: top.line,
      message: `第 ${top.line} 行的 ${top.word} 没有对应的 ${OPENERS[top.word]}，代码可能被截断。`,
    });
  const last = stmts.at(-1);
  if (last?.open)
    problems.push({
      rule: 'block',
      line: last.line,
      message: `第 ${last.line} 行起的语句没有以句点结束，代码可能被截断。`,
    });
  return problems;
}

function initializationProblems(stmts) {
  const problems = [];
  let inside = false;
  for (const s of stmts) {
    if (/^INITIALIZATION$/i.test(s.text)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (EVENTS.test(s.text)) inside = false;
    else if (!/NEW\s+lcl_report\b|CREATE\s+OBJECT|->\s*initialize\s*\(/i.test(s.text))
      problems.push({
        rule: 'initialization',
        line: s.line,
        message: `第 ${s.line} 行：INITIALIZATION 中只允许创建 lcl_report 对象和调用 initialize( )，默认值等逻辑应放进 initialize 方法。`,
      });
  }
  return problems;
}

function sqlProblems(stmts) {
  const problems = [];
  for (const s of stmts) {
    if (/\bFOR\s+ALL\s+ENTRIES\b/i.test(s.text))
      problems.push({
        rule: 'for_all_entries',
        line: s.line,
        message: `第 ${s.line} 行使用了 FOR ALL ENTRIES，规范禁止，请改用 JOIN 或 CTE。`,
      });
    if (/\bSELECT\s+(SINGLE\s+)?\*|\bFIELDS\s+\*|\w~\*/i.test(s.text))
      problems.push({
        rule: 'select_star',
        line: s.line,
        message: `第 ${s.line} 行读取了全部字段（SELECT * 或 表~*），请只列出需要的字段。`,
      });
    for (const m of s.text.matchAll(/(?:^|\(\s*)SELECT(?![-\w])\s+(?:SINGLE\s+)?(\S+)/gi))
      if (m[1].toUpperCase() !== 'FROM')
        problems.push({
          rule: 'sql_syntax',
          line: s.line,
          message: `第 ${s.line} 行是旧式 SQL：应写成 SELECT FROM … FIELDS … WHERE … INTO …。`,
        });
    if (/^AT\s+NEW\b/i.test(s.text))
      problems.push({
        rule: 'at_new',
        line: s.line,
        message: `第 ${s.line} 行使用了 AT NEW，分组请用 LOOP AT … GROUP BY。`,
      });
    if (/^TYPES\b/i.test(s.text))
      for (const m of s.text.matchAll(
        /\b(?:TYPES:?(?:\s+BEGIN\s+OF)?|BEGIN\s+OF|END\s+OF)\s+([a-z_]\w*)/gi,
      ))
        if (/^[gl][a-z]?_/i.test(m[1]) && !/^(?:BEGIN|END)$/i.test(m[1]))
          problems.push({
            rule: 'types_prefix',
            line: s.line,
            message: `第 ${s.line} 行的类型名 ${m[1]} 带了作用域前缀，类型应命名为 ty_ / ts_ / tt_。`,
          });
  }
  return problems;
}

function authorityProblems(stmts) {
  const problems = [];
  const options = new Set();
  for (const s of stmts)
    if (/^SELECT-OPTIONS\b/i.test(s.text))
      for (const m of s.text.matchAll(/(?:SELECT-OPTIONS:?|,)\s*(\w+)\s+FOR\b/gi))
        options.add(m[1].toLowerCase());
  for (const s of stmts)
    if (/iv_auth_field\s*=\s*'ACTVT'/i.test(s.raw))
      problems.push({
        rule: 'auth_field',
        line: s.line,
        message: `第 ${s.line} 行：check_authority 的 iv_auth_field 应为业务字段（如 'EKORG'），活动字段由 iv_actvt_field 指定。`,
      });
  for (const name of options) {
    const shadow = name + '1';
    if (!options.has(shadow)) continue;
    const filled = stmts.some((s) =>
      new RegExp(`ct_sel_opt\\s*=\\s*${shadow}\\b`, 'i').test(s.text),
    );
    if (!filled)
      problems.push({
        rule: 'shadow',
        line: 0,
        message: `定义了影子范围表 ${shadow}，但没有用 check_authority 的 ct_sel_opt 填充它。`,
      });
    for (const s of stmts)
      if (
        /\bSELECT\b|\bWITH\b/i.test(s.text) &&
        new RegExp(`IN\\s+@?${name}\\b(?!1)`, 'i').test(s.text)
      )
        problems.push({
          rule: 'shadow',
          line: s.line,
          message: `第 ${s.line} 行的查询绑定了 ${name}，应绑定权限检查后的影子范围表 ${shadow}。`,
        });
  }
  return problems;
}

// Text symbols in the code against the plan's text element table (plan section 3.2).
function textProblems(lines, plan) {
  const problems = [];
  const texts = new Map(); // id -> { texts:Set, line }
  lines.forEach((l, i) => {
    for (const m of l.code.matchAll(/'((?:[^']|'')*)'\(([a-z0-9]{3})\)/gi)) {
      const id = m[2].toLowerCase();
      if (!texts.has(id)) texts.set(id, { texts: new Set(), line: i + 1 });
      texts.get(id).texts.add(m[1]);
    }
    for (const m of l.bare.matchAll(/\bTEXT-([a-z0-9]{3})\b/gi)) {
      const id = m[1].toLowerCase();
      if (!texts.has(id)) texts.set(id, { texts: new Set(), line: i + 1 });
    }
  });
  for (const [id, t] of texts)
    if (t.texts.size > 1)
      problems.push({
        rule: 'text_symbol',
        line: t.line,
        message: `文本符号 ${id} 对应了不同的文字（${[...t.texts].join(' / ')}），同一编号只能用于一段文字。`,
      });
  if (plan.trim()) {
    const section = splitSections(plan).find((s) => /文本元素/.test(s.heading));
    const listed = new Set(
      (section?.body ?? '')
        .split('\n')
        .filter((r) => /^\s*\|/.test(r))
        .map((r) =>
          r
            .split('|')[1]
            ?.replace(/[`\s]/g, '')
            .replace(/^TEXT-/i, '')
            .toLowerCase(),
        ),
    );
    const missing = [...texts.keys()].filter((id) => !listed.has(id));
    if (missing.length)
      problems.push({
        rule: 'text_symbol',
        line: texts.get(missing[0]).line,
        message: `文本符号 ${missing.join('、')} 没有列入开发方案“文本元素”一节。`,
      });
  }
  return problems;
}

function placeholderProblems(lines) {
  const problems = [];
  lines.forEach((l, i) => {
    if (/^\s*"!/.test(l.raw))
      problems.push({
        rule: 'abap_doc',
        line: i + 1,
        message: `第 ${i + 1} 行是 ABAP Doc（"!），规范要求类定义只用单行注释。`,
      });
    if (/(^|\s)(\.\.\.|…)(\s|$)/.test(l.bare))
      problems.push({
        rule: 'placeholder',
        line: i + 1,
        message: `第 ${i + 1} 行有省略号占位，代码必须完整。`,
      });
  });
  return problems;
}

const fieldsOf = (definition) =>
  new Set(
    definition
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/)[0]?.toUpperCase())
      .filter(Boolean),
  );

// Tables after FROM/JOIN must exist; explicit table-field references on real tables must
// name existing fields. Local types, structures and CTEs are never checked.
async function ddicProblems(stmts, verifyTable, maxTables) {
  const problems = [];
  const tables = new Map(); // name -> first line
  const aliases = new Map();
  const refs = []; // { table, field, line }
  for (const s of stmts) {
    if (/\b(SELECT|WITH)\b/i.test(s.text)) {
      for (const m of s.text.matchAll(/\b(?:FROM|JOIN)\s+([a-z][\w/]*)(?:\s+AS\s+(\w+))?/gi)) {
        const name = m[1].toUpperCase();
        if (!tables.has(name)) tables.set(name, s.line);
        if (m[2]) aliases.set(m[2].toUpperCase(), name);
      }
      for (const m of s.text.matchAll(/(?<![+@\w])([a-z]\w*)~([a-z]\w*)\b/gi))
        refs.push({ table: m[1].toUpperCase(), field: m[2].toUpperCase(), line: s.line });
    }
    for (const m of s.text.matchAll(/\b(?:TYPE|LIKE|FOR)\s+([a-z][\w/]*)-([a-z]\w*)\b/gi))
      if (!LOCAL_NAME.test(m[1]))
        refs.push({ table: m[1].toUpperCase(), field: m[2].toUpperCase(), line: s.line });
  }
  const names = [
    ...new Set([...tables.keys(), ...refs.map((r) => aliases.get(r.table) ?? r.table)]),
  ]
    .filter((n) => !LOCAL_NAME.test(n))
    .slice(0, maxTables);
  const definitions = new Map();
  for (const name of names) definitions.set(name, await verifyTable(name).catch(() => undefined));
  for (const [name, line] of tables)
    if (definitions.get(name) === null)
      problems.push({
        rule: 'ddic',
        line,
        message: `第 ${line} 行的表 ${name} 在 SAP 中不存在。`,
      });
  const reported = new Set();
  for (const r of refs) {
    const table = aliases.get(r.table) ?? r.table;
    const definition = definitions.get(table);
    if (!definition) continue;
    const key = `${table}-${r.field}`;
    if (!fieldsOf(definition).has(r.field) && !reported.has(key)) {
      reported.add(key);
      problems.push({
        rule: 'ddic',
        line: r.line,
        message: `第 ${r.line} 行的字段 ${key} 在 SAP 中不存在。`,
      });
    }
  }
  return problems;
}

export async function checkCode(code, { plan = '', verifyTable, maxTables = 30 } = {}) {
  if (!code.trim()) return [];
  const lines = lexLines(code);
  const stmts = statements(lines);
  const problems = [
    ...(!plan.trim()
      ? [{ rule: 'plan', line: 0, message: '开发方案为空：应先写开发方案，再写代码。' }]
      : []),
    ...blockProblems(stmts),
    ...placeholderProblems(lines),
    ...initializationProblems(stmts),
    ...sqlProblems(stmts),
    ...authorityProblems(stmts),
    ...textProblems(lines, plan),
    ...(verifyTable ? await ddicProblems(stmts, verifyTable, maxTables) : []),
  ];
  return problems.sort((a, b) => a.line - b.line);
}

export function formatCheck(problems) {
  if (!problems.length) return '自动校验：未发现问题。';
  return (
    `自动校验发现 ${problems.length} 个问题：\n` +
    problems.map((p, i) => `${i + 1}. ${p.message}`).join('\n') +
    '\n能改的请直接修改；改不好的列入开发方案的未决事项。'
  );
}
