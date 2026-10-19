// Development list field catalog shared by the API (validation, Excel) and the web table and drawer.
// Field keys address the item JSON: `name`, `fsd.status` (phase field), `custom.<id>` (custom column).

export const PHASES = [
  { key: 'fsd', label: 'FSD', group: 'FSD相关', assignee: '业务顾问', excel: 'FSD', effort: true },
  {
    key: 'development',
    label: '开发',
    group: '开发顾问相关',
    assignee: '开发人员',
    excel: '开发',
    effort: true,
  },
  {
    key: 'consultant_test',
    label: '顾问测试',
    group: '顾问测试相关',
    assignee: '顾问测试人',
    excel: '顾问测试',
    effort: false,
  },
  {
    key: 'user_test',
    label: 'IT/用户测试',
    group: 'IT顾问/用户测试相关',
    assignee: 'IT/用户测试人',
    excel: '用户测试',
    effort: false,
  },
];
export const PHASE_KEYS = PHASES.map((p) => p.key);

export const GROUPS = [
  { key: 'basic', label: '基本信息' },
  ...PHASES.map((p) => ({ key: p.key, label: p.group })),
  { key: 'custom', label: '自定义' },
];

export const OPTIONS = {
  module: { MM: 'MM', SD: 'SD', PP: 'PP', FICO: 'FICO' },
  kind: { report: '报表', function: '功能', interface: '接口', enhancement: '增强' },
  priority: { high: '高', medium: '中', low: '低' },
  difficulty: { hard: '难', medium: '中', easy: '易' },
  changeType: { new: '新增', rebuild: '重构', optimize: '优化' },
  status: {
    not_started: '未开始',
    in_progress: '进行中',
    completed: '已完成',
    delayed: '已延误',
    cancelled: '已取消',
  },
};

export const CUSTOM_TYPES = {
  text: '文本',
  long_text: '长文本',
  number: '数字',
  date: '日期',
  select: '单选',
  multi_select: '多选',
  member: '人员',
  checkbox: '勾选',
  url: '链接',
};
export const TAG_COLORS = ['gray', 'blue', 'green', 'orange', 'red', 'purple', 'teal', 'yellow'];
export const MAX_CUSTOM_FIELDS = 50;
export const MAX_TAGS_PER_ITEM = 20;
export const MAX_OBJECTS_PER_ITEM = 200;

const basic = [
  { key: 'code', label: '编号', type: 'readonly' },
  { key: 'module', label: '模块', type: 'select', options: OPTIONS.module, required: true },
  { key: 'kind', label: '类型', type: 'select', options: OPTIONS.kind, required: true },
  { key: 'name', label: '开发名称', type: 'text', required: true, max: 200 },
  { key: 'businessFunction', label: '业务功能点', type: 'rich' },
  { key: 'priority', label: '优先级', type: 'select', options: OPTIONS.priority },
  { key: 'difficulty', label: '难易度', type: 'select', options: OPTIONS.difficulty },
  { key: 'changeType', label: '开发类型', type: 'select', options: OPTIONS.changeType },
  { key: 'registeredOn', label: '开发项新增日期', type: 'date' },
  { key: 'businessOwner', label: '业务Owner', type: 'text', max: 100 },
  { key: 'notes', label: '基本备注', type: 'rich' },
  { key: 'tags', label: '标签', type: 'tags' },
].map((f) => ({ ...f, group: 'basic', excel: f.label }));

function phaseFields(phase) {
  const field = (name, label, type, extra = {}) => ({
    key: phase.key + '.' + name,
    phase: phase.key,
    name,
    label,
    type,
    group: phase.key,
    excel: phase.excel + '-' + label,
    ...extra,
  });
  return [
    field('assigneeId', phase.assignee, 'member', { excel: phase.assignee }),
    ...(phase.effort ? [field('effortDays', '人天预估', 'effort')] : []),
    field('plannedStart', '计划开始日期', 'date'),
    field('plannedEnd', '计划完成日期', 'date'),
    field('actualEnd', '实际完成日期', 'date'),
    field('progress', '完成百分比', 'percent'),
    field('status', '状态', 'select', { options: OPTIONS.status }),
    ...(phase.key === 'development'
      ? [
          {
            key: 'transactionCode',
            label: '事务码',
            type: 'text',
            max: 200,
            group: 'development',
            excel: '事务码',
          },
          {
            key: 'objects',
            label: '开发对象',
            type: 'objects',
            group: 'development',
            excel: '开发对象',
          },
        ]
      : []),
    field('notes', '备注', 'rich'),
  ];
}

export const FIELDS = [...basic, ...PHASES.flatMap(phaseFields)];
export const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const customKey = (id) => 'custom.' + id;

// Built-in labels and Excel headers a custom column may not reuse.
export const RESERVED_LABELS = new Set(FIELDS.flatMap((f) => [f.label, f.excel]));

// Custom column definition → field descriptor with the same shape as built-in fields.
export function customField(definition) {
  return {
    key: customKey(definition.id),
    label: definition.label,
    type: 'custom',
    customType: definition.fieldType,
    options: definition.options,
    group: definition.groupKey,
    required: definition.required,
    excel: definition.label,
    archived: !!definition.archivedAt,
  };
}

export function fieldValue(item, key) {
  if (key.startsWith('custom.')) return item.custom?.[key.slice(7)];
  const dot = key.indexOf('.');
  if (dot > 0) return item.phases?.[key.slice(0, dot)]?.[key.slice(dot + 1)];
  return item[key];
}

// A completed phase is always 100%; other states keep the manually maintained value.
export function progressFor(status, progress) {
  return status === 'completed' ? 100 : progress;
}

// Plain-text rendering of stored rich text (Excel, search, model context).
export function richText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|li|h2|h3|tr|blockquote|pre)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The two assistants of an item and the phase each one works in (contract 3.5).
export const AGENT_STAGES = {
  design: { agent: 'agent.fsd', phase: 'fsd' },
  development: { agent: 'agent.dev', phase: 'development' },
};
// Kinds the development assistant writes code for.
export const DEV_AGENT_KINDS = ['report', 'function'];
// Who owns an item's work in a stage for "own items only": the phase's assignee, else the
// creator. The API and the web decide entry buttons with the same rule.
export function stageOwner(phaseAssigneeId, createdBy) {
  return phaseAssigneeId || createdBy || null;
}
