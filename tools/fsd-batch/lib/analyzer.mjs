export const duration = (start, end) =>
  start && end && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end))
    ? Math.max(0, Date.parse(end) - Date.parse(start))
    : null;
export function analyzeRun(run, trace = []) {
  const s = run.snapshot ?? {};
  const ends = new Map(
    trace
      .filter((e) => ['model.completed', 'model.failed'].includes(e.type))
      .map((e) => [e.data.callId, e]),
  );
  const starts = new Map(
    trace.filter((e) => e.type === 'model.started').map((e) => [e.data.callId, e]),
  );
  const calls = [...new Set([...starts.keys(), ...ends.keys()])].map((id) => {
    const e = ends.get(id) ?? starts.get(id),
      result = e.data.result ?? e.data.error ?? {};
    const attempts = result.attempts ?? [];
    const usages = attempts.length
      ? attempts.map((a) => a.usage).filter(Boolean)
      : [result.usage].filter(Boolean);
    const sum = (key) =>
      usages.some((u) => typeof u[key] === 'number')
        ? usages.reduce((n, u) => n + (u[key] ?? 0), 0)
        : null;
    return {
      callId: e.data.callId,
      stage: e.data.stage,
      task: e.data.task,
      status:
        e.type === 'model.completed'
          ? 'succeeded'
          : e.type === 'model.failed'
            ? 'failed'
            : 'interrupted',
      durationMs: e.data.durationMs ?? null,
      usage: usages.length
        ? {
            prompt_tokens: sum('prompt_tokens'),
            completion_tokens: sum('completion_tokens'),
            total_tokens: sum('total_tokens'),
            completion_tokens_details: {
              reasoning_tokens: usages.some(
                (u) => u.completion_tokens_details?.reasoning_tokens != null,
              )
                ? usages.reduce(
                    (n, u) => n + (u.completion_tokens_details?.reasoning_tokens ?? 0),
                    0,
                  )
                : null,
            },
          }
        : null,
      attempts,
      providerRequests: Math.max(
        attempts.length,
        trace.filter((x) => x.type === 'provider.started' && x.data.callId === id).length,
        1,
      ),
      diagnostics: e.data.result?.diagnostics ?? e.data.error?.diagnostics ?? null,
      error: e.data.error ?? null,
    };
  });
  const steps = (s.plan?.steps ?? []).map((x) => ({
    ...x,
    durationMs: duration(x.startedAt, x.finishedAt),
  }));
  const errors = s.validation?.errors ?? s.repair?.validation?.errors ?? [];
  const structure = steps.find((x) => x.stepId === 'validate');
  return {
    runId: run.runId,
    state: run.state,
    elapsedMs: duration(run.createdAt, s.finishedAt),
    executionCompleted: run.state === 'completed',
    structurePassed: s.validation?.valid ?? (structure?.status === 'succeeded' ? true : null),
    saved: !!run.artifact?.id || !!s.artifactId,
    businessQuality: 'not_evaluated',
    qualityReview: s.qualityReview ?? null,
    qualityIssues: s.validation?.qualityIssues ?? [],
    failure: s.failure ?? null,
    errors,
    steps,
    calls,
    localValidations: trace.filter((e) => e.type === 'validation.completed').map((e) => e.data),
    sapCalls: trace
      .filter((e) => ['sap.completed', 'sap.failed'].includes(e.type))
      .map((e) => ({ ...e.data, status: e.type === 'sap.completed' ? 'succeeded' : 'failed' })),
    traceComplete:
      trace.some((e) =>
        ['run.completed', 'run.failed', 'run.cancelled', 'run.waiting_user'].includes(e.type),
      ) &&
      !calls.some((c) => c.status === 'interrupted') &&
      !trace.some((e) => e.type === 'trace.corrupt'),
    traceAvailable: trace.length > 0,
    traceErrors: trace.filter((e) => e.type === 'trace.corrupt').map((e) => e.data),
  };
}
export function recommendations(runs) {
  const out = [];
  for (const r of runs) {
    if (r.calls.some((c) => c.status === 'interrupted'))
      out.push({
        runId: r.runId,
        evidence: '模型调用有开始但无完成事件',
        recommendation:
          '按中断调用统计，耗时及用量未知；结合租约恢复与进程日志排查，不能视为未调用。',
      });
    if (!r.traceAvailable)
      out.push({
        runId: r.runId,
        evidence: '缺少结构化轨迹',
        recommendation: '不能将缺失耗时当成零；检查日志目录和服务版本。',
      });
    if (r.calls.some((c) => c.stage === 'validate'))
      out.push({
        runId: r.runId,
        evidence: '校验阶段存在模型调用',
        recommendation: '将本地校验与模型修正耗时分开；评估字段补丁替代整份重写。',
      });
    if (r.errors.some((e) => e.code === 'untrusted_confirmation'))
      out.push({
        runId: r.runId,
        evidence: 'untrusted_confirmation',
        recommendation: '生成契约排除可信确认状态，由服务端按原始回答维护确认。',
      });
    const slow = [...r.calls].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];
    if (slow)
      out.push({
        runId: r.runId,
        evidence: `最慢调用 ${slow.callId} / ${slow.task}: ${slow.durationMs} ms`,
        recommendation:
          '优先评估该阶段的输入、输出和推理 token；同用例对照测试后再调整模型或拆分生成。',
      });
    if (r.failure)
      out.push({
        runId: r.runId,
        evidence: r.failure.code,
        recommendation:
          '保留失败候选及错误路径，在相同输入下验证修复；不要将重试成功覆盖原失败记录。',
      });
  }
  return out;
}
