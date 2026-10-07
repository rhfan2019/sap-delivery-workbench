// Deterministic consultant view. The saved JSON remains the sole source of facts.
const decisionLabels = { proposed: '建议', open: '待确认', consultant_confirmed: '顾问已确认' };
// Translate only contract enum positions. Business prose and decision values remain literal.
const enumLabels = {
  direction: {
    inbound: '接收',
    outbound: '发送',
    bidirectional: '双向',
    input: '输入',
    output: '输出',
    inout: '输入及输出',
  },
  interaction: { synchronous: '同步', asynchronous: '异步' },
  logicalType: {
    string: '文本',
    number: '数值',
    integer: '整数',
    decimal: '小数',
    boolean: '是非标识',
    date: '日期',
    datetime: '日期时间',
    object: '结构',
    array: '集合',
    binary: '二进制',
  },
  verificationStatus: {
    unverified: '未核验',
    verified: '已核验',
    partial: '部分核验',
    not_found: '未找到',
    unreadable: '无法读取',
    conflicting: '核验冲突',
    stale: '证据已过期',
  },
  discoveryStatus: {
    not_selected: '尚未选择系统',
    pending: '待识别',
    available: '可用',
    unavailable: '不可用',
    partial: '部分可用',
  },
  identificationSource: {
    unknown: '未知',
    mcp: '受控查询',
    consultant: '顾问提供',
    mixed: '综合来源',
  },
  priority: { high: '高', medium: '中', low: '低' },
  issueStatus: { resolved: '已解决', accepted: '已知悉，仍未解决', open: '待确认' },
};
const labels = {
  dataSources: '数据来源',
  calculationRuleIds: '计算规则',
  direction: '方向',
  sender: '发送方',
  receiver: '接收方',
  interaction: '交互方式',
  trigger: '触发方式',
  protocolAndFormat: '协议与格式',
  contractVersion: '消息契约版本',
  messageStructure: '消息结构',
  mappingRuleIds: '映射规则',
  successDefinition: '成功定义',
  transactionBoundary: '事务边界',
  idempotency: '重复请求处理',
  ordering: '处理顺序',
  timeoutRetry: '超时与重试',
  partialFailureRecovery: '部分失败恢复',
  errorContract: '错误约定',
  monitoringAndReconciliation: '监控与对账',
  volumeAndLatencyTarget: '容量与处理时限',
  businessObjects: '业务对象',
  sourceSystem: '来源系统',
  targetSystem: '目标系统',
  migrationScope: '迁移范围',
  loadMechanism: '装载方式',
  cleansingAndDefaults: '清洗与默认规则',
  dependencyAndLoadOrder: '依赖与装载顺序',
  simulation: '模拟执行',
  batchCheckpoint: '批次检查点',
  rejectionAndRepair: '拒绝与纠正',
  rerunDeduplication: '重跑去重',
  reconciliation: '对账',
  cutoverWindow: '切换窗口',
  recoveryOrCompensation: '恢复与补偿',
  completionCriteria: '完成标准',
  businessTrigger: '业务触发',
  hostProcess: '所属标准流程',
  enhancementObjectId: '候选增强对象',
  signatureAndParameters: '调用约定与参数',
  inputFieldIds: '输入字段',
  outputFieldIds: '输出字段',
  applicabilityFilters: '适用条件',
  behaviorRuleIds: '处理规则',
  transactionAndCommit: '事务与提交',
  lockingAndConcurrency: '锁与并发',
  errorPropagation: '错误反馈',
  repeatAndReentry: '重复触发与重入',
  coexistenceAndSequence: '共存与执行顺序',
  performanceTarget: '性能目标',
  activationAndFallback: '启用与回退',
  standardRegression: '标准流程回归',
  path: '路径',
  fieldIds: '字段',
  reportPurpose: '报表目的',
  resultGrain: '结果颗粒度',
  historicalCutoffRule: '基准日规则',
  aggregationRule: '汇总规则',
  currencyUnitRule: '币种与单位',
  displayAndDrilldown: '显示与下钻',
  emptyAndExceptionBehavior: '空数据与异常',
  volumeAndResponseTarget: '数据量与响应',
  reconciliationMethod: '对账方法',
  selectionId: '系统标识',
  discoveryStatus: '识别状态',
  product: '产品',
  productVersion: '产品版本',
  deployment: '部署方式',
  abapVersion: 'ABAP版本',
  identificationSource: '识别来源',
  evidenceIds: '证据引用',
  limitations: '限制',
  id: '标识',
  kind: '类别',
  label: '说明',
  reference: '来源引用',
  channel: '渠道',
  sourceReference: '证据来源',
  systemFingerprint: '系统范围',
  capturedAt: '采集时间',
  claim: '核验结论',
  logicalType: '逻辑类型',
  required: '必输',
  cardinality: '基数',
  sourcePath: '来源字段',
  targetPath: '目标字段',
  format: '格式',
  defaultRule: '默认规则',
  validationRule: '校验规则',
  mappingRule: '映射规则',
  unitCurrencyRule: '单位币种规则',
  sapObjectIds: 'SAP对象引用',
  businessLabel: '业务名称',
  inputStyle: '输入方式',
  displayRule: '显示与编辑要求',
};
const safe = (value) =>
  String(value)
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '；')
    .replace(/#/g, '\\#');
const enumText = (key, value) =>
  value === null || value === undefined ? '未提供' : safe(enumLabels[key]?.[value] ?? value);
function prose(value, spec, trace = false) {
  if (value === null || value === undefined) return '未提供';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value))
    return value.length ? value.map((v) => prose(v, spec, trace)).join('；') : '无';
  if (typeof value !== 'object') return safe(value);
  if ('status' in value && 'value' in value) {
    const issues = (value.issueIds ?? []).map((id) =>
      trace ? id : (spec.issues.find((i) => i.id === id)?.description ?? '相关问题待确认'),
    );
    return (
      `${decisionLabels[value.status] ?? '待确认'}：${prose(value.value, spec, trace)}` +
      (issues.length ? `（待确认事项：${issues.map(safe).join('；')}）` : '')
    );
  }
  return Object.entries(value)
    .map(
      ([key, v]) =>
        `${labels[key] ?? safe(key)}：${Object.hasOwn(enumLabels, key) && typeof v === 'string' ? enumText(key, v) : prose(v, spec, trace)}`,
    )
    .join('；');
}
const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
const fieldName = (field) =>
  safe(
    field.businessLabel ??
      (/^[A-Za-z0-9_.-]+$/.test(field.name) ? field.businessMeaning : field.name),
  );
function fieldSource(field, spec) {
  const objects = field.sapObjectIds
    .map((id) => spec.sapObjects.find((o) => o.id === id))
    .filter(Boolean);
  const unverified = !objects.length || objects.some((o) => o.verificationStatus !== 'verified');
  return `${unverified ? '候选映射（待核验）：' : '已核验映射：'}${safe(field.sourcePath ?? '未提供')}`;
}
function businessReferences(value, spec) {
  if (Array.isArray(value)) return value.map((v) => businessReferences(v, spec));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, businessReferences(v, spec)]),
    );
  if (typeof value !== 'string') return value;
  const field = spec.fields.find((f) => f.id === value);
  if (field) return field.businessLabel ?? field.businessMeaning;
  for (const group of ['rules', 'requirements', 'issues', 'sapObjects', 'sources', 'tests']) {
    const item = spec[group].find((v) => v.id === value);
    if (item) return item.description ?? item.name ?? item.label ?? item.scenario;
  }
  return value;
}
function contractValue(key, value, spec) {
  if (key === 'dataSources')
    return value
      .map((source) => {
        const object = spec.sapObjects.find((o) => o.id === source.sapObjectId);
        return `${safe(object?.name ?? '来源待核验')}（${enumText('verificationStatus', object?.verificationStatus ?? 'unverified')}）：${safe(source.usage)}`;
      })
      .join('；');
  if (key.endsWith('FieldIds'))
    return value.map((id) => fieldName(spec.fields.find((f) => f.id === id))).join('；');
  if (key.endsWith('RuleIds'))
    return value
      .map((id) => prose(spec.rules.find((r) => r.id === id)?.description, spec))
      .join('；');
  if (Object.hasOwn(enumLabels, key) && typeof value === 'string') return enumText(key, value);
  return prose(businessReferences(value, spec), spec);
}
export function renderConsultantMarkdown(spec) {
  const p = (v) => prose(v, spec);
  const details = spec.consultantDetails ?? {};
  const contract = spec.contract;
  const chosen = (key, directions) =>
    contract[key]
      ? contract[key].map((id) => spec.fields.find((f) => f.id === id)).filter(Boolean)
      : spec.fields.filter((f) => directions.includes(f.direction));
  const selection = chosen('selectionFieldIds', ['input', 'inout']);
  const output = chosen('outputFieldIds', ['output', 'inout']);
  const out = [
    `# ${safe(spec.title)}`,
    '开发功能说明书',
    table(
      ['文档信息', '内容'],
      [
        ['文档名称', safe(spec.title)],
        ['文档版本', String(spec.revision)],
        ['开发类型', { R: '报表', I: '接口', C: '转换迁移', E: '增强' }[spec.riceType]],
        [
          '适用平台',
          `${p(spec.systemContext.product)}；${p(spec.systemContext.productVersion)}；${p(spec.systemContext.deployment)}`,
        ],
        ['文档状态', '草稿，尚未经顾问最终确认或正式签署'],
        ['实测状态', '以下为设计和测试准备要求，尚未执行目标 SAP 集成测试或业务验收'],
      ],
    ),
    '## 1 开发需求部分',
    '### 1.1 开发概览',
    table(
      ['项目', '内容'],
      [
        ['需求概述', p(spec.purpose)],
        ['运行类型', p(details.executionMode)],
        ['使用者', p(details.users)],
        ['输出方式', p(details.outputMode)],
        ['交易量与响应目标', p(contract.volumeAndResponseTarget)],
      ],
    ),
    '### 1.2 业务需求描述',
    p(spec.purpose),
    table(
      ['序号', '业务需求', '验收口径'],
      spec.requirements.map((r, i) => [String(i + 1), p(r.description), p(r.acceptanceCriterion)]),
    ),
    '业务范围：' + p(spec.scope.included),
    '范围之外：' + p(spec.scope.excluded),
    '## 2 功能规范',
    '### 2.1 权限设计',
  ];
  if (spec.riceType === 'R') {
    out.push(
      '### 2.2 选择屏幕设计及其布局',
      p(details.selectionLayout),
      table(
        ['字段名称', '输入方式', '参考来源', '必填/可选', '业务说明', '默认值'],
        selection.map((f) => [
          fieldName(f),
          p(f.inputStyle),
          fieldSource(f, spec),
          f.required ? '必填' : '可选',
          p(f.businessMeaning),
          p(f.defaultRule),
        ]),
      ),
      '### 2.3 选择屏幕检查确认',
      table(
        ['序号', '选择字段', '格式及检查规则'],
        selection.map((f, i) => [
          String(i + 1),
          fieldName(f),
          `${p(f.format)}；${p(f.validationRule)}`,
        ]),
      ),
      '空数据与异常：' + p(contract.emptyAndExceptionBehavior),
      '### 2.4 输出布局及样式',
      p(details.outputLayout),
      '结果颗粒度：' + p(contract.resultGrain),
      '显示与下钻：' + p(contract.displayAndDrilldown),
      table(
        ['字段/列标题', '来源或计算', '类型及长度', '显示与编辑要求'],
        output.map((f) => [
          fieldName(f),
          `${fieldSource(f, spec)}；${p(f.mappingRule)}`,
          `${enumText('logicalType', f.logicalType)}；${p(f.format)}`,
          `${p(f.displayRule)}；${p(f.unitCurrencyRule)}；校验：${p(f.validationRule)}`,
        ]),
      ),
    );
  } else {
    out.push(
      '### 2.2 输入与输出字段',
      table(
        ['字段', '业务含义', '方向', '类型及格式', '来源及映射', '默认及校验'],
        spec.fields.map((f) => [
          fieldName(f),
          p(f.businessMeaning),
          enumText('direction', f.direction),
          `${enumText('logicalType', f.logicalType)}；${p(f.format)}`,
          `${fieldSource(f, spec)}；${p(f.mappingRule)}`,
          `${p(f.defaultRule)}；${p(f.validationRule)}；${p(f.unitCurrencyRule)}`,
        ]),
      ),
    );
  }
  out.push(
    '## 3 业务逻辑',
    '### 3.1 业务处理步骤',
    table(
      ['步骤', '业务处理', '规则状态与处理口径'],
      spec.rules.map((r, i) => [String(i + 1), p(r.description), p(r.decision)]),
    ),
    '### 3.2 取数、计算与处理边界',
    table(
      ['主题', '业务口径'],
      Object.entries(contract)
        .filter(
          ([key]) =>
            ![
              'selectionFieldIds',
              'outputFieldIds',
              'displayAndDrilldown',
              'resultGrain',
              'emptyAndExceptionBehavior',
              'volumeAndResponseTarget',
            ].includes(key),
        )
        .map(([key, value]) => [labels[key] ?? safe(key), contractValue(key, value, spec)]),
    ),
    '## 4 开发测试数据',
    '以下为测试数据准备条件和预期结果，并非生产数据或已经执行的 SAP 测试记录。',
    table(
      ['序号', '场景', '数据/前置条件', '预期结果', '验证方法'],
      spec.tests.map((t, i) => [
        String(i + 1),
        p(t.scenario),
        `前置：${p(t.preconditions)}；输入：${p(t.input)}`,
        p(t.expectedResult),
        p(t.verificationMethod),
      ]),
    ),
    '## 附录：来源、核验与遗留问题',
    `规格标识：${safe(spec.specId)}；版本：${spec.revision}；类型：${safe(spec.riceType)}`,
    '### 需求、规则与测试追溯',
    table(
      ['类别', '标识', '说明', '关联引用'],
      [
        ...spec.requirements.map((r) => ['需求', safe(r.id), p(r.description), p(r.sourceIds)]),
        ...spec.rules.map((r) => [
          '规则',
          safe(r.id),
          p(r.description),
          `${p(r.requirementIds)}；${prose(r.decision, spec, true)}`,
        ]),
        ...spec.tests.map((t) => [
          '测试',
          safe(t.id),
          p(t.scenario),
          `需求：${p(t.requirementIds)}；规则：${p(t.ruleIds)}`,
        ]),
      ],
    ),
    '### 完整字段及技术映射',
    table(
      ['字段标识', '原字段名称', '业务名称', '字段合同'],
      spec.fields.map((f) => [
        safe(f.id),
        safe(f.name),
        fieldName(f),
        prose(
          Object.fromEntries(
            Object.entries(f).filter(([k]) => !['id', 'name', 'businessMeaning'].includes(k)),
          ),
          spec,
          true,
        ),
      ]),
    ),
    '### 系统',
    prose(spec.systemContext, spec, true),
    '### 来源',
    table(
      ['来源标识', '说明', '类型', '来源引用'],
      spec.sources.map((s) => [safe(s.id), p(s.label), p(s.kind), p(s.reference)]),
    ),
    '### SAP对象',
    table(
      ['对象标识', '对象名称', '用途', '核验状态及范围', '证据及问题'],
      spec.sapObjects.map((o) => [
        safe(o.id),
        p(o.name),
        p(o.purpose),
        `${enumText('verificationStatus', o.verificationStatus)}；${p(o.verificationScope)}`,
        `证据：${p(o.evidenceIds)}；问题：${p(o.issueIds)}`,
      ]),
    ),
    '### 证据',
    spec.evidence.length
      ? spec.evidence.map((e) => prose(e, spec, true)).join('\n\n')
      : '尚无核验证据。',
    '### 问题（已知悉仍未解决）',
    table(
      ['问题标识', '状态/优先级', '问题及影响', '建议及跟进', '责任人及处置'],
      spec.issues.map((i) => [
        safe(i.id),
        `${enumText('issueStatus', i.status)}/${enumText('priority', i.priority)}`,
        `${p(i.description)}；影响：${p(i.impact)}`,
        `${p(i.suggestion)}；跟进：${p(i.followUp)}；关联：${p(i.relatedIds)}`,
        `${p(i.owner)}；处置：${p(i.resolution)}`,
      ]),
    ),
  );
  return out.join('\n\n') + '\n';
}
