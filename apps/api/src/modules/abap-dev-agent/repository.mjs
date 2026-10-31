import { randomUUID } from 'node:crypto';

const T = 'app.abap_dev_agent_';

export async function listSessions(db, scope) {
  return (
    await db.query(
      `SELECT s.id,s.title,s.active_turn_id AS "activeTurnId",s.created_at AS "createdAt",s.updated_at AS "updatedAt",
        s.archived_at AS "archivedAt",(SELECT max(version) FROM ${T}version v WHERE v.session_id=s.id) AS "version"
       FROM ${T}session s WHERE s.organization_id=$1 AND s.project_id=$2 AND s.item_id=$3
       ORDER BY s.updated_at DESC LIMIT 50`,
      [scope.organizationId, scope.projectId, scope.itemId],
    )
  ).rows;
}

export async function createSession(db, scope, title = '') {
  const id = randomUUID();
  await db.query(
    `INSERT INTO ${T}session(id,organization_id,project_id,item_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, scope.organizationId, scope.projectId, scope.itemId, title.slice(0, 200), scope.actorId],
  );
  return id;
}

// Renaming keeps the list order: updated_at follows the conversation, not its title.
export async function renameSession(db, scope, id, title) {
  const r = await db.query(
    `UPDATE ${T}session SET title=$5 WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND item_id=$4`,
    [id, scope.organizationId, scope.projectId, scope.itemId, title.slice(0, 200)],
  );
  return r.rowCount > 0;
}

// Archiving keeps the list order too, and refuses while a turn is running.
export async function setArchived(db, scope, id, archived) {
  const r = await db.query(
    `UPDATE ${T}session SET archived_at=CASE WHEN $5 THEN coalesce(archived_at,now()) END
     WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND item_id=$4
     AND (NOT $5 OR active_turn_id IS NULL)`,
    [id, scope.organizationId, scope.projectId, scope.itemId, archived],
  );
  return r.rowCount > 0;
}

export async function findSession(db, scope, id) {
  return (
    await db.query(
      `SELECT id,title,active_turn_id AS "activeTurnId",created_at AS "createdAt",updated_at AS "updatedAt",
        archived_at AS "archivedAt"
       FROM ${T}session WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND item_id=$4`,
      [id, scope.organizationId, scope.projectId, scope.itemId],
    )
  ).rows[0];
}

export async function setTitle(db, sessionId, title) {
  await db.query(`UPDATE ${T}session SET title=$2 WHERE id=$1 AND title=''`, [
    sessionId,
    title.slice(0, 60),
  ]);
}

// Claims the session for one turn; returns false when another turn is running.
export async function claimTurn(db, sessionId, turnId, actorId, model) {
  const claimed = await db.query(
    `UPDATE ${T}session SET active_turn_id=$2,updated_at=now()
     WHERE id=$1 AND active_turn_id IS NULL AND archived_at IS NULL`,
    [sessionId, turnId],
  );
  if (!claimed.rowCount) return false;
  await db.query(
    `INSERT INTO ${T}turn(id,session_id,status,model,created_by) VALUES($1,$2,'running',$3,$4)`,
    [turnId, sessionId, model, actorId],
  );
  return true;
}

export async function finishTurn(db, sessionId, turnId, { status, stopReason, usage, error }) {
  await db.query(
    `UPDATE ${T}turn SET status=$2,stop_reason=$3,usage=$4,error=$5,finished_at=now() WHERE id=$1`,
    [turnId, status, stopReason ?? null, usage ?? {}, error ?? null],
  );
  await db.query(
    `UPDATE ${T}session SET active_turn_id=NULL,updated_at=now() WHERE id=$1 AND active_turn_id=$2`,
    [sessionId, turnId],
  );
}

// Turns left running by a stopped process cannot continue; the user resends instead.
export async function interruptOrphanTurns(db, organizationId) {
  const { rows } = await db.query(
    `UPDATE ${T}turn t SET status='interrupted',stop_reason='server_restart',finished_at=now()
     FROM ${T}session s WHERE t.session_id=s.id AND s.organization_id=$1 AND t.status='running'
     RETURNING t.id,t.session_id`,
    [organizationId],
  );
  for (const row of rows)
    await db.query(`UPDATE ${T}session SET active_turn_id=NULL WHERE id=$1 AND active_turn_id=$2`, [
      row.session_id,
      row.id,
    ]);
  return rows.length;
}

export async function appendMessage(
  db,
  sessionId,
  { turnId, role, content = '', payload = {}, actorId },
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO ${T}message(id,session_id,turn_id,seq,role,content,payload,created_by)
     VALUES($1,$2,$3,(SELECT coalesce(max(seq),0)+1 FROM ${T}message WHERE session_id=$2),$4,$5,$6,$7)`,
    [id, sessionId, turnId ?? null, role, content, payload, actorId ?? null],
  );
  return id;
}

export async function listMessages(db, sessionId) {
  return (
    await db.query(
      `SELECT m.id,m.turn_id AS "turnId",m.seq,m.role,m.content,m.payload,m.created_at AS "createdAt",
        u.display_name AS "authorName"
       FROM ${T}message m LEFT JOIN app.app_user u ON u.id=m.created_by
       WHERE m.session_id=$1 ORDER BY m.seq`,
      [sessionId],
    )
  ).rows;
}

export async function listTurns(db, sessionId) {
  return (
    await db.query(
      `SELECT id,status,stop_reason AS "stopReason",model,usage,error,started_at AS "startedAt",finished_at AS "finishedAt"
       FROM ${T}turn WHERE session_id=$1 ORDER BY started_at`,
      [sessionId],
    )
  ).rows;
}

export async function recordToolCall(db, sessionId, turnId, call) {
  await db.query(
    `INSERT INTO ${T}tool_call(id,session_id,turn_id,name,arguments,status,result_summary,duration_ms,preview)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      sessionId,
      turnId,
      call.name,
      call.arguments ?? {},
      call.status,
      String(call.summary ?? '').slice(0, 2000),
      Math.round(call.durationMs ?? 0),
      call.preview ?? null,
    ],
  );
}

export async function listToolCalls(db, sessionId) {
  return (
    await db.query(
      `SELECT turn_id AS "turnId",name,arguments,status,result_summary AS "summary",duration_ms AS "durationMs",preview,created_at AS "createdAt"
       FROM ${T}tool_call WHERE session_id=$1 ORDER BY created_at`,
      [sessionId],
    )
  ).rows;
}

const VERSION_COLUMNS = `version,plan,code,source,source_ref AS "sourceRef",basis,changes,comparison,labels,
  turn_id AS "turnId",created_at AS "createdAt"`;

export async function latestVersion(db, sessionId) {
  return (
    await db.query(
      `SELECT ${VERSION_COLUMNS} FROM ${T}version WHERE session_id=$1 ORDER BY version DESC LIMIT 1`,
      [sessionId],
    )
  ).rows[0];
}

export async function getVersion(db, sessionId, version) {
  return (
    await db.query(
      `SELECT ${VERSION_COLUMNS} FROM ${T}version WHERE session_id=$1 AND version=$2`,
      [sessionId, version],
    )
  ).rows[0];
}

export async function listVersions(db, sessionId) {
  return (
    await db.query(
      `SELECT version,source,source_ref AS "sourceRef",labels,changes,comparison,basis,turn_id AS "turnId",
        created_at AS "createdAt",length(plan) AS "planLength",
        CASE WHEN code='' THEN 0 ELSE array_length(string_to_array(code, E'\\n'),1) END AS "codeLines"
       FROM ${T}version WHERE session_id=$1 ORDER BY version DESC`,
      [sessionId],
    )
  ).rows;
}

export async function saveVersion(
  db,
  sessionId,
  { turnId, plan, code, source, sourceRef, basis, changes, comparison, actorId },
) {
  const { rows } = await db.query(
    `INSERT INTO ${T}version(id,session_id,turn_id,version,plan,code,source,source_ref,basis,changes,comparison,created_by)
     VALUES($1,$2,$3,(SELECT coalesce(max(version),0)+1 FROM ${T}version WHERE session_id=$2),$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING version`,
    [
      randomUUID(),
      sessionId,
      turnId ?? null,
      plan,
      code,
      source,
      sourceRef ?? null,
      JSON.stringify(basis ?? []),
      JSON.stringify(changes ?? []),
      comparison ?? {},
      actorId,
    ],
  );
  return rows[0].version;
}

export async function setLabels(db, sessionId, version, labels) {
  const { rowCount } = await db.query(
    `UPDATE ${T}version SET labels=$3 WHERE session_id=$1 AND version=$2`,
    [sessionId, version, labels],
  );
  return rowCount > 0;
}

export async function listComments(db, sessionId, { openOnly = false } = {}) {
  return (
    await db.query(
      `SELECT c.id,c.target,c.anchor_text AS "anchorText",c.anchor_version AS "anchorVersion",c.anchor_line AS "anchorLine",
        c.body,c.status,c.replies,c.created_at AS "createdAt",c.resolved_at AS "resolvedAt",u.display_name AS "authorName"
       FROM ${T}comment c JOIN app.app_user u ON u.id=c.created_by
       WHERE c.session_id=$1 ${openOnly ? "AND c.status='open'" : ''} ORDER BY c.created_at`,
      [sessionId],
    )
  ).rows;
}

export async function addComment(
  db,
  sessionId,
  { target, anchorText, anchorVersion, anchorLine, body, actorId },
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO ${T}comment(id,session_id,target,anchor_text,anchor_version,anchor_line,body,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, sessionId, target, anchorText, anchorVersion, anchorLine ?? null, body, actorId],
  );
  return id;
}

export async function setCommentStatus(db, sessionId, id, status) {
  const { rowCount } = await db.query(
    `UPDATE ${T}comment SET status=$3,resolved_at=CASE WHEN $3='resolved' THEN now() END WHERE session_id=$1 AND id=$2`,
    [sessionId, id, status],
  );
  return rowCount > 0;
}

export async function markStale(db, sessionId, ids) {
  if (!ids.length) return;
  await db.query(
    `UPDATE ${T}comment SET status='stale' WHERE session_id=$1 AND id=ANY($2::uuid[]) AND status='open'`,
    [sessionId, ids],
  );
}

export async function replyComment(db, sessionId, id, reply) {
  const { rowCount } = await db.query(
    `UPDATE ${T}comment SET replies=replies||$3::jsonb WHERE session_id=$1 AND id=$2`,
    [sessionId, id, JSON.stringify([reply])],
  );
  return rowCount > 0;
}

export async function addAttachment(db, sessionId, a) {
  await db.query(
    `INSERT INTO ${T}attachment(id,session_id,file_name,size,storage_key,parse_state,extracted_text,warnings,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      a.id,
      sessionId,
      a.fileName,
      a.size,
      a.storageKey,
      a.parseState,
      a.text,
      JSON.stringify(a.warnings ?? []),
      a.actorId,
    ],
  );
}

export async function listAttachments(db, sessionId, { withText = false } = {}) {
  return (
    await db.query(
      `SELECT id,file_name AS "fileName",size,parse_state AS "parseState",warnings,created_at AS "createdAt",
        CASE WHEN storage_key LIKE 'ref:%' THEN split_part(storage_key,':',2) ELSE 'upload' END AS "source"
       ${withText ? ',extracted_text AS "text"' : ''} FROM ${T}attachment WHERE session_id=$1 ORDER BY created_at`,
      [sessionId],
    )
  ).rows;
}

// Turns of every session in the organization, newest first (for audit; see public.mjs).
export async function recentTurns(db, organizationId, { limit = 50 } = {}) {
  return (
    await db.query(
      `SELECT t.id,t.session_id AS "sessionId",s.item_id AS "itemId",t.status,t.stop_reason AS "stopReason",
        t.model,t.usage,t.started_at AS "startedAt",t.finished_at AS "finishedAt"
       FROM ${T}turn t JOIN ${T}session s ON s.id=t.session_id
       WHERE s.organization_id=$1 ORDER BY t.started_at DESC LIMIT $2`,
      [organizationId, Math.min(200, limit)],
    )
  ).rows;
}

// What the item drawer shows without the conversation: the newest plan-and-code version of
// the item and the newest one labelled 定稿, across its development sessions.
export async function itemOutputs(db, organizationId, itemId) {
  const pick = async (finalOnly) =>
    (
      await db.query(
        `SELECT v.session_id AS "sessionId",s.title AS "sessionTitle",v.version,v.labels,
          v.created_at AS "createdAt",length(v.plan) AS "planLength",
          CASE WHEN v.code='' THEN 0 ELSE array_length(string_to_array(v.code, E'\n'),1) END AS "codeLines"
         FROM ${T}version v JOIN ${T}session s ON s.id=v.session_id
         WHERE s.organization_id=$1 AND s.item_id=$2 ${finalOnly ? "AND '定稿'=ANY(v.labels)" : ''}
         ORDER BY v.created_at DESC LIMIT 1`,
        [organizationId, itemId],
      )
    ).rows[0] ?? null;
  return { latest: await pick(false), final: await pick(true) };
}

// One version of an item for the drawer, by session and version (no comments).
export async function itemVersion(db, organizationId, itemId, sessionId, version) {
  return (
    await db.query(
      `SELECT v.session_id AS "sessionId",v.version,v.plan,v.code,v.labels,v.created_at AS "createdAt"
       FROM ${T}version v JOIN ${T}session s ON s.id=v.session_id
       WHERE s.organization_id=$1 AND s.item_id=$2 AND v.session_id=$3 AND v.version=$4`,
      [organizationId, itemId, sessionId, version],
    )
  ).rows[0];
}

// Attachments of the item's other sessions, for referencing them in this one (spec 4.2).
export async function itemAttachments(db, scope, exceptSessionId) {
  return (
    await db.query(
      `SELECT a.id,a.file_name AS "fileName",a.size,a.parse_state AS "parseState",a.warnings,
        a.extracted_text AS "text",a.created_at AS "createdAt",s.id AS "sessionId",s.title AS "sessionTitle"
       FROM ${T}attachment a JOIN ${T}session s ON s.id=a.session_id
       WHERE s.organization_id=$1 AND s.project_id=$2 AND s.item_id=$3 AND s.id<>$4
       ORDER BY a.created_at DESC LIMIT 100`,
      [scope.organizationId, scope.projectId, scope.itemId, exceptSessionId],
    )
  ).rows;
}

// The attachment a reference was copied to in this session, if any (one copy per source).
export async function findReferenced(db, sessionId, storageKey) {
  return (
    await db.query(`SELECT id FROM ${T}attachment WHERE session_id=$1 AND storage_key=$2`, [
      sessionId,
      storageKey,
    ])
  ).rows[0];
}

// For the development overview (contract 3.6): each item's latest turn.
export async function lastTurns(db, organizationId, projectId) {
  return (
    await db.query(
      `SELECT s.item_id AS "itemId",max(t.started_at) AS at FROM ${T}session s
       JOIN ${T}turn t ON t.session_id=s.id WHERE s.organization_id=$1 AND s.project_id=$2
       GROUP BY s.item_id`,
      [organizationId, projectId],
    )
  ).rows;
}
