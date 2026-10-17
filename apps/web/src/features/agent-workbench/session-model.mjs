// Pure mapping between the agent APIs and the conversation components.

const TOOL_LABELS = {
  searchObject: '搜索 SAP 对象',
  findObjectPath: '定位 SAP 对象',
  objectTypes: '读取对象类型',
  ddicElement: '读取表结构',
  ddicRepositoryAccess: '读取数据字典',
  tableContents: '读取表内容',
  runQuery: '查询表内容或配置',
  getObjectSource: '读取源码',
  objectStructure: '读取对象结构',
  classComponents: '读取类组件',
  findDefinition: '查找定义',
  usageReferences: '查找使用位置',
  abapDocumentation: '读取 ABAP 文档',
  read_document: '读取文档',
  write_document: '编写文档',
  edit_document: '修改文档',
  check_document: '自动校验文档',
  list_materials: '查看资料清单',
  read_material: '读取资料',
  read_artifact: '读取方案或代码',
  write_artifact: '编写方案或代码',
  edit_artifact: '修改方案或代码',
  import_code: '保存上传的代码',
  sync_from_sap: '从 SAP 同步代码',
  check_code: '校验代码',
  ask_user: '整理待确认问题',
  query_test_system: '在 QAS 查找测试单据',
  request_test_data: '申请建立测试单据',
  create_test_data: '在 QAS 建立测试单据',
  reply_comment: '回复批注',
};
export const toolLabel = (name) => TOOL_LABELS[name] ?? '其他操作';

// Arguments arrive as an object (history) or as the first 500 characters of JSON (live).
function parseInput(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function stepFromToolCall(call, index = 0) {
  return {
    stepId: call.id ?? `${call.name}-${index}`,
    label: toolLabel(call.name),
    status: call.status === 'running' ? 'running' : call.status === 'ok' ? 'succeeded' : 'failed',
    attempt: 1,
    summary: call.summary ?? '',
    startedAt: call.createdAt ?? null,
    finishedAt: call.createdAt ?? null,
    name: call.name,
    input: parseInput(call.arguments),
    preview: call.preview ?? null,
    durationMs: call.durationMs ?? undefined,
  };
}

// --- Run activity: what the agent did, grouped the way a person would describe it -------------
// Read-only lookups between two writes become one row; each row names the objects it touched
// (docs/specs/agent-conversation-ux.md 4.2).
const SAP_LOOKUP = new Set([
  'searchObject',
  'findObjectPath',
  'objectTypes',
  'ddicElement',
  'ddicRepositoryAccess',
  'tableContents',
  'runQuery',
  'getObjectSource',
  'objectStructure',
  'classComponents',
  'findDefinition',
  'usageReferences',
  'abapDocumentation',
]);
const READING = new Set(['list_materials', 'read_material', 'read_document', 'read_artifact']);
const WRITING = new Set(['write_document', 'write_artifact']);
const REVISING = new Set(['edit_document', 'edit_artifact']);
const CHECKING = new Set(['check_document', 'check_code']);
const TARGETS = { plan: '开发方案', code: '代码' };
const OBJECT_TYPES = {
  FUNC: '函数',
  FUGR: '函数组',
  SUSO: '权限对象',
  CLAS: '类',
  INTF: '接口',
  PROG: '程序',
  TABL: '表',
  VIEW: '视图',
  DDLS: 'CDS 视图',
  DTEL: '数据元素',
  DOMA: '域',
  TRAN: '事务码',
  MSAG: '消息类',
};
const GROUP_ORDER = ['表', 'CDS 视图', '视图', '函数', '类', '程序', '权限对象', '资料', '章节'];

// One argument, from the parsed object or from the start of the JSON text.
function field(input, key) {
  if (input && typeof input === 'object') return input[key];
  if (typeof input !== 'string') return undefined;
  const m = input.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\])`));
  try {
    return m ? JSON.parse(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function sectionsOf(input) {
  const changes = field(input, 'changes');
  const found = Array.isArray(changes)
    ? changes.map((c) => c?.section)
    : typeof input === 'string'
      ? [...input.matchAll(/"section"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
      : [];
  return [...new Set(found.filter((x) => typeof x === 'string' && x.trim()))];
}

const names = (value) =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);

function fromAdtUrl(url) {
  if (typeof url !== 'string') return [];
  const parts = url.split('/').filter(Boolean);
  const at = parts.indexOf('source');
  const name = decodeURIComponent(parts[at > 0 ? at - 1 : parts.length - 1] ?? '').toUpperCase();
  const group = /\/classes\//.test(url)
    ? '类'
    : /\/programs\//.test(url)
      ? '程序'
      : /\/functions?\//.test(url)
        ? '函数'
        : /\/ddic\/tables\//.test(url)
          ? '表'
          : '对象';
  return name ? [{ group, name }] : [];
}

// The objects one call touched: tables, functions, programs, materials, chapters.
export function stepObjects(step) {
  const input = step.input;
  const of = (group, list) => list.map((name) => ({ group, name }));
  switch (step.name) {
    case 'ddicElement':
    case 'ddicRepositoryAccess':
      return of('表', names(field(input, 'path')));
    case 'runQuery':
    case 'tableContents': {
      const sql = String(field(input, 'sqlQuery') ?? '');
      const tables = [...sql.matchAll(/\b(?:from|join)\s+([a-z0-9_/]+)/gi)].map((m) => m[1]);
      return of('表', [...new Set(names([...tables, ...names(field(input, 'ddicEntityName'))]))]);
    }
    case 'searchObject': {
      const type = String(field(input, 'objType') ?? '')
        .split('/')[0]
        .toUpperCase();
      return of(OBJECT_TYPES[type] ?? '对象', names(field(input, 'query')));
    }
    case 'getObjectSource':
      return fromAdtUrl(field(input, 'objectSourceUrl'));
    case 'objectStructure':
    case 'classComponents':
    case 'findDefinition':
    case 'usageReferences':
      return fromAdtUrl(field(input, 'objectUrl') ?? field(input, 'url'));
    case 'read_material': {
      const fsd = String(field(input, 'key') ?? '').match(/^fsd:.*:(\d+)$/);
      return [{ group: '资料', name: fsd ? `FSD 第 ${fsd[1]} 版` : '上传的资料' }];
    }
    case 'read_document':
    case 'read_artifact': {
      const section = field(input, 'section') || TARGETS[field(input, 'target')];
      return section ? [{ group: '章节', name: String(section) }] : [];
    }
    default:
      return [];
  }
}

function groupObjects(steps) {
  const groups = new Map();
  for (const o of steps.flatMap(stepObjects)) {
    if (!groups.has(o.group)) groups.set(o.group, new Set());
    groups.get(o.group).add(o.name);
  }
  const rank = (g) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([group, set]) => ({ group, names: [...set] }));
}

const unit = (group) => (group === '表' ? '张' : '个');
// "表 VBAK、VBAP 等 9 张 · 函数 CONVERT_TO_LOCAL_CURRENCY"
export function objectsText(groups, limit = 6) {
  return groups
    .map(({ group, names }) =>
      names.length > limit
        ? `${group} ${names.slice(0, limit).join('、')} 等 ${names.length} ${unit(group)}`
        : `${group} ${names.join('、')}`,
    )
    .join(' · ');
}

function writeTitle(step) {
  const target = TARGETS[field(step.input, 'target')];
  if (step.name === 'write_document') return '编写文档';
  if (step.name === 'edit_document') return '修订文档';
  if (step.name === 'write_artifact') return target ? '编写' + target : '编写方案或代码';
  return target ? '修订' + target : '修订方案或代码';
}

function activityKey(step) {
  if (SAP_LOOKUP.has(step.name) || READING.has(step.name)) return 'lookup';
  if (WRITING.has(step.name) || REVISING.has(step.name)) return writeTitle(step);
  return step.name;
}

// A model's own mistake (a wrong comment id, a repeated call) stays in the details of the row
// before it instead of showing as a failed activity; failed SAP queries stay visible.
const internalFailure = (step) => step.status === 'failed' && !SAP_LOOKUP.has(step.name);

export function activitiesFromSteps(steps = []) {
  const rows = [];
  for (const step of steps) {
    const key = activityKey(step);
    const last = rows.at(-1);
    if (last && (last.key === key || internalFailure(step))) last.steps.push(step);
    else rows.push({ id: step.stepId, key, steps: [step] });
  }
  return rows.map(({ id, key, steps: own }) => {
    const first = own[0];
    const counted = own.filter((s) => s === first || !internalFailure(s));
    let title = toolLabel(first.name),
      detail = '';
    if (key === 'lookup') {
      title = own.some((s) => SAP_LOOKUP.has(s.name)) ? '查阅 SAP 系统' : '阅读资料';
      detail = objectsText(groupObjects(own));
    } else if (WRITING.has(first.name)) {
      title = writeTitle(first);
      detail = [...new Set(own.flatMap((s) => sectionsOf(s.input)))].join('、');
    } else if (REVISING.has(first.name)) {
      title = writeTitle(first);
      detail = `${counted.length} 处`;
    }
    return {
      id,
      title,
      detail,
      count: counted.length,
      failures: own.filter((s) => s.status === 'failed' && SAP_LOOKUP.has(s.name)).length,
      status: own.some((s) => s.status === 'running') ? 'running' : 'succeeded',
      steps: own,
    };
  });
}

// One line for a finished turn: "查阅 9 张表 · 编写 5 个章节 · 修订 1 处".
export function activitySummary(steps = []) {
  const done = steps.filter((s) => s.status === 'succeeded');
  const objects = groupObjects(done.filter((s) => SAP_LOOKUP.has(s.name)));
  const tables = objects.find((g) => g.group === '表')?.names.length ?? 0;
  const others = objects.filter((g) => g.group !== '表').reduce((n, g) => n + g.names.length, 0);
  const sections = new Set(
    done.filter((s) => s.name === 'write_document').flatMap((s) => sectionsOf(s.input)),
  ).size;
  const written = [
    ...new Set(
      done.filter((s) => s.name === 'write_artifact').map((s) => TARGETS[field(s.input, 'target')]),
    ),
  ].filter(Boolean);
  const count = (set) => done.filter((s) => set.has(s.name)).length;
  return [
    tables && `查阅 ${tables} 张表`,
    others && `查找 ${others} 个对象`,
    count(READING) && `阅读资料 ${count(READING)} 次`,
    sections && `编写 ${sections} 个章节`,
    written.length && `编写${written.join('和')}`,
    count(REVISING) && `修订 ${count(REVISING)} 处`,
    count(CHECKING) && '自动校验',
  ]
    .filter(Boolean)
    .join(' · ');
}

// --- The live status line ---------------------------------------------------------------------
export function runningText(step) {
  const objects = stepObjects(step).map((o) => o.name);
  if (SAP_LOOKUP.has(step.name) || READING.has(step.name))
    return objects.length
      ? `正在查阅 ${objects.slice(0, 3).join('、')}${objects.length > 3 ? ' 等' : ''}…`
      : `正在${toolLabel(step.name)}…`;
  if (WRITING.has(step.name) || REVISING.has(step.name)) return `正在保存：${writeTitle(step)}…`;
  return `正在${toolLabel(step.name)}…`;
}

// While the model is still writing a tool call's arguments (event tool.prepare).
export function preparingText({ name, chars = 0, sections = [] }) {
  const what =
    name === 'write_document' && sections.length
      ? `正在编写「${sections.at(-1)}」`
      : WRITING.has(name) || REVISING.has(name)
        ? '正在' + writeTitle({ name, input: {} })
        : `正在准备：${toolLabel(name)}`;
  return chars >= 200 ? `${what}… 已生成约 ${Math.round(chars / 100) * 100} 字` : `${what}…`;
}

// Reasoning summaries (Gemini, OpenAI) usually open each part with a bold heading.
export function reasoningHeading(text = '') {
  const found = [...String(text).matchAll(/\*\*([^*\n]{2,60})\*\*/g)];
  return found.at(-1)?.[1].trim() ?? '';
}

export function decisionFromQuestions(id, questions) {
  return {
    id,
    kind: 'business',
    message: '以下问题需要客户决定，请选择后提交；也可以补充其他口径。',
    questions: questions.map((q, i) => ({
      id: 'q' + (i + 1),
      title: q.background ? `${q.question}（${q.background}）` : q.question,
      allowText: true,
      options: q.options.map((o) => ({
        value: o.label,
        label: o.label,
        description: o.impact,
        recommended: o.label === q.recommended,
      })),
    })),
  };
}

// DecisionCard values ({q1: label | 'text:...'}) back into answers for the API.
export function answersFromValues(questions, values) {
  return questions.map((q, i) => {
    const value = values['q' + (i + 1)] ?? '';
    return value.startsWith('text:')
      ? { question: q.question, choice: '其他', note: value.slice(5) }
      : { question: q.question, choice: value };
  });
}

const STATUS = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'failed',
};

// Rebuilds the visible conversation: one user message and one assistant message per turn.
// Saved versions are `documents` (FSD) or `versions` (development plan and code).
export function buildTimeline({
  messages = [],
  turns = [],
  toolCalls = [],
  documents = [],
  versions = [],
}) {
  const saved = [...documents, ...versions];
  const out = [];
  const lastTurn = turns.at(-1);
  for (const turn of turns) {
    const own = messages.filter((m) => m.turnId === turn.id);
    const user = own.find((m) => m.role === 'user');
    if (user)
      out.push({
        id: user.id,
        role: 'user',
        content: user.content,
        status: 'completed',
        createdAt: user.createdAt,
        authorName: user.authorName ?? null,
        ...(user.payload?.answers?.length ? { answered: user.payload.answers.length } : {}),
      });
    // The outcome of an authorized test data run is stored as a second user message.
    const run = own.find((m) => m.role === 'user' && m.payload?.testDataRun);
    if (run)
      out.push({
        id: run.id,
        role: 'assistant',
        content: `**建单结果**\n\n${run.content}`,
        status: 'completed',
        createdAt: run.createdAt,
      });
    const asked = own.find((m) => m.role === 'tool' && m.payload?.questions?.length);
    const text = own
      // A failed turn's note ("本轮出错：…") is for the model's history; the error box says it.
      .filter((m) => m.role === 'assistant' && m.content?.trim() && !m.payload?.error)
      .map((m) => m.content.trim())
      .join('\n\n');
    const next = turns[turns.indexOf(turn) + 1];
    const answers = next
      ? messages.find((m) => m.turnId === next.id && m.role === 'user')?.payload?.answers
      : undefined;
    const doc = saved.filter((d) => d.turnId === turn.id).sort((a, b) => b.version - a.version)[0];
    const waiting = !!asked && turn === lastTurn && turn.status === 'completed';
    out.push({
      id: 'turn-' + turn.id,
      role: 'assistant',
      runId: turn.id,
      content: text,
      status: waiting ? 'waiting_user' : (STATUS[turn.status] ?? 'completed'),
      model: turn.model?.name,
      createdAt: turn.startedAt,
      finishedAt: turn.finishedAt,
      steps: toolCalls
        .filter((c) => c.turnId === turn.id && c.name !== 'ask_user')
        .map((c, i) => stepFromToolCall(c, i)),
      ...(asked
        ? {
            decision: decisionFromQuestions(asked.id, asked.payload.questions),
            answers: answers?.map((a) => ({ question: a.question, label: a.choice })),
          }
        : {}),
      ...(doc
        ? { artifact: { id: 'v' + doc.version, revision: doc.version, comparison: doc.comparison } }
        : {}),
      ...(turn.status === 'failed' || turn.status === 'interrupted'
        ? {
            error:
              turn.error?.message ??
              (turn.status === 'interrupted'
                ? '服务重启，本轮已中断。可以重新发送消息继续。'
                : '本轮未完成。'),
            errorCode: turn.error?.code,
          }
        : {}),
    });
  }
  return out;
}

// The open question batch, if the latest turn ended by asking.
export function pendingQuestions(detail) {
  const turn = detail.turns?.at(-1);
  if (!turn || turn.status !== 'completed') return null;
  const asked = (detail.messages ?? []).find(
    (m) => m.turnId === turn.id && m.role === 'tool' && m.payload?.questions?.length,
  );
  return asked ? { id: asked.id, questions: asked.payload.questions } : null;
}

// The test data request awaiting the user's authorization, if the latest turn ended with one.
export function pendingTestData(detail) {
  const turn = detail.turns?.at(-1);
  if (!turn || turn.status !== 'completed' || turn.stopReason !== 'authorization') return null;
  const asked = (detail.messages ?? []).find(
    (m) => m.turnId === turn.id && m.role === 'tool' && m.payload?.testDataRequest,
  );
  return asked?.payload.testDataRequest ?? null;
}
