// Explicit synthetic demonstration provider. Never used for REAL tasks.
// ZPOC names are fabricated test objects, not SAP standard object claims.
export async function syntheticModel({ kind, context }) {
  const { r, t } = context;
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
          supports_rule_refs: ['rule-open'],
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
  if (kind === 'ChangeProposal') {
    const contents = [
      '合成测试报表：查看当前未清订单行；只读，不涉及真实 SAP。范围为 ZPOC 测试伪对象。',
      '创建纳入；部分处理显示剩余；完成和关闭排除；取消排除。行状态优先于抬头。无历史还原依据，因此仅支持当前时点。',
      'ZPOC_ORDER（测试伪对象）：ORDER_ID 字符10、ITEM 整数、QUANTITY 十进制13/3、PROCESSED 十进制13/3、UNIT 字符3、STATUS 字符10。依据为合成只读返回。',
      '标准功能适用性尚无真实 SAP 证据；本合成试验只验证工程流程，不证明自开发必要性。',
      '选择屏幕：ORDER_ID 单值/区间/多值，空条件拒绝，不设默认；STATUS 固定排除取消。输出一行一订单行，按 ORDER_ID/ITEM 排序，显示数量与 UNIT；不同单位不汇总；无数据显示空结果，权限不足拒绝查询。只读导出当前结果。',
      'rule-open：REMAINING=max(QUANTITY-PROCESSED,0)，按订单行计算，取消/完成/关闭排除，仅 REMAINING>0 纳入；订单与行按 ORDER_ID/ITEM 一对一，不匹配列为缺口；单位不相同不可相加。',
      '检查反例：部分处理保留、取消排除、抬头完成但行未完成按行规则、无多匹配、跨单位不汇总。合成输入无未解决反例，真实适用性未验证。',
      '依赖：ZPOC_ORDER 测试伪对象；引用当前 evidence ID 和 read_generation。全部材料为 SYNTHETIC，不能作为真实开发依据。',
    ];
    const changes = contents.map((content, i) => ({
      object_id: 'section-' + (i + 1),
      base_version: t.objects['section-' + (i + 1)]?.version ?? 0,
      op: t.objects['section-' + (i + 1)] ? 'REVISE' : 'ADD',
      content,
      dependencies: output.evidence_refs,
      reason: 'SYNTHETIC',
      section: i + 1,
    }));
    Object.assign(output, {
      proposal_id: 'proposal-' + t.phase,
      allowed_scope: changes.map((c) => c.object_id),
      changes,
    });
  }
  if (kind === 'ReviewResult') Object.assign(output, { issues: [], decision: 'READY_FOR_REVIEW' });
  return { output, usage: { total_tokens: 200 }, cost: null };
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
