export function suggestType(request, correction = null) {
  if (correction && !['R', 'I', 'C', 'E'].includes(correction))
    throw new Error('Invalid RICE type');
  if (correction)
    return { riceType: correction, source: 'consultant', supported: true, reason: '顾问选择' };
  if (/smartforms|smart forms|打印表单|\bform\b/i.test(request))
    return {
      riceType: null,
      source: 'suggestion',
      supported: false,
      reason: '本期不支持Form/SmartForms',
    };
  const riceType = /迁移|转换装载|migration/i.test(request)
    ? 'C'
    : /增强|badi|user.?exit/i.test(request)
      ? 'E'
      : /接口|消息推送|webhook|api对接/i.test(request)
        ? 'I'
        : /报表|列表|清单|统计|alv/i.test(request) ||
            (/拉出来|列出|显示|查看/.test(request) && /筛选|合计|汇总/.test(request))
          ? 'R'
          : null;
  return {
    riceType,
    source: 'suggestion',
    supported: true,
    reason: riceType ? '依据需求关键词建议，顾问可纠正' : '请顾问选择R/I/C/E类型',
  };
}
export function planRun({ request = '', riceType = null, action = 'dialogue', attempt = 1 } = {}) {
  const labels =
    action === 'draft'
      ? [
          ['understand', '识别类型与需求'],
          ['generate', '模型生成结构化草稿（JSON）'],
          ['validate', '校验结构与引用'],
          ['verify', '核验SAP对象'],
          ['save', '本地脚本转换 Markdown 并保存版本'],
        ]
      : [
          ['understand', '识别类型与需求'],
          ['generate', '分析与回复'],
        ];
  return {
    planVersion: 1,
    type: suggestType(request, riceType),
    steps: labels.map(([stepId, label], i) => ({
      stepId,
      label,
      dependencies: i ? [labels[i - 1][0]] : [],
      status: 'queued',
      attempt: attempt - 1,
      startedAt: null,
      finishedAt: null,
      summary: '',
    })),
  };
}
export function transitionStep(plan, id, status, summary = '') {
  const s = plan.steps.find((x) => x.stepId === id);
  if (!s) throw new Error('Unknown step');
  const allowed = {
    queued: ['running', 'skipped', 'cancelled'],
    running: ['succeeded', 'failed', 'waiting_user', 'cancelled'],
    waiting_user: ['running', 'cancelled'],
    failed: ['running'],
    succeeded: [],
    cancelled: [],
    skipped: [],
  };
  if (!allowed[s.status]?.includes(status)) throw new Error('Invalid step transition');
  if (
    status === 'running' &&
    s.dependencies.some(
      (id) => !['succeeded', 'skipped'].includes(plan.steps.find((x) => x.stepId === id).status),
    )
  )
    throw new Error('Dependency incomplete');
  if (status === 'skipped' && !summary) throw new Error('Skip reason required');
  if (status === 'running') {
    s.attempt++;
    s.startedAt = new Date().toISOString();
    s.finishedAt = null;
  }
  if (['succeeded', 'failed', 'skipped', 'cancelled', 'waiting_user'].includes(status))
    s.finishedAt = new Date().toISOString();
  Object.assign(s, { status, summary });
  return structuredClone(s);
}
