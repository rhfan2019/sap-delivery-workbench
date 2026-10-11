import { listRuns, runDetail, runStats } from '../abap-fsd-agent/public.mjs';
import { commentsFor, insertProposal } from './repository.mjs';
import { statusLabel, stopReasonTitle, toolLabel } from './glossary.mjs';

const MAX_RUNS = 200;

// Analysis material for a period: statistics, runs with their comments and, when asked,
// every tool call (failures keep their error text). Used by the audit page export and
// by scripts/maintenance/export-assistant-logs.mjs.
export async function buildAnalysis(db, organizationId, filters = {}, { detail = false } = {}) {
  const stats = await runStats(db, organizationId, filters);
  const { total, items } = await listRuns(db, organizationId, filters, { limit: MAX_RUNS });
  const comments = await commentsFor(
    db,
    organizationId,
    items.map((r) => r.id),
  );
  const runs = [];
  for (const run of items) {
    const entry = {
      ...run,
      status_label: statusLabel(run.status),
      stop_reason_title: stopReasonTitle(run.stop_reason),
      comments: comments
        .filter((c) => c.target_id === run.id)
        .map((c) => ({ author: c.author, at: c.created_at, body: c.body })),
    };
    if (detail) {
      const d = await runDetail(db, organizationId, run.id);
      entry.calls = d.toolCalls.map((c) => ({
        name: c.name,
        status: c.status,
        duration_ms: c.duration_ms,
        arguments: c.arguments,
        ...(c.status === 'ok' ? {} : { result: c.result }),
      }));
      entry.assistant_text = d.messages
        .filter((m) => m.role === 'assistant' && m.content.trim())
        .map((m) => m.content)
        .join('\n\n')
        .slice(0, 4000);
      entry.document = d.document;
    }
    runs.push(entry);
  }
  return {
    generated_at: new Date().toISOString(),
    filters,
    total_runs: total,
    included_runs: runs.length,
    stats,
    runs,
  };
}

const seconds = (ms) => (ms ? (ms / 1000).toFixed(0) + ' 秒' : '—');

export function analysisMarkdown(m) {
  const t = m.stats.totals;
  const lines = [
    '# FSD 设计助手运行分析材料',
    '',
    `生成时间：${m.generated_at}；范围：${m.filters.from ?? '不限'} ～ ${m.filters.to ?? '现在'}；运行 ${m.total_runs} 轮（本文件含 ${m.included_runs} 轮）。`,
    '',
    '## 概况',
    '',
    `- 完成 ${t.completed}，提问 ${t.asked}，失败 ${t.failed}，停止 ${t.cancelled}，中断 ${t.interrupted}`,
    `- 平均耗时 ${seconds(t.avg_duration_ms)}；输入 ${t.prompt_tokens} token，输出 ${t.completion_tokens} token`,
    `- 工具调用 ${t.tool_calls} 次，失败 ${t.tool_failures} 次`,
    '',
    '## 工具',
    '',
    '| 工具 | 调用 | 失败 | 平均耗时 |',
    '| --- | --- | --- | --- |',
    ...m.stats.tools.map(
      (x) => `| ${toolLabel(x.name)}（${x.name}） | ${x.calls} | ${x.failures} | ${x.avg_ms} ms |`,
    ),
    '',
    '## 运行与评论',
    '',
  ];
  for (const r of m.runs) {
    lines.push(
      `### ${r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at} · ${r.item.code} ${r.item.name}`,
      '',
      `- 轮次 ${r.id}（会话 ${r.session_id}），${r.user_name}，模型 ${r.model ?? '—'}`,
      `- ${r.status_label} · ${r.stop_reason_title} · 耗时 ${seconds(r.duration_ms)} · 模型调用 ${r.model_calls} · 工具 ${r.tool_calls}（失败 ${r.tool_failures}）· token ${r.prompt_tokens}/${r.completion_tokens}${r.document_version ? ` · 产出文档第 ${r.document_version} 版` : ''}`,
    );
    if (r.error_message) lines.push(`- 错误：${r.error_code ?? ''} ${r.error_message}`);
    if (r.prompt) lines.push(`- 用户输入：${r.prompt.replace(/\s+/g, ' ')}`);
    for (const c of r.comments) lines.push(`- **评论**（${c.author}）：${c.body}`);
    for (const c of (r.calls ?? []).filter((x) => x.status !== 'ok'))
      lines.push(
        `- 失败调用 ${c.name}：${JSON.stringify(c.arguments).slice(0, 200)} → ${String(c.result).slice(0, 300)}`,
      );
    lines.push('');
  }
  return lines.join('\n');
}

export async function publishProposal(db, organizationId, proposal) {
  if (!proposal.title?.trim() || !proposal.markdown?.trim())
    throw new Error('标题和正文不能为空。');
  return insertProposal(db, organizationId, proposal);
}
