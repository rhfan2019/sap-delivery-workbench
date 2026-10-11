import { randomUUID } from 'node:crypto';

const TURN = 'abap_fsd_agent_turn';

export async function commentsFor(db, organizationId, targetIds) {
  if (!targetIds.length) return [];
  return (
    await db.query(
      `SELECT c.id,c.target_id,c.body,c.created_at,c.created_by,u.display_name AS author
       FROM app.audit_comment c JOIN app.app_user u ON u.id=c.created_by
       WHERE c.organization_id=$1 AND c.target_type=$2 AND c.target_id=ANY($3::uuid[]) AND c.deleted_at IS NULL
       ORDER BY c.created_at`,
      [organizationId, TURN, targetIds],
    )
  ).rows;
}

export async function commentCounts(db, organizationId, targetIds) {
  const counts = new Map();
  if (!targetIds.length) return counts;
  const { rows } = await db.query(
    `SELECT target_id,count(*)::int AS n FROM app.audit_comment
     WHERE organization_id=$1 AND target_type=$2 AND target_id=ANY($3::uuid[]) AND deleted_at IS NULL
     GROUP BY target_id`,
    [organizationId, TURN, targetIds],
  );
  for (const r of rows) counts.set(r.target_id, r.n);
  return counts;
}

export async function addComment(db, organizationId, targetId, body, actorId) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO app.audit_comment(id,organization_id,target_type,target_id,body,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, organizationId, TURN, targetId, body, actorId],
  );
  return id;
}

// Authors remove their own comments; rows stay for the record.
export async function deleteComment(db, organizationId, id, actorId) {
  const { rowCount } = await db.query(
    `UPDATE app.audit_comment SET deleted_at=now()
     WHERE organization_id=$1 AND id=$2 AND created_by=$3 AND deleted_at IS NULL`,
    [organizationId, id, actorId],
  );
  return rowCount > 0;
}

// Comments in a period, with the run they belong to, for analysis exports.
export async function commentsInPeriod(db, organizationId, { from, to } = {}) {
  const args = [organizationId, TURN];
  let where = 'c.organization_id=$1 AND c.target_type=$2 AND c.deleted_at IS NULL';
  if (from) where += ` AND c.created_at>=$${args.push(from)}`;
  if (to) where += ` AND c.created_at<$${args.push(to)}`;
  return (
    await db.query(
      `SELECT c.id,c.target_id,c.body,c.created_at,u.display_name AS author
       FROM app.audit_comment c JOIN app.app_user u ON u.id=c.created_by WHERE ${where} ORDER BY c.created_at`,
      args,
    )
  ).rows;
}

export async function listEvents(db, organizationId, f = {}, { limit = 50, offset = 0 } = {}) {
  const args = [organizationId];
  const where = ['e.organization_id=$1'];
  const add = (sql, value) => where.push(sql.replaceAll('?', '$' + args.push(value)));
  if (f.from) add('e.occurred_at>=?', f.from);
  if (f.to) add('e.occurred_at<?', f.to);
  if (f.action) add('e.action=?', f.action);
  if (f.outcome) add('e.outcome=?', f.outcome);
  if (f.q)
    add('(u.display_name ILIKE ? OR u.login_name ILIKE ? OR e.action ILIKE ?)', '%' + f.q + '%');
  const clause = where.join(' AND ');
  const from = 'app.audit_event e LEFT JOIN app.app_user u ON u.id=e.actor_user_id';
  const total = (await db.query(`SELECT count(*)::int AS n FROM ${from} WHERE ${clause}`, args))
    .rows[0].n;
  const items = (
    await db.query(
      `SELECT e.id,e.occurred_at,e.action,e.outcome,e.subject_type,e.subject_id,e.details,
        u.display_name AS actor,u.login_name AS actor_login
       FROM ${from} WHERE ${clause} ORDER BY e.occurred_at DESC,e.id DESC
       LIMIT ${Math.min(200, Math.max(1, Number(limit) | 0))} OFFSET ${Math.max(0, Number(offset) | 0)}`,
      args,
    )
  ).rows;
  const actions = (
    await db.query(
      'SELECT DISTINCT action FROM app.audit_event WHERE organization_id=$1 ORDER BY 1',
      [organizationId],
    )
  ).rows.map((r) => r.action);
  return { total, items, actions };
}

export async function listProposals(db, organizationId) {
  return (
    await db.query(
      `SELECT id,title,period_from,period_to,sources,author,created_at,length(markdown) AS length
       FROM app.audit_proposal WHERE organization_id=$1 ORDER BY created_at DESC`,
      [organizationId],
    )
  ).rows;
}

export async function getProposal(db, organizationId, id) {
  return (
    await db.query(
      `SELECT id,title,markdown,period_from,period_to,sources,author,created_at
       FROM app.audit_proposal WHERE organization_id=$1 AND id=$2`,
      [organizationId, id],
    )
  ).rows[0];
}

export async function insertProposal(db, organizationId, p) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO app.audit_proposal(id,organization_id,title,markdown,period_from,period_to,sources,author)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      organizationId,
      p.title,
      p.markdown,
      p.periodFrom ?? null,
      p.periodTo ?? null,
      p.sources ?? {},
      p.author ?? 'Claude Code',
    ],
  );
  return id;
}
