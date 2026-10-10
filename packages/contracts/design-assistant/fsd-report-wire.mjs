// FSD wire format: the Markdown dialect the model writes and the server parses
// line by line into fsd-report/1. Pure and browser-safe.
//
// Grammar (one construct per line):
//   ## <部分>                 fixed part, see PARTS
//   ## 逻辑 <LOG-ID> <标题>    business-logic section
//   ### <子部分>              fixed sub-part, or ### <BLK-ID> <块类型> inside a logic section
//   <键>：<值>                property line (说明/注/触发/SAP对象/标题/括注/引导)
//   | a | b |                 table; header must match the part's fixed columns
//   1. text / - text          list item; lines indented by 2+ spaces continue the item
//   1. [ID] **标题**：正文     note item (权限校验说明、选择屏幕检查)
// Cells escape "|" as "\|" and line breaks as <br>. basis/rev are not part of the wire.

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

// [column header, property, optional converter]
const TABLES = {
  变更记录: [
    ['版本号', 'version'],
    ['修订日期', 'date', isoDate],
    ['修订人', 'author'],
    ['修订内容', 'content'],
    ['备注', 'remark'],
  ],
  使用角色与场景: [
    ['角色', 'role'],
    ['使用场景', 'scenario'],
  ],
  权限校验: [
    ['编号', 'id'],
    ['校验时机', 'timing'],
    ['权限对象', 'auth_object'],
    ['权限对象说明', 'auth_object_text'],
    ['校验字段', 'fields'],
    ['校验参数来源', 'value_source'],
  ],
  选择屏幕: [
    ['编号', 'id'],
    ['屏幕字段', 'label'],
    ['P/S', 'kind'],
    ['参照', 'ref'],
    ['必填', 'required', yesNo],
    ['描述', 'description'],
    ['默认值', 'default'],
  ],
  输出布局: [
    ['编号', 'id'],
    ['字段', 'name'],
    ['参照', 'ref'],
    ['字段描述', 'description'],
    ['处理', 'handling'],
  ],
  功能按钮: [
    ['编号', 'id'],
    ['按钮/操作', 'label'],
    ['功能', 'function'],
    ['作用范围', 'scope'],
    ['处理逻辑', 'logic'],
  ],
  固定过滤条件: [
    ['名称', 'label'],
    ['字段', 'field'],
    ['条件', 'condition'],
    ['括注', 'note'],
  ],
  消息: [
    ['编号', 'id'],
    ['场景', 'scenario'],
    ['类型', 'type'],
    ['提示文本', 'text'],
    ['处理', 'handling'],
  ],
  未决事项: [
    ['编号', 'id'],
    ['事项', 'title'],
    ['影响', 'impact'],
    ['阻断', 'blocking', yesNo],
    ['状态', 'status'],
    ['关联', 'related', list],
  ],
  证据: [
    ['编号', 'id'],
    ['来源', 'source_kind'],
    ['对象', 'object'],
    ['摘要', 'summary'],
    ['时间', 'observed_at'],
    ['引用', 'ref'],
  ],
};
const PROPS = {
  说明: 'intro',
  注: 'note',
  触发: 'trigger',
  标题: 'title',
  括注: 'qualifier',
  引导: 'intro',
};

// ---------------------------------------------------------------- serializer

const esc = (v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
function tableLines(name, rows) {
  const cols = TABLES[name];
  return [
    `| ${cols.map((c) => c[0]).join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) =>
        `| ${cols.map(([, p, conv]) => (row[p] === undefined ? '' : esc(conv ? conv.to(row[p]) : row[p]))).join(' | ')} |`,
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

export function toFsdWire(doc) {
  const out = [];
  const part = (title, ...lines) => out.push(`## ${title}`, ...lines, '');
  const sub = (title, ...lines) => out.push(`### ${title}`, ...lines, '');
  part('封面', ...kvLines('封面', doc.doc));
  part('变更记录', ...tableLines('变更记录', doc.doc.change_log));
  if (doc.target) part('目标系统', ...kvLines('目标系统', doc.target));
  part('开发概览', ...kvLines('开发概览', doc.overview));
  const req = doc.requirement;
  out.push('## 业务需求', '');
  sub('业务背景与痛点', req.background);
  sub('功能目标', ...prop('引导', req.goals_intro), ...orderedLines(req.goals));
  sub('使用角色与场景', ...tableLines('使用角色与场景', req.roles));
  sub('范围内', ...bulletLines(req.scope_in));
  sub('范围外', ...bulletLines(req.scope_out));
  if (req.constraints) sub('业务约束', ...bulletLines(req.constraints));
  const auth = doc.authorizations;
  part('权限校验', ...prop('说明', auth.intro), ...tableLines('权限校验', auth.items));
  if (auth.notes) sub('校验说明', ...noteLines(auth.notes));
  const sel = doc.selection_screen;
  part(
    '选择屏幕',
    ...prop('说明', sel.intro),
    ...tableLines('选择屏幕', sel.fields),
    ...prop('注', sel.note),
  );
  const chk = doc.selection_checks;
  part('选择屏幕检查', ...prop('说明', chk.intro), ...noteLines(chk.items));
  const output = doc.output;
  part('输出布局', ...prop('说明', output.intro), ...tableLines('输出布局', output.fields));
  sub('输出要求', ...orderedLines(output.requirements));
  part('功能按钮', ...tableLines('功能按钮', doc.actions.items));
  if (doc.actions.interaction_rules)
    sub('交互规则', ...orderedLines(doc.actions.interaction_rules));
  part('业务逻辑', ...prop('说明', doc.logic.intro));
  for (const s of doc.logic.sections) {
    const refs = s.sap_refs?.length
      ? [`SAP对象：${s.sap_refs.map((r) => `${r.type} ${r.name}`).join('；')}`]
      : [];
    part(`逻辑 ${s.id} ${s.title}`, ...prop('触发', s.trigger), ...prop('说明', s.intro), ...refs);
    for (const b of s.blocks) {
      const head = [
        ...prop('标题', b.title),
        ...prop('括注', b.qualifier),
        ...prop('引导', b.intro),
      ];
      if (b.kind === '固定过滤条件')
        sub(`${b.id} ${b.kind}`, ...head, ...tableLines('固定过滤条件', b.filters));
      else
        sub(
          `${b.id} ${b.kind}`,
          ...head,
          ...(b.ordered === false ? bulletLines(b.items) : orderedLines(b.items)),
        );
    }
  }
  part('消息', ...tableLines('消息', doc.messages.items), ...prop('注', doc.messages.note));
  const w = doc.working ?? {};
  if (w.open_issues?.length) part('未决事项', ...tableLines('未决事项', w.open_issues));
  if (w.evidence?.length) part('证据', ...tableLines('证据', w.evidence));
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

/**
 * Incremental parser. push() text chunks as they stream; every completed table row,
 * list item or note fires onEvent({ type: 'object', path, value, line }); malformed
 * input fires { type: 'error', line, message } and parsing continues. end() flushes
 * and returns { doc, errors }.
 */
export function createFsdWireParser({ onEvent = () => {} } = {}) {
  const doc = {
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
  const errors = [];
  let lineNo = 0;
  let buffer = '';
  let part = null; // { name, section? }
  let sub = null; // { name, block? }
  let table = null; // { name, cols, header: boolean }
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
    doc.requirement.background = paragraph.join('\n').trim();
    emit('/requirement/background', doc.requirement.background);
    paragraph = null;
  }
  function closeTable() {
    table = null;
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
    const { name, cols } = table;
    if (cells.length !== cols.length)
      return error(`${name}：应为 ${cols.length} 列，实际 ${cells.length} 列`);
    const row = {};
    cols.forEach(([, p, conv], i) => {
      if (cells[i] !== '') row[p] = conv ? conv.from(cells[i]) : cells[i];
    });
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
    } else if (name === '未决事项' || name === '证据') {
      doc.working ??= {};
      const key = name === '未决事项' ? 'open_issues' : 'evidence';
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
    if (value === '') return;
    const obj =
      part.name === '封面'
        ? doc.doc
        : part.name === '目标系统'
          ? (doc.target ??= {})
          : doc.overview;
    obj[prop] = value;
    emit(
      `/${part.name === '封面' ? 'doc' : part.name === '目标系统' ? 'target' : 'overview'}/${prop}`,
      value,
    );
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
          .split('；')
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
    closeTable();
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
      table = { name: title, cols: TABLES[title], header: false };
    else if (!['业务需求', '选择屏幕检查', '业务逻辑'].includes(title)) error(`未知部分“${title}”`);
  }

  function openSub(title) {
    flushItem();
    flushParagraph();
    closeTable();
    if (part?.section) {
      const m = /^(BLK-[A-Z0-9-]+)\s+(\S+)$/.exec(title);
      if (!m) return error(`逻辑块标题应为“### BLK-编号 块类型”：${title}`);
      const block = { id: m[1], kind: m[2] };
      if (m[2] === '固定过滤条件') {
        block.filters = [];
        table = { name: '固定过滤条件', cols: TABLES.固定过滤条件, header: false };
      } else block.items = [];
      part.section.blocks.push(block);
      sub = { name: m[2], block };
      return;
    }
    sub = { name: title };
    if (title === '业务背景与痛点') paragraph = [];
    if (title === '使用角色与场景') table = { name: title, cols: TABLES[title], header: false };
  }

  function line(raw) {
    lineNo++;
    const text = raw.replace(/\r$/, '');
    if (item && /^\s{2,}\S/.test(text)) return void (item.text += '\n' + text);
    if (text.trim() === '') return; // blank lines never end an item on their own
    if (item && !/^\s/.test(text)) flushItem();
    const h2 = /^##\s+(.+)$/.exec(text);
    if (h2 && !text.startsWith('###')) return openPart(h2[1].trim());
    const h3 = /^###\s+(.+)$/.exec(text);
    if (h3) return openSub(h3[1].trim());
    if (text.trimStart().startsWith('|')) {
      if (!table) return error('此处不应出现表格');
      if (!table.header) {
        const cells = splitRow(text);
        const expected = table.kv ? ['项目', '内容'] : table.cols.map((c) => c[0]);
        if (cells.join('|') !== expected.join('|'))
          error(`${table.name}：表头应为 | ${expected.join(' | ')} |`);
        table.header = true;
        return;
      }
      if (SEPARATOR.test(text.trim())) return;
      return table.kv ? placeKv(splitRow(text)) : placeRow(splitRow(text));
    }
    const kv = /^(说明|注|触发|SAP对象|标题|括注|引导)：(.*)$/.exec(text);
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
      return { doc, errors };
    },
  };
}

export function parseFsdWire(text, options) {
  const parser = createFsdWireParser(options);
  parser.push(text);
  return parser.end();
}
