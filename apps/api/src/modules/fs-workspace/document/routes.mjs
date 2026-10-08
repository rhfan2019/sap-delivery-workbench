import { failure } from '../../../platform/auth.mjs';
import { readContext, executeCommand, envelope, uuidPattern } from '../workspace/commands.mjs';
import { getDocument, snapshotVersion } from './service.mjs';

const base = '/api/projects/:projectId/development-items/:id/fs-workspace';
export function registerDocumentRoutes(app, c) {
  app.get(base + '/versions/:versionId', async (req) => {
    const { scope, workspace } = await readContext(c, req);
    return envelope(
      req,
      await getDocument(c.pool, scope, req.params.versionId),
      String(workspace.row_version),
    );
  });
  app.get(base + '/versions', async (req) => {
    const { scope, workspace } = await readContext(c, req),
      limit = Number(req.query.limit ?? 30),
      cursor = req.query.cursor ?? null;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== null && !/^[0-9]{1,16}$/.test(cursor))
    )
      throw failure(400, '版本分页参数无效。');
    const { rows } = await c.pool.query(
      `SELECT id,seq::text AS revision,formal_number,content_hash FROM app.fs_document_revision WHERE organization_id=$1 AND project_id=$2 AND workspace_id=$3 AND ($4::bigint IS NULL OR seq<$4::bigint) ORDER BY seq DESC LIMIT $5`,
      [scope.organizationId, scope.projectId, scope.workspaceId, cursor, limit + 1],
    );
    return envelope(
      req,
      {
        items: rows.slice(0, limit),
        next_cursor: rows.length > limit ? rows[limit - 1].revision : null,
      },
      String(workspace.row_version),
    );
  });
  app.post(base + '/versions', async (req, reply) => {
    const result = await executeCommand(
      c,
      req,
      'snapshotFsVersion',
      async (db, scope, workspace) => {
        const head = await snapshotVersion(db, scope, workspace, req.body);
        return { data: head, result_ids: [head.id] };
      },
    );
    reply.code(201);
    return result;
  });
  app.get(base + '/commands/:key', async (req) => {
    const { scope, workspace } = await readContext(c, req);
    if (!uuidPattern.test(req.params.key) || typeof req.query.action !== 'string')
      throw failure(400, '命令查询参数无效。');
    const { rows } = await c.pool.query(
      'SELECT result,request_hash FROM app.fs_command_receipt WHERE workspace_id=$1 AND actor_id=$2 AND action=$3 AND key=$4',
      [workspace.id, scope.actorId, req.query.action, req.params.key],
    );
    const receipt = rows[0];
    return envelope(
      req,
      {
        action: req.query.action,
        key: req.params.key,
        state: receipt ? 'committed' : 'not_found',
        result_ids: receipt
          ? (receipt.result.result_ids ?? [receipt.result.id].filter(Boolean))
          : [],
        request_hash: receipt?.request_hash ?? null,
      },
      String(workspace.row_version),
    );
  });
}
