import { failure } from '../auth.mjs';

export async function workspaceCapabilities(db, scope, item, project) {
  const { rows } = await db.query(
    'SELECT role FROM app.fs_project_role WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND enabled',
    [scope.organizationId, scope.projectId, scope.actorId],
  );
  const roles = new Set(rows.map((row) => row.role));
  const author = (item.business_owner_id ?? item.created_by) === scope.actorId;
  const writable = project.status !== 'archived';
  return {
    can_edit: writable && (author || project.access_level === 'admin'),
    can_confirm: writable && (author || project.access_level === 'admin'),
    can_review_technical: writable && !author && roles.has('technical_reviewer'),
    can_approve_business: writable && !author && roles.has('business_approver'),
    can_publish: writable && roles.has('publisher'),
    can_export: true,
  };
}

export function workspaceScope(c, req, current) {
  return Object.freeze({
    organizationId: c.organizationId,
    projectId: req.params.projectId,
    itemId: req.params.id,
    actorId: current.user.id,
    sessionId: current.sessionId,
  });
}

export async function authorizeWorkspace(
  c,
  req,
  db,
  current,
  project,
  { write = false, capability } = {},
) {
  const item = await c.item(db, req, write);
  const scope = workspaceScope(c, req, current);
  const capabilities = await workspaceCapabilities(db, scope, item, project);
  if (write && !capabilities[capability ?? 'can_edit'])
    throw failure(403, '无权执行此 FS 工作区操作。');
  return { scope, item, capabilities };
}
