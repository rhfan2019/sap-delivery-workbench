import { randomUUID } from 'node:crypto';
import { failure } from '../../../platform/auth.mjs';
import { readContext, executeCommand, envelope, uuidPattern } from '../workspace/commands.mjs';
import { sessionDto, messageDto, loadSession, appendMessageAndRun } from './service.mjs';
const base = '/api/projects/:projectId/development-items/:id/fs-workspace';
export function registerConversationRoutes(app, c) {
  app.get(base + '/sessions/:sessionId/artifacts', async (req) => {
    const { scope } = await readContext(c, req);
    if (!uuidPattern.test(req.params.sessionId)) throw failure(404, '会话不存在。');
    await loadSession(c.pool, scope, req.params.sessionId);
    const { rows } = await c.pool.query(
      `SELECT m.request_json->'artifact' AS artifact,c.status
       FROM app.fs_message m LEFT JOIN app.fs_change_set c
       ON c.id::text=m.request_json->'artifact'->>'change_set_id'
       AND c.workspace_id=m.workspace_id AND c.organization_id=m.organization_id
       WHERE m.session_id=$1 AND m.role='assistant' AND m.request_json ? 'artifact'
       ORDER BY m.seq DESC LIMIT 100`, [req.params.sessionId]);
    return envelope(req, {items: rows.map(({artifact,status}) => ({...artifact,
      change_set_id: status === 'proposed' ? artifact.change_set_id : null}))});
  });
  app.get(base + '/sessions', async (req) => {
    const { scope } = await readContext(c, req);
    const { rows } = await c.pool.query(
      'SELECT * FROM app.fs_session WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100',
      [scope.organizationId, scope.projectId, scope.workspaceId],
    );
    return envelope(req, { items: rows.map(sessionDto), next_cursor: null });
  });
  app.post(base + '/sessions', async (req, reply) => {
    const result = await executeCommand(
      c,
      req,
      'createFsSession',
      async (db, scope) => {
        if (!req.body.title.trim() || req.body.title.length > 200)
          throw failure(400, '会话标题须为 1–200 字。');
        const {
          rows: [row],
        } = await db.query(
          'INSERT INTO app.fs_session(id,organization_id,project_id,workspace_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [
            randomUUID(),
            scope.organizationId,
            scope.projectId,
            scope.workspaceId,
            req.body.title,
            scope.actorId,
          ],
        );
        return { data: sessionDto(row), result_ids: [row.id] };
      },
      { head: false },
    );
    reply.code(201);
    return result;
  });
  app.get(base + '/sessions/:sessionId/messages', async (req) => {
    const { scope } = await readContext(c, req);
    if (!uuidPattern.test(req.params.sessionId)) throw failure(404, '会话不存在。');
    await loadSession(c.pool, scope, req.params.sessionId);
    const limit = Number(req.query.limit ?? 30),
      cursor = req.query.cursor ?? '0';
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !/^\d{1,16}$/.test(cursor))
      throw failure(400, '消息分页参数无效。');
    const { rows } = await c.pool.query(
      'SELECT * FROM app.fs_message WHERE session_id=$1 AND seq>$2::bigint ORDER BY seq LIMIT $3',
      [req.params.sessionId, cursor, limit + 1],
    );
    return envelope(req, {
      items: rows.slice(0, limit).map(messageDto),
      next_cursor: rows.length > limit ? String(rows[limit - 1].seq) : null,
    });
  });
  app.post(base + '/sessions/:sessionId/messages', { bodyLimit: 100000 }, async (req, reply) => {
    if (!uuidPattern.test(req.params.sessionId)) throw failure(404, '会话不存在。');
    const result = await executeCommand(
      c,
      req,
      'sendFsMessage',
      async (db, scope, workspace) => {
        const data = await appendMessageAndRun(
          db,
          scope,
          workspace,
          req.params.sessionId,
          req.body,
        );
        return { data, result_ids: [data.message.id, data.run.id] };
      },
      { head: false },
    );
    reply.code(202);
    return result;
  });
}
