// FSD wire format: the Markdown dialect the model writes and the server parses
// line by line into fsd-report/1. Pure and browser-safe. Prompt V2 §十 is the
// model-facing description of the same grammar.
//
// Grammar (one construct per line):
//   > 思路：…                 thought line, shown while streaming, not stored
//   ## <部分>                 fixed part, see PARTS
//   ## 逻辑 <LOG-ID> <标题>    business-logic section
//   ### <子部分>              fixed sub-part, or ### <BLK-ID> <块类型> inside a logic section
//   <键>：<值>                property line (说明/注/触发/SAP对象/依据/标题/括注/引导)
//   | a | b |                 table; header must match the part's fixed columns
//   1. text / - text          list item; lines indented by 2+ spaces continue the item
//   1. [ID] **标题**：正文     note item (权限校验说明、选择屏幕检查)
// Cells escape "|" as "\|" and line breaks as <br>. Object rev is not part of the wire.

const KV = {
  封面: {
    文档编号: 'doc_id',
    功能名称: 'title',
    项目名称: 'project',
    实施公司: 'author_org',
    文档版本: 'version',
  },
  目标系统: { 产品: 'product', 版本: 'release', BASIS版本: 'basis_release', 来源: 'source' },
  开发概览: {
    需求概述: 'summary',
    开发难度: 'difficulty',
    事务代码: 'tcode',
    运行类型: 'run_type',
    输出至: 'output_to',
    交易量: 'volume',
    备注: 'remark',
  },
};
const yesNo = { to: (v) => (v ? '是' : '否'), from: (v) => v === '是' };
const list = { to: (v) => (v ?? []).join('、'), from: (v) => (v ? v.split('、') : []) };
const isoDate = { to: (v) => v, from: (v) => v.replaceAll('/', '-') };

/** basis <-> 依据 cell: 推断 / 客户：Q1、requirement / 系统：EV-001 */
export const basisCodec = {
  to(b) {
    if (!b) return '';
    const refs = b.refs ?? [];
    if (b.kind === 'FACT') return '系统：' + refs.join('、');
    if (b.kind === 'CUSTOMER_DECISION')
      return '客户：' + refs.map((r) => r.replace(/^answer:/, '')).join('、');
    return '推断';
  },
  from(text) {
    const value = text.trim();
    if (value === '推断') return { kind: 'INFERENCE' };
    const m = /^(客户|系统)[：:]\s*(.*)$/.exec(value);
    if (!m) return null;
    const refs = m[2]
      .split(/[、,，\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (m[1] === '系统') return refs.length ? { kind: 'FACT', refs } : null;
    return {
      kind: 'CUSTOMER_DECISION',
      refs: refs.map((r) => (r === 'requirement' || r.startsWith('answer:') ? r : 'answer:' + r)),
    };
  },
};

// [column header, property, optional converter]; basis: an optional trailing 依据 column.
const TABLES = {
  变更记录: {
    cols: [
      ['版本号', 'version'],
      ['修订日期', 'date', isoDate],
      ['修订人', 'author'],
      ['修订内容', 'content'],
      ['备注', 'remark'],
    ],
  },
  使用角色与场景: {
    cols: [
      ['角色', 'role'],
      ['使用场景', 'scenario'],
    ],
  },
  权限校验: {
    basis: true,
    cols: [
      ['编号', 'id'],
      ['校验时机', 'timing'],
      ['权限对象', 'auth_object'],
      ['权限对象说明', 'auth_object_text'],
      ['校验字段', 'fields'],
      ['校验参数来源', 'value_source'],
    ],
  },
  选择屏幕: {
    basis: true,
    cols: [
      ['编号', 'id'],
      ['屏幕字段', 'label'],
      ['P/S', 'kind'],
      ['参照', 'ref'],
      ['必填', 'required', yesNo],
      ['描述', 'description'],
      ['默认值', 'default'],
    ],
  },
  输出布局: {
    basis: true,
    cols: [
      ['编号', 'id'],
      ['字段', 'name'],
      ['参照', 'ref'],
      ['字段描述', 'description'],
      ['处理', 'handling'],
    ],
  },
  功能按钮: {
    cols: [
      ['编号', 'id'],
      ['按钮/操作', 'label'],
      ['功能', 'function'],
      ['作用范围', 'scope'],
      ['处理逻辑', 'logic'],
    ],
  },
  固定过滤条件: {
    cols: [
      ['名称', 'label'],
      ['字段', 'field'],
      ['条件', 'condition'],
      ['括注', 'note'],
    ],
  },
  消息: {
    cols: [
      ['编号', 'id'],
      ['场景', 'scenario'],
      ['类型', 'type'],
      ['提示文本', 'text'],
      ['处理', 'handling'],
    ],
  },
  提纲: {
    cols: [
      ['编号', 'id'],
      ['类型', 'type'],
      ['标题', 'title'],
      ['摘要', 'summary'],
    ],
  },
  生命周期分析: {
    cols: [
      ['编号', 'id'],
      ['环节', 'stage'],
      ['事务代码', 'tcode'],
      ['业务动作', 'action'],
      ['对本功能的影响', 'impact'],
      ['处理结论', 'decision'],
    ],
  },
  反向审查: {
    cols: [
      ['编号', 'id'],
      ['审查对象', 'target'],
      ['反例场景', 'scenario'],
      ['业务影响', 'impact'],
      ['处理', 'resolution'],
      ['状态', 'status'],
    ],
  },
  未决事项: {
    cols: [
      ['编号', 'id'],
      ['事项', 'title'],
      ['影响', 'impact'],
      ['阻断', 'blocking', yesNo],
      ['状态', 'status'],
      ['关联', 'related', list],
    ],
  },
  证据: {
    cols: [
      ['编号', 'id'],
      ['来源', 'source_kind'],
      ['对象', 'object'],
      ['摘要', 'summary'],
      ['时间', 'observed_at'],
      ['引用', 'ref'],
    ],
  },
};
const PROPS = {
  说明: 'intro',
  注: 'note',
  触发: 'trigger',
  标题: 'title',
  括注: 'qualifier',
  引导: 'intro',
};
const WORKING = {
  生命周期分析: 'lifecycle',
  反向审查: 'reverse_review',
  未决事项: 'open_issues',
  证据: 'evidence',
};

/** Parts a write call can be asked for, in document order. */
export const WIRE_PARTS = Object.freeze([
  'cover',
  'overview',
  'requirement',
  'authorizations',
  'selection_screen',
  'selection_checks',
  'output',
  'actions',
  'logic',
  'sections',
  'messages',
  'lifecycle',
  'reverse_review',
  'open_issues',
  'evidence',
]);

// ---------------------------------------------------------------- serializer

const esc = (v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
function tableLines(name, rows) {
  const { cols, basis } = TABLES[name];
  const withBasis = basis && rows.some((r) => r.basis);
  const header = [...cols.map((c) => c[0]), ...(withBasis ? ['依据'] : [])];
  const cell = (row, [, p, conv]) =>
    row[p] === undefined ? '' : esc(conv ? conv.to(row[p]) : row[p]);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) =>
        `| ${[...cols.map((c) => cell(row, c)), ...(withBasis ? [esc(basisCodec.to(row.basis))] : [])].join(' | ')} |`,
    ),
  ];
}
function kvLines(name, obj) {
  const rows = Object.entries(KV[name]).filter(([, p]) => obj[p] !== undefined);
  return ['| 项目 | 内容 |', '| --- | --- |', ...rows.map(([k, p]) => `| ${k} | ${esc(obj[p])} |`)];
}
const orderedLines = (items) => items.map((t, i) => `${i + 1}. ${t}`);
const bulletLines = (items) => items.map((t) => `- ${t}`);
const noteLines = (items) =>
  items.map((n, i) => `${i + 1}. [${n.id}] ${n.title ? `**${n.title}**：` : ''}${n.body}`);
const prop = (key, value) => (value === undefined ? [] : [`${key}：${value}`]);

export function sectionWire(s) {
  const out = [`## 逻辑 ${s.id} ${s.title}`, ...prop('触发', s.trigger), ...prop('说明', s.intro)];
  if (s.sap_refs?.length)
    out.push(`SAP对象：${s.sap_refs.map((r) => `${r.type} ${r.name}`).join('；')}`);
  if (s.basis) out.push(`依据：${basisCodec.to(s.basis)}`);
  out.push('');
  for (const b of s.blocks) {
    const head = [...prop('标题', b.title), ...prop('括注', b.qualifier), ...prop('引导', b.intro)];
    const body =
      b.kind === '固定过滤条件'
        ? tableLines('固定过滤条件', b.filters)
        : b.ordered === false
          ? bulletLines(b.items)
          : orderedLines(b.items);
    out.push(`### ${b.id} ${b.kind}`, ...head, ...body, '');
  }
  return out;
}

/**
 * Serialize a document (or only some parts of it) to the wire format.
 * parts: subset of WIRE_PARTS; 'section:<LOG-ID>' selects one logic section.
 */
export function toFsdWire(doc, { parts } = {}) {
  const want = (key) => !parts || parts.includes(key);
  const wantSection = (id) => want('sections') || parts?.includes('section:' + id);
  const out = [];
  const part = (title, ...lines) => out.push(`## ${title}`, ...lines, '');
  const sub = (title, ...lines) => out.push(`### ${title}`, ...lines, '');
  if (want('cover') && doc.doc) {
    part('封面', ...kvLines('封面', doc.doc));
    part('变更记录', ...tableLines('变更记录', doc.doc.change_log ?? []));
    if (doc.target) part('目标系统', ...kvLines('目标系统', doc.target));
  }
  if (want('overview') && doc.overview) part('开发概览', ...kvLines('开发概览', doc.overview));
  const req = doc.requirement;
  if (want('requirement') && req) {
    out.push('## 业务需求', '');
    if (req.background) sub('业务背景与痛点', req.background);
    sub('功能目标', ...prop('引导', req.goals_intro), ...orderedLines(req.goals ?? []));
    sub('使用角色与场景', ...tableLines('使用角色与场景', req.roles ?? []));
    sub('范围内', ...bulletLines(req.scope_in ?? []));
    sub('范围外', ...bulletLines(req.scope_out ?? []));
    if (req.constraints) sub('业务约束', ...bulletLines(req.constraints));
  }
  const auth = doc.authorizations;
  if (want('authorizations') && auth) {
    part('权限校验', ...prop('说明', auth.intro), ...tableLines('权限校验', auth.items ?? []));
    if (auth.notes) sub('校验说明', ...noteLines(auth.notes));
  }
  const sel = doc.selection_screen;
  if (want('selection_screen') && sel)
    part(
      '选择屏幕',
      ...prop('说明', sel.intro),
      ...tableLines('选择屏幕', sel.fields ?? []),
      ...prop('注', sel.note),
    );
  const chk = doc.selection_checks;
  if (want('selection_checks') && chk)
    part('选择屏幕检查', ...prop('说明', chk.intro), ...noteLines(chk.items ?? []));
  const output = doc.output;
  if (want('output') && output) {
    part('输出布局', ...prop('说明', output.intro), ...tableLines('输出布局', output.fields ?? []));
    sub('输出要求', ...orderedLines(output.requirements ?? []));
  }
  if (want('actions') && doc.actions) {
    part('功能按钮', ...tableLines('功能按钮', doc.actions.items ?? []));
    if (doc.actions.interaction_rules)
      sub('交互规则', ...orderedLines(doc.actions.interaction_rules));
  }
  if (want('logic') && doc.logic) part('业务逻辑', ...prop('说明', doc.logic.intro));
  for (const s of doc.logic?.sections ?? []) if (wantSection(s.id)) out.push(...sectionWire(s));
  if (want('messages') && doc.messages)
    part('消息', ...tableLines('消息', doc.messages.items ?? []), ...prop('注', doc.messages.note));
  for (const [title, key] of Object.entries(WORKING))
    if (want(key) && doc.working?.[key]?.length)
      part(title, ...tableLines(title, doc.working[key]));
  return out.join('\n');
}

// ---------------------------------------------------------------- parser

function splitRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (body[i] === '|') {
      cells.push(cur);
      cur = '';
    } else cur += body[i];
  }
  cells.push(cur);
  return cells.map((c) => c.trim().replace(/<br>/g, '\n'));
}
const SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+$/;
const ITEM = /^(\d+\.|-)\s+(.*)$/;
const NOTE = /^\[([A-Z][A-Z0-9-]*)\]\s*(?:\*\*(.+?)\*\*：)?(.*)$/s;
const SAP_REF = /^(\S+)\s+(.+)$/;

/** Empty document a parse starts from; collections exist so rows can be appended. */
export function emptyWireDoc() {
  return {
    schema_version: 'fsd-report/1',
    doc: { change_log: [] },
    overview: {},
    requirement: { goals: [], roles: [], scope_in: [], scope_out: [] },
    authorizations: { items: [] },
    selection_screen: { fields: [] },
    selection_checks: { items: [] },
    output: { fields: [], requirements: [] },
    actions: { items: [] },
    logic: { sections: [] },
    messages: { items: [] },
  };
}

/**
 * Incremental parser. push() text chunks as they stream; every completed table row,
 * list item or note fires onEvent({ type: 'object', path, value, line }), a logic section
 * header fires { type: 'section' }, a thought line { type: 'thought' }; malformed input
 * fires { type: 'error', line, message } and parsing continues. end() flushes and returns
 * { doc, errors, outline, deletions, thoughts }.
 */
export function createFsdWireParser({ onEvent = () => {} } = {}) {
  const doc = emptyWireDoc();
  const errors = [];
  const outline = [];
  const deletions = [];
  const thoughts = [];
  let lineNo = 0;
  let buffer = '';
  let part = null; // { name, section? }
  let sub = null; // { name, block? }
  let table = null; // { name, cols, header, hasBasis, kv }
  let item = null; // { text, line, ordered }
  let paragraph = null; // string[] for 业务背景与痛点

  const error = (message, line = lineNo) => {
    errors.push({ line, message });
    onEvent({ type: 'error', line, message });
  };
  const emit = (path, value, line = lineNo) => onEvent({ type: 'object', path, value, line });

  function flushItem() {
    if (!item) return;
    const { text, line, ordered } = item;
    item = null;
    placeItem(text, line, ordered);
  }
  function flushParagraph() {
    if (!paragraph) return;
    const text = paragraph.join('\n').trim();
    paragraph = null;
    if (!text) return;
    doc.requirement.background = text;
    emit('/requirement/background', text);
  }

  function note(text, line) {
    const m = NOTE.exec(text);
    if (!m) return error('说明条目须以 [编号] 开头', line);
    const n = { id: m[1] };
    if (m[2]) n.title = m[2];
    n.body = m[3].trim();
    return n;
  }

  function placeItem(text, line, ordered) {
    const p = part?.name;
    const s = sub?.name;
    const push = (arr, path, value) => {
      arr.push(value);
      emit(`${path}/${arr.length - 1}`, value, line);
    };
    if (p === '删除') {
      const id = text.trim();
      if (!/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(id)) return error(`删除项应为编号：${id}`, line);
      deletions.push(id);
      return onEvent({ type: 'delete', id, line });
    }
    if (p === '业务需求') {
      const target = {
        功能目标: 'goals',
        范围内: 'scope_in',
        范围外: 'scope_out',
        业务约束: 'constraints',
      }[s];
      if (!target) return error(`“${s ?? p}”下不应出现列表`, line);
      doc.requirement[target] ??= [];
      return push(doc.requirement[target], `/requirement/${target}`, text);
    }
    if (p === '权限校验' && s === '校验说明') {
      const n = note(text, line);
      if (!n) return;
      doc.authorizations.notes ??= [];
      return push(doc.authorizations.notes, '/authorizations/notes', n);
    }
    if (p === '选择屏幕检查' && !s) {
      const n = note(text, line);
      if (n) push(doc.selection_checks.items, '/selection_checks/items', n);
      return;
    }
    if (p === '输出布局' && s === '输出要求')
      return push(doc.output.requirements, '/output/requirements', text);
    if (p === '功能按钮' && s === '交互规则') {
      doc.actions.interaction_rules ??= [];
      return push(doc.actions.interaction_rules, '/actions/interaction_rules', text);
    }
    if (part?.section && sub?.block && sub.block.items) {
      const si = doc.logic.sections.length - 1;
      const bi = part.section.blocks.length - 1;
      if (!ordered) sub.block.ordered = false;
      return push(sub.block.items, `/logic/sections/${si}/blocks/${bi}/items`, text);
    }
    error(`“${s ?? p ?? '文档开头'}”下不应出现列表`, line);
  }

  function placeRow(cells) {
    const { name, cols, hasBasis } = table;
    const expected = cols.length + (hasBasis ? 1 : 0);
    if (cells.length !== expected)
      return error(`${name}：应为 ${expected} 列，实际 ${cells.length} 列`);
    const row = {};
    cols.forEach(([, p, conv], i) => {
      if (cells[i] !== '') row[p] = conv ? conv.from(cells[i]) : cells[i];
    });
    if (hasBasis && cells.at(-1) !== '') {
      const basis = basisCodec.from(cells.at(-1));
      if (basis) row.basis = basis;
      else error(`${name}：依据应为“推断”“客户：题号”或“系统：证据编号”`);
    }
    if (name === '提纲') {
      outline.push(row);
      return emit(`/outline/${outline.length - 1}`, row);
    }
    const targets = {
      变更记录: [doc.doc.change_log, '/doc/change_log'],
      使用角色与场景: [doc.requirement.roles, '/requirement/roles'],
      权限校验: [doc.authorizations.items, '/authorizations/items'],
      选择屏幕: [doc.selection_screen.fields, '/selection_screen/fields'],
      输出布局: [doc.output.fields, '/output/fields'],
      功能按钮: [doc.actions.items, '/actions/items'],
      消息: [doc.messages.items, '/messages/items'],
    };
    let target = targets[name];
    if (name === '固定过滤条件') {
      const si = doc.logic.sections.length - 1;
      target = [
        sub.block.filters,
        `/logic/sections/${si}/blocks/${part.section.blocks.length - 1}/filters`,
      ];
    } else if (WORKING[name]) {
      doc.working ??= {};
      const key = WORKING[name];
      doc.working[key] ??= [];
      target = [doc.working[key], `/working/${key}`];
    }
    if (name === '选择屏幕') row.required ??= false;
    target[0].push(row);
    emit(`${target[1]}/${target[0].length - 1}`, row);
  }

  function placeKv(cells) {
    const [key, value] = cells;
    const prop = KV[part.name][key];
    if (!prop) return error(`${part.name}：未知项目“${key}”`);
    if (value === '' || value === undefined) return;
    const owner = { 封面: 'doc', 目标系统: 'target', 开发概览: 'overview' }[part.name];
    doc[owner] ??= {};
    doc[owner][prop] = value;
    emit(`/${owner}/${prop}`, value);
  }

  function placeProp(key, value) {
    const prop = PROPS[key];
    const p = part?.name;
    if (part?.section && sub?.block) {
      if (!['标题', '括注', '引导'].includes(key)) return error(`块内不支持“${key}”`);
      sub.block[prop] = value;
      return;
    }
    if (part?.section) {
      if (key === 'SAP对象') {
        part.section.sap_refs = value
          .split(/[；;]/)
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => {
            const m = SAP_REF.exec(x);
            return m
              ? { type: m[1], name: m[2].trim() }
              : (error(`SAP对象格式应为“类型 名称”：${x}`), null);
          })
          .filter(Boolean);
        return;
      }
      if (key === '依据') {
        const basis = basisCodec.from(value);
        if (basis) part.section.basis = basis;
        else error('依据应为“推断”“客户：题号”或“系统：证据编号”');
        return;
      }
      if (!['触发', '说明'].includes(key)) return error(`逻辑章节不支持“${key}”`);
      part.section[prop] = value;
      return;
    }
    if (p === '业务需求' && sub?.name === '功能目标' && key === '引导')
      return void (doc.requirement.goals_intro = value);
    const owner = {
      权限校验: doc.authorizations,
      选择屏幕: doc.selection_screen,
      选择屏幕检查: doc.selection_checks,
      输出布局: doc.output,
      业务逻辑: doc.logic,
      消息: doc.messages,
    }[p];
    if (
      !owner ||
      !['说明', '注'].includes(key) ||
      (key === '注' && !['选择屏幕', '消息'].includes(p))
    )
      return error(`“${p ?? '文档开头'}”下不支持“${key}”`);
    owner[prop] = value;
  }

  function openPart(title) {
    flushItem();
    flushParagraph();
    table = null;
    sub = null;
    const m = /^逻辑\s+(LOG-[A-Z0-9-]+)\s+(.+)$/.exec(title);
    if (m) {
      const section = { id: m[1], title: m[2].trim(), blocks: [] };
      doc.logic.sections.push(section);
      part = { name: '逻辑', section };
      onEvent({ type: 'section', id: section.id, title: section.title, line: lineNo });
      return;
    }
    part = { name: title };
    if (KV[title]) table = { name: title, kv: true, header: false };
    else if (TABLES[title] && title !== '使用角色与场景' && title !== '固定过滤条件')
      table = { name: title, ...TABLES[title], header: false };
    else if (!['业务需求', '选择屏幕检查', '业务逻辑', '删除'].includes(title))
      error(`未知部分“${title}”`);
  }

  function openSub(title) {
    flushItem();
    flushParagraph();
    table = null;
    if (part?.section) {
      const m = /^(BLK-[A-Z0-9-]+)\s+(\S+)$/.exec(title);
      if (!m) return error(`逻辑块标题应为“### BLK-编号 块类型”：${title}`);
      const block = { id: m[1], kind: m[2] };
      if (m[2] === '固定过滤条件') {
        block.filters = [];
        table = { name: '固定过滤条件', ...TABLES.固定过滤条件, header: false };
      } else block.items = [];
      part.section.blocks.push(block);
      sub = { name: m[2], block };
      return;
    }
    sub = { name: title };
    if (title === '业务背景与痛点') paragraph = [];
    if (title === '使用角色与场景') table = { name: title, ...TABLES[title], header: false };
  }

  function readHeader(text) {
    const cells = splitRow(text);
    if (table.kv) {
      if (cells.join('|') !== '项目|内容') error(`${table.name}：表头应为 | 项目 | 内容 |`);
    } else {
      const expected = table.cols.map((c) => c[0]);
      table.hasBasis =
        !!table.basis && cells.length === expected.length + 1 && cells.at(-1) === '依据';
      const got = table.hasBasis ? cells.slice(0, -1) : cells;
      if (got.join('|') !== expected.join('|'))
        error(
          `${table.name}：表头应为 | ${expected.join(' | ')} |${table.basis ? '（可加“依据”列）' : ''}`,
        );
    }
    table.header = true;
  }

  function line(raw) {
    lineNo++;
    const text = raw.replace(/\r$/, '');
    if (item && /^\s{2,}\S/.test(text)) return void (item.text += '\n' + text);
    if (text.trim() === '') return; // blank lines never end an item on their own
    if (item && !/^\s/.test(text)) flushItem();
    if (text.startsWith('>')) {
      const thought = text.replace(/^>\s*(思路[：:])?\s*/, '');
      thoughts.push(thought);
      return onEvent({ type: 'thought', text: thought, line: lineNo });
    }
    const h2 = /^##\s+(.+)$/.exec(text);
    if (h2 && !text.startsWith('###')) return openPart(h2[1].trim());
    const h3 = /^###\s+(.+)$/.exec(text);
    if (h3) return openSub(h3[1].trim());
    if (text.trimStart().startsWith('|')) {
      if (!table) return error('此处不应出现表格');
      if (!table.header) return readHeader(text);
      if (SEPARATOR.test(text.trim())) return;
      return table.kv ? placeKv(splitRow(text)) : placeRow(splitRow(text));
    }
    const kv = /^(说明|注|触发|SAP对象|依据|标题|括注|引导)：(.*)$/.exec(text);
    if (kv) return placeProp(kv[1], kv[2].trim());
    const li = ITEM.exec(text);
    if (li) {
      item = { text: li[2], line: lineNo, ordered: li[1] !== '-' };
      return;
    }
    if (paragraph) return void paragraph.push(text);
    error(`无法识别的行：${text.slice(0, 40)}`);
  }

  return {
    push(chunk) {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    end() {
      if (buffer) line(buffer);
      buffer = '';
      flushItem();
      flushParagraph();
      return { doc, errors, outline, deletions, thoughts };
    },
  };
}

export function parseFsdWire(text, options) {
  const parser = createFsdWireParser(options);
  parser.push(text);
  return parser.end();
}
