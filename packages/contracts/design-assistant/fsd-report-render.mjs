// Renders an fsd-report/1 document as the delivered Markdown layout (ISC001 style).
// Pure and browser-safe. Object ids never appear in the output: [[ID]] references
// are resolved to section numbers or field names here.
import { RESERVED_SECTIONS } from './fsd-report-refs.mjs';

const FIXED_SECTIONS = {
  'SEC-OVERVIEW': '1.1',
  'SEC-REQUIREMENT': '1.2',
  'SEC-AUTH': '2.1',
  'SEC-SELECTION': '2.2',
  'SEC-CHECKS': '2.3',
  'SEC-OUTPUT': '2.4',
  'SEC-ACTIONS': '2.5',
};

/** id -> display text used when the id is referenced as [[ID]]. */
export function referenceLabels(doc) {
  const labels = new Map(Object.entries(FIXED_SECTIONS));
  const sections = doc.logic?.sections ?? [];
  const messagesNo = `3.${sections.length + 1}`;
  labels.set('SEC-MESSAGES', messagesNo);
  sections.forEach((section, i) => {
    labels.set(section.id, `3.${i + 1}`);
    for (const block of section.blocks ?? []) labels.set(block.id, `3.${i + 1}`);
  });
  for (const m of doc.messages?.items ?? []) labels.set(m.id, messagesNo);
  for (const a of doc.authorizations?.items ?? []) labels.set(a.id, '2.1');
  for (const n of doc.authorizations?.notes ?? []) labels.set(n.id, '2.1');
  for (const c of doc.selection_checks?.items ?? []) labels.set(c.id, '2.3');
  for (const a of doc.actions?.items ?? []) labels.set(a.id, '2.5');
  for (const f of doc.selection_screen?.fields ?? []) labels.set(f.id, f.label);
  for (const f of doc.output?.fields ?? []) labels.set(f.id, f.name);
  for (const id of RESERVED_SECTIONS) if (!labels.has(id)) labels.set(id, id);
  return labels;
}

const cell = (text) =>
  String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
const table = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
const ordered = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');
const bullets = (items) => items.map((item) => `- ${item}`).join('\n');
const date = (iso) => iso.replaceAll('-', '/');

export function renderFsdMarkdown(doc) {
  const labels = referenceLabels(doc);
  const r = (text) =>
    String(text ?? '').replace(/\[\[([^\]\s]+)\]\]/g, (_, id) => labels.get(id) ?? id);
  const out = [];
  const add = (...parts) => out.push(...parts.filter((p) => p !== undefined && p !== ''));
  const note = (text) => `**${text.title}**：${r(text.body)}`;
  const notes = (items) => ordered(items.map((n) => (n.title ? note(n) : r(n.body))));
  const quote = (text) => `> ${r(text)}`;

  const { doc: meta, overview, requirement: req } = doc;
  add(
    `# ${meta.project} · 开发功能说明书`,
    `**${meta.doc_id}_${meta.title}**`,
    `「${meta.author_org}」`,
    '---',
    '## 文档变更记录',
    table(
      ['版本号', '修订日期', '修订人', '修订内容', '备注'],
      meta.change_log.map((c) => [c.version, date(c.date), c.author, c.content, c.remark]),
    ),
    '---',
  );

  add(
    '# 1 开发需求部分',
    '## 1.1 开发概览',
    table(
      ['项目', '内容'],
      [
        ['需求概述', overview.summary],
        ['开发难度(高/中/低)', overview.difficulty],
        ['事务代码', overview.tcode ?? '无'],
        ['运行类型(在线/批处理)', overview.run_type],
        ['输出至', overview.output_to],
        ['交易量', overview.volume],
        ['备注', overview.remark],
      ],
    ),
    '## 1.2 业务需求描述',
    '**业务背景与痛点**',
    r(req.background),
    '**功能目标**',
    req.goals_intro && r(req.goals_intro),
    ordered(req.goals.map(r)),
    '**使用角色与场景**',
    table(
      ['角色', '使用场景'],
      req.roles.map((x) => [x.role, r(x.scenario)]),
    ),
    '**功能范围**',
    bullets([
      ...req.scope_in.map((x) => `范围内：${r(x)}`),
      ...req.scope_out.map((x) => `范围外：${r(x)}`),
    ]),
  );
  if (req.constraints?.length) add('**业务约束**', bullets(req.constraints.map(r)));
  add('---');

  const {
    authorizations: auth,
    selection_screen: sel,
    selection_checks: checks,
    output,
    actions,
  } = doc;
  add(
    '# 2 功能规范',
    '## 2.1 权限校验',
    auth.intro && r(auth.intro),
    table(
      ['校验时机', '权限对象', '校验字段', '校验参数来源'],
      auth.items.map((a) => [
        a.timing,
        a.auth_object_text ? `${a.auth_object}（${a.auth_object_text}）` : a.auth_object,
        a.fields,
        r(a.value_source),
      ]),
    ),
  );
  if (auth.notes?.length) add('**校验说明**：', notes(auth.notes));
  add(
    '## 2.2 选择屏幕设计及其布局',
    sel.intro && r(sel.intro),
    '**选择屏幕字段**',
    table(
      ['屏幕字段', 'P/S', '可参照的表及字段', '必填/可选', '描述', '默认值'],
      sel.fields.map((f) => [
        f.label,
        f.kind,
        f.ref,
        f.required ? '**必填**' : '可选',
        f.description,
        f.default,
      ]),
    ),
    sel.note && quote(sel.note),
    '## 2.3 选择屏幕检查确认',
    checks.intro && r(checks.intro),
    notes(checks.items),
    '## 2.4 输出布局及样式',
    r(output.intro),
    table(
      ['字段', '参照', '字段描述', '处理'],
      output.fields.map((f) => [
        f.name,
        r(f.ref),
        r(f.description),
        f.handling === '可修改' ? '**可修改**' : f.handling,
      ]),
    ),
    '**对于输出的要求**：',
    ordered(output.requirements.map(r)),
    '## 2.5 功能按钮与交互',
    table(
      ['按钮/操作', '功能', '作用范围', '处理逻辑'],
      actions.items.map((a) => [a.label, a.function, a.scope, r(a.logic)]),
    ),
  );
  if (actions.interaction_rules?.length)
    add('**交互规则**：', ordered(actions.interaction_rules.map(r)));
  add('---');

  add('# 3 业务逻辑', doc.logic.intro && r(doc.logic.intro));
  doc.logic.sections.forEach((section, i) => {
    add(`## 3.${i + 1} ${section.title}`);
    if (section.trigger) add(`**触发**：${r(section.trigger)}`);
    if (section.intro) add(r(section.intro));
    for (const block of section.blocks) add(...renderBlock(block, r));
  });
  const messages = doc.messages;
  add(
    `## 3.${doc.logic.sections.length + 1} 消息与异常处理`,
    table(
      ['场景', '消息类型', '提示文本', '处理'],
      messages.items.map((m) => [m.scenario, m.type, m.text, r(m.handling)]),
    ),
    messages.note && quote(messages.note),
  );
  return out.join('\n\n') + '\n';
}

function renderBlock(block, r) {
  const heading = block.title ?? (block.kind === '说明' ? null : block.kind);
  const qualifier = block.qualifier ? `（${block.qualifier}）` : '';
  if (block.kind === '固定过滤条件') {
    const lines = block.filters.map((f) => {
      const cond = f.condition.startsWith('=')
        ? `\`${f.field} ${f.condition}\``
        : `\`${f.field}\` ${r(f.condition)}`;
      return `- ${f.label} ${cond}${f.note ? `（${f.note}）` : ''}`;
    });
    return [`**${heading}**${qualifier}：${block.intro ? r(block.intro) : ''}`, lines.join('\n')];
  }
  const items = block.items.map(r);
  const isOrdered = block.ordered !== false;
  if (!isOrdered && items.length === 1 && !block.intro && heading)
    return [`**${heading}**${qualifier}：${items[0]}`];
  const list = isOrdered ? ordered(items) : bullets(items);
  if (!heading) return [block.intro && r(block.intro), list];
  if (block.intro) return [`**${heading}**${qualifier}：${r(block.intro)}`, list];
  return [`**${heading}**${qualifier}：`, list];
}
