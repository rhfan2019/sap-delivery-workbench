// Explicit synthetic demonstration provider. Never used for REAL tasks.
// ZPOC names are fabricated test objects, not SAP standard object claims.
import { toFsdWire } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-wire';

// The document the synthetic model "writes": a read-only open-order list on ZPOC_ORDER.
export const SYNTHETIC_DOCUMENT = Object.freeze({
  overview: {
    summary: '合成测试：未清订单清单（ZPOC 测试伪对象）',
    difficulty: '低',
    tcode: 'ZPOC01',
    run_type: '在线处理',
    output_to: 'ALV',
    volume: '合成数据，少量',
    remark: '只读；不涉及真实 SAP',
  },
  requirement: {
    background: '合成测试报表：查看当前未清订单行，用于验证工程流程。',
    goals: ['以订单行为粒度列出未清订单；', '显示剩余数量。'],
    roles: [{ role: '测试用户', scenario: '运行合成测试' }],
    scope_in: ['未清订单行的查询与展示。'],
    scope_out: ['任何写操作。'],
    constraints: ['未清口径见 [[LOG-OPEN]]。'],
  },
  authorizations: {
    items: [
      {
        id: 'AUTH-DISPLAY',
        timing: '执行查询时',
        auth_object: 'ZPOC_AUTH',
        auth_object_text: '合成测试权限',
        fields: 'ACTVT = 03',
        value_source: '固定值',
        basis: { kind: 'INFERENCE' },
      },
    ],
  },
  selection_screen: {
    fields: [
      {
        id: 'SEL-ORDER',
        label: '订单',
        kind: 'S',
        ref: 'ZPOC_ORDER-ORDER_ID',
        required: true,
        description: '订单编号',
        basis: { kind: 'INFERENCE' },
      },
    ],
  },
  selection_checks: {
    items: [
      { id: 'CHK-REQUIRED', title: '必填校验', body: '订单未录入时按 [[MSG-NO-ORDER]] 提示。' },
    ],
  },
  output: {
    intro: '一行代表一个订单行，按订单、行号升序排列。',
    fields: [
      {
        id: 'OUT-ORDER',
        name: 'ORDER_ID',
        ref: 'ZPOC_ORDER-ORDER_ID',
        description: '订单编号',
        handling: '显示',
      },
      {
        id: 'OUT-REMAINING',
        name: 'REMAINING',
        ref: '计算，见 [[LOG-OPEN]]',
        description: '剩余数量',
        handling: '显示',
      },
    ],
    requirements: ['不同单位不汇总，不提供合计行。'],
  },
  actions: {
    items: [
      {
        id: 'ACT-REFRESH',
        label: '刷新',
        function: '重新查询',
        scope: '全部清单',
        logic: '见 [[LOG-QUERY]]',
      },
    ],
  },
  logic: {
    sections: [
      {
        id: 'LOG-QUERY',
        title: '数据查询',
        trigger: '用户执行选择屏幕。',
        sap_refs: [{ type: 'TABLE', name: 'ZPOC_ORDER' }],
        blocks: [
          {
            id: 'BLK-QUERY-FETCH',
            kind: '取数逻辑',
            items: ['从测试伪对象 ZPOC_ORDER 按订单取数，订单行粒度。'],
          },
        ],
      },
      {
        id: 'LOG-OPEN',
        title: '未清判定',
        basis: { kind: 'INFERENCE' },
        blocks: [
          {
            id: 'BLK-OPEN-RULES',
            kind: '判定逻辑',
            items: ['REMAINING = max(QUANTITY - PROCESSED, 0)；仅 REMAINING > 0 的行纳入。'],
          },
        ],
      },
    ],
  },
  messages: {
    items: [
      {
        id: 'MSG-NO-ORDER',
        scenario: '订单未录入',
        type: 'E',
        text: '请录入订单',
        handling: '停留在选择屏幕',
      },
    ],
  },
  working: {
    lifecycle: [
      {
        id: 'LC-CREATE',
        stage: '创建',
        action: '创建合成订单',
        impact: '进入清单',
        decision: '纳入',
      },
    ],
    open_issues: [
      {
        id: 'ISS-SYNTHETIC',
        title: '合成数据不能作为真实开发依据',
        blocking: false,
        status: 'OPEN',
      },
    ],
  },
});
const OUTLINE = [
  '> 思路：合成提纲。',
  '## 提纲',
  '| 编号 | 类型 | 标题 | 摘要 |',
  '| --- | --- | --- | --- |',
  '| LOG-QUERY | 逻辑 | 数据查询 | ZPOC_ORDER 取数 |',
  '| LOG-OPEN | 逻辑 | 未清判定 | 剩余数量大于零 |',
  '| MSG-NO-ORDER | 消息 | 订单未录入 | E 类提示 |',
].join('\n');

/** Wire text of the given parts of the synthetic document. */
export const syntheticWire = (parts) =>
  '> 思路：合成内容。\n' + toFsdWire(SYNTHETIC_DOCUMENT, { parts });

export async function syntheticModel({ kind, context, part }) {
  const { r, t } = context;
  const usage = { total_tokens: 200 };
  if (kind === 'FsdOutline') return { output: { text: OUTLINE }, usage, cost: null };
  if (kind === 'FsdWrite')
    return { output: { text: syntheticWire(part.parts) }, usage, cost: null };
  // A revision that has nothing to change answers with its thought line only.
  if (kind === 'FsdRevise')
    return { output: { text: '> 思路：合成修订，无需修改。' }, usage, cost: null };
  const output = {
    output_schema_version: 2,
    kind,
    input_snapshot_id: r.input_snapshot_id,
    base_artifact_version: t.artifact_version,
    decision: 'PROPOSE',
    reason_code: 'SYNTHETIC',
    evidence_refs: t.evidence.map((e) => e.id),
    unresolved_issues: [],
  };
  if (kind === 'AnalysisResult')
    Object.assign(output, {
      goal: '合成未清订单报表',
      scope: 'report',
      standard_fit: 'UNKNOWN',
      claims: [],
      gaps: [],
      decision: !t.evidence.length
        ? 'NEED_QUERY'
        : !Object.keys(r.snapshot.answers).length
          ? 'NEED_CLARIFICATION'
          : 'PROPOSE',
    });
  if (kind === 'QueryPlan')
    Object.assign(output, {
      items: [
        {
          gap_id: 'open-order-definition',
          target_ref: t.target.target_ref,
          tool_name: 'searchObject',
          arguments: { query: 'ZPOC_ORDER', max: 10 },
          required_properties: ['type', 'quantity', 'unit', 'status'],
          supports_rule_refs: ['LOG-OPEN'],
        },
      ],
      decision: 'NEED_QUERY',
    });
  if (kind === 'EvidenceAssessment')
    Object.assign(output, {
      assessments: t.evidence.map((e) => ({
        evidence_ref: e.id,
        completeness: 'COMPLETE',
        fact_status: 'VERIFIED',
        validity: 'VALID',
        missing_properties: [],
        conflicts: [],
      })),
      decision: Object.keys(r.snapshot.answers).length ? 'PROPOSE' : 'NEED_CLARIFICATION',
    });
  if (kind === 'ClarificationBatch')
    Object.assign(output, {
      return_phase: 3,
      questions: [
        {
          id: 'open-definition',
          question: '本合成报表如何定义未清？',
          background: 'ZPOC 测试伪对象含订单量、已处理量与状态。',
          recommendation_reason: '按剩余数量可展示部分处理。',
          options: [
            {
              id: 'remaining',
              label: '剩余数量大于零',
              impact: '包括部分处理，排除取消。',
              recommended: true,
              other: false,
              requires_material: false,
            },
            {
              id: 'other',
              label: '其他',
              impact: '补充客户定义。',
              recommended: false,
              other: true,
              requires_material: false,
            },
          ],
        },
      ],
    });
  if (kind === 'ReviewResult') Object.assign(output, { issues: [], decision: 'READY_FOR_REVIEW' });
  return { output, usage, cost: null };
}
export async function syntheticTool(item, { target, read_generation }) {
  return {
    status: 'SUCCESS',
    remote_outcome: 'SUCCEEDED',
    target_ref: target.target_ref,
    client: target.client,
    source_version: 'synthetic-1',
    observed_at: new Date().toISOString(),
    read_generation,
    coverage: {
      complete: true,
      truncated: false,
      properties: ['type', 'quantity', 'unit', 'status'],
      version_kind: 'ACTIVE',
    },
    validity: 'VALID',
    data: {
      object: 'ZPOC_ORDER',
      notice: '测试伪对象',
      quantity_type: 'DEC13.3',
      unit_type: 'CHAR3',
    },
  };
}
