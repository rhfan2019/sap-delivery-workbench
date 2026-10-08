import { createHash } from 'node:crypto';
import { failure } from '../../../platform/auth.mjs';
import { validateCommand } from '@sap-delivery-workbench/contracts/fs-workspace';
import { authorizeWorkspace } from '../access.mjs';
import { createWorkspace, readWorkspace } from './service.mjs';
import { readCollections } from './repository.mjs';

const base = '/api/projects/:projectId/development-items/:id/fs-workspace';
const envelope = (req, data, revision = null) => ({
  data,
  meta: { request_id: req.id, workspace_revision: revision },
});

export function registerWorkspaceRoutes(app, c) {
  app.get(base, async (req) => {
    const { current, project } = await c.read(req);
    const { scope, capabilities } = await authorizeWorkspace(c, req, c.pool, current, project);
    const workspace = await readWorkspace(c.pool, scope);
    const { rows: legacy } = await c.pool.query(
      'SELECT 1 FROM app.fs_draft WHERE organization_id=$1 AND project_id=$2 AND item_id=$3',
      [scope.organizationId, scope.projectId, scope.itemId],
    );
    const collections = await readCollections(c.pool, scope, workspace?.id);
    return envelope(
      req,
      { workspace, capabilities, legacy_available: legacy.length > 0, ...collections },
      workspace?.revision ?? null,
    );
  });
  app.post(base, async (req, reply) =>
    c.write(req, async (db, current, project) => {
      await db.query('SELECT id FROM app.project WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
        c.organizationId,
        req.params.projectId,
      ]);
      // Recheck after acquiring the project lock; archival may have won while waiting.
      project = await c.access(db, current, req.params.projectId, true);
      const { scope } = await authorizeWorkspace(c, req, db, current, project, { write: true });
      const key = req.headers['idempotency-key'];
      if (
        typeof key !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
      )
        throw failure(428, '需要合法的 Idempotency-Key。');
      if (!validateCommand('createFsWorkspace', req.body).ok)
        throw failure(400, '工作区输入无效。');
      const hash = createHash('sha256')
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(req.body).sort(([a], [b]) => a.localeCompare(b, 'en')),
            ),
          ),
        )
        .digest('hex');
      const workspace = await createWorkspace(db, scope, req.body);
      const action = 'createFsWorkspace';
      const { rows } = await db.query(
        'SELECT request_hash,result FROM app.fs_command_receipt WHERE workspace_id=$1 AND actor_id=$2 AND action=$3 AND key=$4',
        [workspace.id, scope.actorId, action, key],
      );
      if (rows.length) {
        if (rows[0].request_hash !== hash) {
          const error = failure(409, '同一幂等键不能用于不同内容。');
          error.code = 'IDEMPOTENCY_CONFLICT';
          throw error;
        }
        reply.code(201);
        return envelope(req, rows[0].result, rows[0].result.revision);
      }
      await db.query(
        "INSERT INTO app.fs_command_receipt(organization_id,project_id,workspace_id,actor_id,action,key,request_hash,status,result) VALUES($1,$2,$3,$4,$5,$6,$7,'committed',$8)",
        [
          scope.organizationId,
          scope.projectId,
          workspace.id,
          scope.actorId,
          action,
          key,
          hash,
          workspace,
        ],
      );
      await c.event(db, req, current, 'fs_workspace_created', { workspace_id: workspace.id });
      reply.code(201);
      return envelope(req, workspace, workspace.revision);
    }),
  );
}
