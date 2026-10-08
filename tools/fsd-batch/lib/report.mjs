import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, saveJson } from './storage.mjs';
import { analyzeRun, recommendations } from '@sap-delivery-workbench/api/diagnostics/analyzer';
import { readTrace } from '@sap-delivery-workbench/api/diagnostics/recorder';
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function writeReport(dir) {
  const state = readJson(join(dir, 'state.json'));
  const runs = [];
  for (const c of state.cases)
    for (const id of c.runs) {
      const path = join(dir, c.code, id + '.json');
      if (!existsSync(path)) continue;
      const tp = join(dir, c.code, id + '.trace.json');
      runs.push({
        ...analyzeRun(
          readJson(path),
          existsSync(tp) ? readJson(tp).events : readTrace({ runId: id }),
        ),
        code: c.code,
      });
    }
  const times = runs
    .map((r) => r.elapsedMs)
    .filter((x) => x != null)
    .sort((a, b) => a - b);
  const percentile = (p) => (times.length ? times[Math.ceil(times.length * p) - 1] : null);
  const summary = {
    cases: state.cases.length,
    finalSaved: state.cases.filter((c) => c.status === 'completed').length,
    runs: runs.length,
    completedRuns: runs.filter((r) => r.executionCompleted).length,
    structurallyPassed: runs.filter((r) => r.structurePassed === true).length,
    savedRevisions: runs.filter((r) => r.saved).length,
    businessQuality: 'not_evaluated',
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    modelCalls: runs.reduce((n, r) => n + r.calls.length, 0),
    providerRequests: runs.reduce(
      (n, r) => n + r.calls.reduce((k, c) => k + c.providerRequests, 0),
      0,
    ),
    incompleteTraces: runs.filter((r) => !r.traceComplete).length,
  };
  const report = {
    version: 1,
    batchId: state.id,
    generatedAt: new Date().toISOString(),
    summary,
    cases: state.cases,
    runs,
    recommendations: recommendations(runs),
  };
  saveJson(join(dir, 'report.json'), report);
  const lines = [
    '# FSD 批量测试报告',
    '',
    `批次：${state.id}`,
    `生成时间：${report.generatedAt}`,
    '',
    '## 结果',
    '',
    `完整说明书保存：${summary.finalSaved}/${summary.cases}；模型调用：${summary.modelCalls} 次。`,
    '业务质量：未评估；保存成功不表示 SAP 业务执行或 UAT 通过。',
    '',
    '| 原编号 | 测试编号 | 状态 | 原项未变 | 最终成果 |',
    '|---|---|---|---|---|',
    ...state.cases.map(
      (c) =>
        `| ${c.code} | ${c.copy?.code ?? '—'} | ${c.status} | ${c.originalUnchanged ?? '未验证'} | ${c.artifactId ?? '—'} |`,
    ),
    '',
    '## 分步明细',
    '',
  ];
  for (const r of runs) {
    lines.push(
      `### ${r.code} / ${r.runId}`,
      `状态：${r.state}；总耗时：${r.elapsedMs == null ? '未知' : (r.elapsedMs / 1000).toFixed(2) + ' 秒'}；结构通过：${r.structurePassed}；保存：${r.saved}`,
      '',
      '| 步骤 | 状态 | 秒 |',
      '|---|---|---|',
      ...r.steps.map(
        (s) =>
          `| ${s.label ?? s.stepId} | ${s.status} | ${s.durationMs == null ? '—' : (s.durationMs / 1000).toFixed(2)} |`,
      ),
      '',
      '模型调用（包含在步骤耗时中，不重复相加）：',
      '',
      ...r.calls.map(
        (c) =>
          `- ${c.callId} / ${c.task} / ${c.stage}：${c.durationMs == null ? '未知' : (c.durationMs / 1000).toFixed(2)} 秒；输入 ${c.usage?.prompt_tokens ?? '未知'}，输出 ${c.usage?.completion_tokens ?? '未知'}，推理 ${c.usage?.completion_tokens_details?.reasoning_tokens ?? '未知'} token。`,
      ),
      '',
      `错误：${JSON.stringify(r.failure ?? r.errors)}`,
      '',
    );
  }
  lines.push(
    '## 证据驱动优化建议',
    '',
    ...report.recommendations.map((r) => `- ${r.runId}：${r.evidence}。${r.recommendation}`),
    '',
    '## 日志说明',
    '',
    '每个开发项目录保存原信息、请求、预置回答、运行快照、完整模型轨迹、步骤事件和说明书。原始轨迹含业务资料，请按项目权限保管。模型私有思维链不采集，仅保留提供方返回的推理用量。',
  );
  writeFileSync(join(dir, 'report.md'), lines.join('\n'));
  const rows = state.cases
    .map(
      (c) =>
        `<tr><td>${esc(c.code)}</td><td>${esc(c.copy?.code)}</td><td>${esc(c.status)}</td><td>${esc(c.originalUnchanged)}</td></tr>`,
    )
    .join('');
  writeFileSync(
    join(dir, 'report.html'),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FSD 批量测试报告</title><style>body{font:16px/1.65 system-ui;max-width:1100px;margin:40px auto;padding:0 24px;color:#163047}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:20px}summary{cursor:pointer}</style><h1>FSD 批量测试报告</h1><p>完整说明书保存 ${summary.finalSaved}/${summary.cases} · 模型调用 ${summary.modelCalls} 次 · 业务质量未评估</p><table><tr><th>原编号</th><th>副本编号</th><th>状态</th><th>原项未变</th></tr>${rows}</table>${runs.map((r) => `<details><summary>${esc(r.code)} / ${esc(r.runId)} / ${esc(r.state)} / ${r.elapsedMs == null ? '未知' : (r.elapsedMs / 1000).toFixed(1) + ' 秒'}</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>`).join('')}<h2>优化建议</h2><ul>${report.recommendations.map((r) => `<li>${esc(r.evidence)}：${esc(r.recommendation)}</li>`).join('')}</ul></html>`,
  );
  return report;
}
