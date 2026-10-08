import { failure } from '../../../platform/auth.mjs';
import { authorizeWorkspace } from '../access.mjs';
import { validateCommand } from '@sap-delivery-workbench/contracts/fs-workspace';
import { contentHash } from '../document/ast.mjs';

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const envelope = (req, data, revision = null) => ({
  data,
  meta: { request_id: req.id, workspace_revision: revision },
});
export function commandError(status, code, message) {
  const error = failure(status, message);
  error.code = code;
  return error;
}

export async function readContext(c, req) {
  const { current, project } = await c.read(req);
  const context = await authorizeWorkspace(c, req, c.pool, current, project);
  const { rows } = await c.pool.query(
    'SELECT * FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND active',
    [c.organizationId, req.params.projectId, req.params.id],
  );
  if (!rows.length) throw failure(404, '工作区不存在或无权访问。');
  return { ...context, workspace: rows[0], scope: { ...context.scope, workspaceId: rows[0].id } };
}

export async function executeCommand(
  c,
  req,
  operationId,
  execute,
  { head = true, capability } = {},
) {
  return c.write(req, async (db, current, project) => {
    await db.query('SELECT id FROM app.project WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
      c.organizationId,
      req.params.projectId,
    ]);
    project = await c.access(db, current, req.params.projectId, true);
    const context = await authorizeWorkspace(c, req, db, current, project, {
      write: true,
      capability,
    });
    const { rows } = await db.query(
      'SELECT * FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND active FOR UPDATE',
      [c.organizationId, req.params.projectId, req.params.id],
    );
    if (!rows.length) throw failure(404, '工作区不存在或无权访问。');
    const workspace = rows[0],
      scope = { ...context.scope, workspaceId: workspace.id };
    if (
      (
        await db.query(
          "SELECT 1 FROM app.item_work_version WHERE workspace_id=$1 AND stage='design' LIMIT 1",
          [workspace.id],
        )
      ).rowCount
    )
      throw commandError(
        409,
        'WORKSPACE_MOVED',
        '当前稿已由开发项设计工作区接管，请从开发清单的设计入口继续。',
      );
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !uuidPattern.test(key))
      throw commandError(428, 'PRECONDITION_REQUIRED', '需要合法的 Idempotency-Key。');
    if (!validateCommand(operationId, req.body).ok)
      throw commandError(400, 'INVALID_INPUT', '命令输入无效。');
    const expected = req.headers['if-match'];
    if (head && (typeof expected !== 'string' || !/^"ws:[0-9a-f-]+:[0-9]+"$/.test(expected)))
      throw commandError(428, 'PRECONDITION_REQUIRED', '需要合法的 If-Match。');
    const hash = contentHash({
      params: { ...req.params },
      body: req.body,
      expected: head ? expected : null,
    });
    const { rows: receipts } = await db.query(
      'SELECT request_hash,result FROM app.fs_command_receipt WHERE workspace_id=$1 AND actor_id=$2 AND action=$3 AND key=$4',
      [workspace.id, scope.actorId, operationId, key],
    );
    if (receipts.length) {
      if (receipts[0].request_hash !== hash)
        throw commandError(409, 'IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同请求。');
      return envelope(req, receipts[0].result.data, receipts[0].result.workspace_revision);
    }
    if (head && expected !== `"ws:${workspace.id}:${workspace.row_version}"`)
      throw commandError(409, 'VERSION_CONFLICT', '工作区版本已更新，请保留修改并刷新。');
    const result = await execute(db, scope, workspace);
    const {
      rows: [updated],
    } = await db.query('SELECT row_version::text AS revision FROM app.fs_workspace WHERE id=$1', [
      workspace.id,
    ]);
    const stored = {
      data: result.data,
      result_ids: result.result_ids ?? [],
      workspace_revision: updated.revision,
    };
    await db.query(
      "INSERT INTO app.fs_command_receipt(organization_id,project_id,workspace_id,actor_id,action,key,request_hash,status,result) VALUES($1,$2,$3,$4,$5,$6,$7,'committed',$8)",
      [
        scope.organizationId,
        scope.projectId,
        workspace.id,
        scope.actorId,
        operationId,
        key,
        hash,
        stored,
      ],
    );
    await c.event(db, req, current, operationId, {
      workspace_id: workspace.id,
      result_ids: stored.result_ids,
    });
    return envelope(req, result.data, updated.revision);
  });
}
