import { failure } from '../../platform/auth.mjs';
import { adminContext } from '../admin/context.mjs';
import {
  listRuns,
  runDetail,
  runFacets,
  runStats,
  sessionTrend,
} from '../abap-fsd-agent/public.mjs';
import * as repo from './repository.mjs';
import { analysisMarkdown, buildAnalysis } from './export.mjs';
import { STOP_REASONS, TOOL_LABELS } from './glossary.mjs';

const base = '/api/audit';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 50;

function time(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw failure(400, '时间格式无效。');
  return d.toISOString();
}
const text = (v, max = 100) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const id = (v) => (typeof v === 'string' && UUID.test(v) ? v : undefined);
function runFilters(q = {}) {
  return {
    from: time(q.from),
    to: time(q.to),
    status: text(q.status, 20),
    model: text(q.model, 200),
    projectId: id(q.project_id),
    itemId: id(q.item_id),
    q: text(q.q),
    tz: text(q.tz, 64),
  };
}
const offset = (q) => Math.max(0, Number(q.offset) | 0);

// Admin-only review of assistant runs and platform audit events; read-only except comments.
export function registerAuditRoutes(app, pool, organizationId, requireSession) {
  const { authorize } = adminContext(pool, organizationId, requireSession);
  const org = organizationId;

  app.get(base + '/glossary', async (req) => {
    await authorize(req);
    return { stop_reasons: STOP_REASONS, tools: TOOL_LABELS };
  });

  app.get(base + '/runs/facets', async (req) => {
    await authorize(req);
    return runFacets(pool, org);
  });

  app.get(base + '/runs', async (req) => {
    await authorize(req);
    const page = await listRuns(pool, org, runFilters(req.query), {
      limit: PAGE,
      offset: offset(req.query),
    });
    const counts = await repo.commentCounts(
      pool,
      org,
      page.items.map((r) => r.id),
    );
    return {
      total: page.total,
      offset: offset(req.query),
      page_size: PAGE,
      items: page.items.map((r) => ({ ...r, comments: counts.get(r.id) ?? 0 })),
    };
  });

  app.get(base + '/runs/:id', async (req) => {
    const current = await authorize(req);
    if (!UUID.test(req.params.id)) throw failure(404, '运行不存在。');
    const detail = await runDetail(pool, org, req.params.id);
    if (!detail) throw failure(404, '运行不存在或不属于当前企业。');
    let previous = Date.parse(detail.run.started_at);
    const toolCalls = detail.toolCalls.map((c) => {
      const at = Date.parse(c.created_at);
      // created_at is when the call finished; the gap is the model's think time before it.
      const gap = Math.max(0, at - c.duration_ms - previous);
      previous = at;
      return { ...c, gap_ms: gap };
    });
    const comments = (await repo.commentsFor(pool, org, [req.params.id])).map((c) => ({
      ...c,
      mine: c.created_by === current.user.id,
    }));
    return { ...detail, toolCalls, comments };
  });

  app.post(base + '/runs/:id/comments', async (req, reply) => {
    const current = await authorize(req);
    if (!UUID.test(req.params.id) || !(await runDetail(pool, org, req.params.id)))
      throw failure(404, '运行不存在。');
    const body = text(req.body?.body, 5000);
    if (!body) throw failure(400, '请填写评论。');
    await repo.addComment(pool, org, req.params.id, body, current.user.id);
    reply.code(201);
    return (await repo.commentsFor(pool, org, [req.params.id])).map((c) => ({
      ...c,
      mine: c.created_by === current.user.id,
    }));
  });

  app.delete(base + '/comments/:id', async (req) => {
    const current = await authorize(req);
    if (
      !UUID.test(req.params.id) ||
      !(await repo.deleteComment(pool, org, req.params.id, current.user.id))
    )
      throw failure(404, '评论不存在，或不是你写的。');
    return { deleted: true };
  });

  app.get(base + '/sessions/:id/trend', async (req) => {
    await authorize(req);
    if (!UUID.test(req.params.id)) throw failure(404, '会话不存在。');
    const trend = await sessionTrend(pool, org, req.params.id);
    if (!trend) throw failure(404, '会话不存在或不属于当前企业。');
    const counts = await repo.commentCounts(
      pool,
      org,
      trend.rounds.map((r) => r.id),
    );
    return {
      ...trend,
      rounds: trend.rounds.map((r) => ({ ...r, comments: counts.get(r.id) ?? 0 })),
    };
  });

  app.get(base + '/stats', async (req) => {
    await authorize(req);
    const filters = runFilters(req.query);
    const stats = await runStats(pool, org, filters);
    const t = stats.totals;
    return {
      ...stats,
      failure_rate: t.runs ? (t.failed + t.interrupted) / t.runs : null,
      ask_rate: t.runs ? t.asked / t.runs : null,
      tool_failure_rate: t.tool_calls ? t.tool_failures / t.tool_calls : null,
      stop_reasons: stats.stop_reasons.map((r) => ({
        ...r,
        title: STOP_REASONS[r.reason]?.title ?? r.reason,
      })),
    };
  });

  app.get(base + '/export', async (req, reply) => {
    await authorize(req);
    const material = await buildAnalysis(pool, org, runFilters(req.query), {
      detail: req.query?.detail === '1',
    });
    const markdown = req.query?.format !== 'json';
    const name = `assistant-runs-${new Date().toISOString().slice(0, 10)}.${markdown ? 'md' : 'json'}`;
    reply
      .header(
        'Content-Type',
        markdown ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
      )
      .header('Content-Disposition', `attachment; filename="${name}"`);
    return markdown ? analysisMarkdown(material) : JSON.stringify(material, null, 2);
  });

  app.get(base + '/events', async (req) => {
    await authorize(req);
    const q = req.query ?? {};
    return repo
      .listEvents(
        pool,
        org,
        {
          from: time(q.from),
          to: time(q.to),
          action: text(q.action, 64),
          outcome: ['success', 'failure', 'denied'].includes(q.outcome) ? q.outcome : undefined,
          q: text(q.q),
        },
        { limit: PAGE, offset: offset(q) },
      )
      .then((page) => ({ ...page, offset: offset(q), page_size: PAGE }));
  });

  app.get(base + '/proposals', async (req) => {
    await authorize(req);
    return repo.listProposals(pool, org);
  });

  app.get(base + '/proposals/:id', async (req) => {
    await authorize(req);
    const found = UUID.test(req.params.id) && (await repo.getProposal(pool, org, req.params.id));
    if (!found) throw failure(404, '建议不存在。');
    return found;
  });
}
