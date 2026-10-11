// Read-only views of assistant runs (turns) for the audit page and log exports.
// Every query is scoped by the session's organization.
const T = 'app.abap_fsd_agent_';

// A turn's state as reviewers think of it: a completed turn that ended by asking waits for the user.
const STATUS_SQL = `CASE WHEN t.status='completed' AND t.stop_reason='asked' THEN 'ASKED' ELSE upper(t.status) END`;
export const RUN_STATUSES = ['COMPLETED', 'ASKED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RUNNING'];

function filter(organizationId, f = {}) {
  const where = ['s.organization_id=$1'],
    args = [organizationId];
  const add = (sql, value) => {
    args.push(value);
    where.push(sql.replaceAll('?', '$' + args.length));
  };
  if (f.from) add('t.started_at>=?', f.from);
  if (f.to) add('t.started_at<?', f.to);
  if (f.status && RUN_STATUSES.includes(f.status)) add(`${STATUS_SQL}=?`, f.status);
  if (f.model) add("t.model->>'name'=?", f.model);
  if (f.projectId) add('s.project_id=?', f.projectId);
  if (f.itemId) add('s.item_id=?', f.itemId);
  if (f.sessionId) add('t.session_id=?', f.sessionId);
  if (f.q)
    add(
      '(i.code ILIKE ? OR i.name ILIKE ? OR p.name ILIKE ? OR u.display_name ILIKE ? OR t.id::text ILIKE ? OR t.session_id::text ILIKE ?)',
      '%' + f.q + '%',
    );
  return { where: where.join(' AND '), args };
}

const FROM = `${T}turn t JOIN ${T}session s ON s.id=t.session_id
  JOIN app.project p ON p.id=s.project_id JOIN app.development_item i ON i.id=s.item_id
  JOIN app.app_user u ON u.id=t.created_by`;
const COLUMNS = `t.id,t.session_id,${STATUS_SQL} AS status,t.stop_reason,t.model->>'name' AS model,
  t.started_at,t.finished_at,
  (extract(epoch FROM coalesce(t.finished_at,now())-t.started_at)*1000)::bigint AS duration_ms,
  coalesce((t.usage->>'prompt_tokens')::bigint,0) AS prompt_tokens,
  coalesce((t.usage->>'completion_tokens')::bigint,0) AS completion_tokens,
  t.error->>'code' AS error_code,t.error->>'message' AS error_message,
  json_build_object('id',p.id,'code',p.code,'name',p.name) AS project,
  json_build_object('id',i.id,'code',i.code,'name',i.name) AS item,
  u.display_name AS user_name,
  (SELECT count(*)::int FROM ${T}message m WHERE m.turn_id=t.id AND m.role='assistant') AS model_calls,
  (SELECT count(*)::int FROM ${T}tool_call c WHERE c.turn_id=t.id) AS tool_calls,
  (SELECT count(*)::int FROM ${T}tool_call c WHERE c.turn_id=t.id AND c.status<>'ok') AS tool_failures,
  (SELECT left(m.content,200) FROM ${T}message m WHERE m.turn_id=t.id AND m.role='user' ORDER BY m.seq LIMIT 1) AS prompt,
  (SELECT d.version FROM ${T}document d WHERE d.turn_id=t.id) AS document_version`;
const number = (row) => ({
  ...row,
  duration_ms: Number(row.duration_ms),
  prompt_tokens: Number(row.prompt_tokens),
  completion_tokens: Number(row.completion_tokens),
});

export async function listRuns(db, organizationId, f = {}, { limit = 50, offset = 0 } = {}) {
  const { where, args } = filter(organizationId, f);
  const total = (await db.query(`SELECT count(*)::int AS n FROM ${FROM} WHERE ${where}`, args))
    .rows[0].n;
  const items = (
    await db.query(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE ${where} ORDER BY t.started_at DESC
       LIMIT ${Math.min(500, Math.max(1, Number(limit) | 0))} OFFSET ${Math.max(0, Number(offset) | 0)}`,
      args,
    )
  ).rows.map(number);
  return { total, items };
}

export async function runFacets(db, organizationId) {
  const models = (
    await db.query(
      `SELECT DISTINCT t.model->>'name' AS m FROM ${T}turn t JOIN ${T}session s ON s.id=t.session_id
       WHERE s.organization_id=$1 AND t.model->>'name' IS NOT NULL ORDER BY 1`,
      [organizationId],
    )
  ).rows.map((r) => r.m);
  const rows = (
    await db.query(
      `SELECT DISTINCT p.id AS pid,p.code AS pcode,p.name AS pname,i.id,i.code,i.name
       FROM ${T}session s JOIN app.project p ON p.id=s.project_id JOIN app.development_item i ON i.id=s.item_id
       WHERE s.organization_id=$1 ORDER BY p.code,i.code`,
      [organizationId],
    )
  ).rows;
  const projects = [];
  for (const r of rows) {
    let p = projects.find((x) => x.id === r.pid);
    if (!p) projects.push((p = { id: r.pid, code: r.pcode, name: r.pname, items: [] }));
    p.items.push({ id: r.id, code: r.code, name: r.name });
  }
  return { models, statuses: RUN_STATUSES, projects };
}

export async function runStats(db, organizationId, f = {}) {
  const { where, args } = filter(organizationId, f);
  const totals = (
    await db.query(
      `SELECT count(*)::int AS runs,
        count(*) FILTER (WHERE ${STATUS_SQL}='COMPLETED')::int AS completed,
        count(*) FILTER (WHERE ${STATUS_SQL}='ASKED')::int AS asked,
        count(*) FILTER (WHERE t.status='failed')::int AS failed,
        count(*) FILTER (WHERE t.status='cancelled')::int AS cancelled,
        count(*) FILTER (WHERE t.status='interrupted')::int AS interrupted,
        coalesce(avg(extract(epoch FROM t.finished_at-t.started_at)*1000) FILTER (WHERE t.finished_at IS NOT NULL),0)::bigint AS avg_duration_ms,
        coalesce(sum((t.usage->>'prompt_tokens')::bigint),0)::bigint AS prompt_tokens,
        coalesce(sum((t.usage->>'completion_tokens')::bigint),0)::bigint AS completion_tokens,
        (SELECT count(*) FROM ${T}tool_call c WHERE c.turn_id IN (SELECT t.id FROM ${FROM} WHERE ${where}))::int AS tool_calls,
        (SELECT count(*) FROM ${T}tool_call c WHERE c.status<>'ok' AND c.turn_id IN (SELECT t.id FROM ${FROM} WHERE ${where}))::int AS tool_failures
       FROM ${FROM} WHERE ${where}`,
      args,
    )
  ).rows[0];
  const stopReasons = (
    await db.query(
      `SELECT coalesce(t.stop_reason,'running') AS reason,count(*)::int AS count FROM ${FROM}
       WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
      args,
    )
  ).rows;
  const tools = (
    await db.query(
      `SELECT c.name,count(*)::int AS calls,count(*) FILTER (WHERE c.status<>'ok')::int AS failures,
        avg(c.duration_ms)::int AS avg_ms,max(c.duration_ms)::int AS max_ms
       FROM ${T}tool_call c JOIN ${FROM} ON t.id=c.turn_id WHERE ${where}
       GROUP BY c.name ORDER BY failures DESC,calls DESC`,
      args,
    )
  ).rows;
  const models = (
    await db.query(
      `SELECT t.model->>'name' AS model,count(*)::int AS runs,
        count(*) FILTER (WHERE t.status IN ('failed','interrupted'))::int AS failures,
        avg(extract(epoch FROM t.finished_at-t.started_at)*1000)::bigint AS avg_duration_ms,
        max(extract(epoch FROM t.finished_at-t.started_at)*1000)::bigint AS max_duration_ms,
        coalesce(sum((t.usage->>'prompt_tokens')::bigint+(t.usage->>'completion_tokens')::bigint),0)::bigint AS tokens
       FROM ${FROM} WHERE ${where} GROUP BY 1 ORDER BY runs DESC`,
      args,
    )
  ).rows;
  const daily = (
    await db.query(
      `SELECT to_char(date_trunc('day',t.started_at AT TIME ZONE $${args.length + 1}),'YYYY-MM-DD') AS day,
        count(*)::int AS total,count(*) FILTER (WHERE t.status IN ('failed','interrupted'))::int AS failed
       FROM ${FROM} WHERE ${where} GROUP BY 1 ORDER BY 1`,
      [...args, f.tz || 'UTC'],
    )
  ).rows;
  const n = (v) => (v === null ? null : Number(v));
  return {
    totals: {
      ...totals,
      avg_duration_ms: n(totals.avg_duration_ms),
      prompt_tokens: n(totals.prompt_tokens),
      completion_tokens: n(totals.completion_tokens),
    },
    stop_reasons: stopReasons,
    tools,
    models: models.map((m) => ({
      ...m,
      avg_duration_ms: n(m.avg_duration_ms),
      max_duration_ms: n(m.max_duration_ms),
      tokens: n(m.tokens),
    })),
    daily,
  };
}

export async function runDetail(db, organizationId, turnId) {
  const run = (
    await db.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE s.organization_id=$1 AND t.id=$2`, [
      organizationId,
      turnId,
    ])
  ).rows[0];
  if (!run) return null;
  const messages = (
    await db.query(
      `SELECT seq,role,content,payload,created_at FROM ${T}message WHERE turn_id=$1 ORDER BY seq`,
      [turnId],
    )
  ).rows;
  const toolCalls = (
    await db.query(
      `SELECT name,arguments,status,result_summary AS result,duration_ms,created_at
       FROM ${T}tool_call WHERE turn_id=$1 ORDER BY created_at`,
      [turnId],
    )
  ).rows;
  const document = (
    await db.query(
      `SELECT version,changes,comparison,length(markdown) AS length FROM ${T}document WHERE turn_id=$1`,
      [turnId],
    )
  ).rows[0];
  return { run: number(run), messages, toolCalls, document: document ?? null };
}

export async function sessionTrend(db, organizationId, sessionId) {
  const session = (
    await db.query(
      `SELECT s.id,s.title,s.created_at,json_build_object('id',p.id,'code',p.code,'name',p.name) AS project,
        json_build_object('id',i.id,'code',i.code,'name',i.name) AS item
       FROM ${T}session s JOIN app.project p ON p.id=s.project_id JOIN app.development_item i ON i.id=s.item_id
       WHERE s.organization_id=$1 AND s.id=$2`,
      [organizationId, sessionId],
    )
  ).rows[0];
  if (!session) return null;
  const { where, args } = filter(organizationId, { sessionId });
  const rounds = (
    await db.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE ${where} ORDER BY t.started_at`, args)
  ).rows.map(number);
  return { session, rounds };
}
