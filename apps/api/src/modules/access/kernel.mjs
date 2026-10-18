import {
  SCOPED_PERMISSIONS,
  groupOf,
  permissionOf,
  scopeOf,
} from '@sap-delivery-workbench/contracts/access/catalog';
import { failure } from '../../platform/auth.mjs';

// Contract 3.5: every authorization decision of the API goes through this kernel. Grants are
// computed on each request from the current assignments, so changes apply immediately and
// expired assignments stop counting on their end date (docs/specs/project-access-admin.md 2.7).

// Every valid assignment of a user, expanded to the permission codes of its single roles.
const GRANTS = `
WITH bound AS (
  SELECT a.id AS assignment_id, 'organization' AS level, a.role_id, a.project_scope, a.scope_ids,
         NULL::uuid AS project_id, '{}'::text[] AS modules, false AS own_only, a.valid_to
  FROM app.access_assignment a
  WHERE a.organization_id = $1 AND a.user_id = $2
    AND a.valid_from <= current_date AND (a.valid_to IS NULL OR a.valid_to >= current_date)
  UNION ALL
  SELECT r.id, 'project', r.role_id, 'projects', ARRAY[r.project_id], r.project_id, r.modules,
         r.own_only, r.valid_to
  FROM app.access_project_role r
  JOIN app.project_member pm ON pm.organization_id = r.organization_id
    AND pm.project_id = r.project_id AND pm.user_id = r.user_id AND pm.status = 'active'
  WHERE r.organization_id = $1 AND r.user_id = $2
    AND r.valid_from <= current_date AND (r.valid_to IS NULL OR r.valid_to >= current_date)
), roles AS (
  SELECT b.*, role.code AS role_code, role.name AS role_name,
         COALESCE(c.member_id, role.id) AS single_id
  FROM bound b
  JOIN app.access_role role ON role.id = b.role_id AND role.status = 'active'
  LEFT JOIN app.access_role_composition c ON c.composite_id = role.id
)
SELECT roles.assignment_id AS "assignmentId", roles.level, roles.project_scope AS "projectScope",
       roles.scope_ids AS "scopeIds", roles.project_id AS "projectId", roles.modules,
       roles.own_only AS "ownOnly", roles.valid_to::text AS "validTo", roles.role_code AS "roleCode",
       roles.role_name AS "roleName", single.code AS "singleCode", p.permission
FROM roles
JOIN app.access_role single ON single.id = roles.single_id AND single.status = 'active'
  AND single.kind = 'single'
JOIN app.access_role_permission p ON p.role_id = single.id`;

// Does an organization-level grant reach this project?
function reaches(grant, project) {
  if (grant.level === 'project') return grant.projectId === project.id;
  if (grant.projectScope === 'all') return true;
  if (grant.projectScope === 'customers') return grant.scopeIds.includes(project.customer_id);
  if (grant.projectScope === 'projects') return grant.scopeIds.includes(project.id);
  return false;
}

// The permissions of one user in one project. Each permission keeps every grant it comes
// from: an action is allowed when any single grant allows it, so the module and "own items"
// limits of different assignments never combine into something none of them allows.
export class ProjectGrant {
  constructor(userId, project, grants) {
    this.userId = userId;
    this.project = project;
    this.byCode = new Map();
    for (const g of grants) {
      if (scopeOf(g.permission) !== 'project' || !reaches(g, project)) continue;
      if (!this.byCode.has(g.permission)) this.byCode.set(g.permission, []);
      this.byCode.get(g.permission).push(g);
    }
  }
  // `module` and `owners` describe one development item; leave them out to ask whether the
  // permission is held for any item (for menus and buttons).
  has(code, { module, owners } = {}) {
    const grants = this.byCode.get(code);
    if (!grants) return false;
    if (!SCOPED_PERMISSIONS.includes(code)) return true;
    return grants.some(
      (g) =>
        (module === undefined || !g.modules.length || g.modules.includes(module)) &&
        (owners === undefined || !g.ownOnly || owners.includes(this.userId)),
    );
  }
  get codes() {
    return [...this.byCode.keys()];
  }
  // For the web: each code with the widest limits among its grants.
  toJSON() {
    return {
      projectId: this.project.id,
      permissions: this.codes,
      limits: Object.fromEntries(
        [...this.byCode.entries()]
          .filter(([code]) => SCOPED_PERMISSIONS.includes(code))
          .map(([code, grants]) => [
            code,
            grants.map((g) => ({ modules: g.modules, ownOnly: g.ownOnly })),
          ]),
      ),
    };
  }
  // Where each permission comes from (role, assignment, validity), for the permission views.
  sources() {
    return [...this.byCode.entries()].map(([code, grants]) => ({
      code,
      sources: grants.map(source),
    }));
  }
}
const source = (g) => ({
  assignmentId: g.assignmentId,
  level: g.level,
  roleCode: g.roleCode,
  roleName: g.roleName,
  modules: g.modules,
  ownOnly: g.ownOnly,
  validTo: g.validTo,
});

export function deniedError(code) {
  const permission = permissionOf(code);
  const group = groupOf(permission?.group);
  return Object.assign(
    failure(
      403,
      permission
        ? `需要“${group.label}”中的“${permission.label}”权限，请联系项目经理或管理员。`
        : '没有执行此操作的权限。',
    ),
    { code: 'ACCESS_DENIED', details: { permission: code } },
  );
}
export const hiddenProject = () => failure(404, '项目不存在或无权访问。');

export function createAccess(pool, organizationId) {
  const grantsOf = async (db, userId) => (await db.query(GRANTS, [organizationId, userId])).rows;
  const projectRow = async (db, projectId) =>
    (
      await db.query('SELECT * FROM app.project WHERE organization_id=$1 AND id=$2', [
        organizationId,
        projectId,
      ])
    ).rows[0];

  // Organization-level permission codes of a user, with their sources when asked.
  async function organization(db, userId, { withSources = false } = {}) {
    const grants = (await grantsOf(db, userId)).filter(
      (g) => g.level === 'organization' && scopeOf(g.permission) === 'organization',
    );
    const codes = [...new Set(grants.map((g) => g.permission))];
    if (!withSources) return codes;
    return codes.map((code) => ({
      code,
      sources: grants.filter((g) => g.permission === code).map(source),
    }));
  }
  async function project(db, userId, projectOrId) {
    const p = typeof projectOrId === 'string' ? await projectRow(db, projectOrId) : projectOrId;
    if (!p) return null;
    return new ProjectGrant(userId, p, await grantsOf(db, userId));
  }
  // Every project the user may enter, each with its grant.
  async function projects(db, userId) {
    const grants = await grantsOf(db, userId);
    const { rows } = await db.query(
      'SELECT * FROM app.project WHERE organization_id=$1 ORDER BY updated_at DESC, id DESC',
      [organizationId],
    );
    return rows
      .map((p) => new ProjectGrant(userId, p, grants))
      .filter((g) => g.has('project:view'));
  }
  async function requireOrganization(db, current, code) {
    const codes = await organization(db, current.user.id);
    if (!codes.includes(code)) throw deniedError(code);
    return codes;
  }
  // The project and the user's grant in it; 404 outside the user's projects, 403 when the
  // permission (for this item's module and owners, if given) is missing.
  async function requireProject(db, current, projectId, code, context) {
    if (!/^[0-9a-f-]{36}$/i.test(projectId ?? '')) throw hiddenProject();
    const grant = await project(db, current.user.id, projectId);
    if (!grant?.has('project:view')) throw hiddenProject();
    if (code && !grant.has(code, context)) throw deniedError(code);
    return grant;
  }
  return { organization, project, projects, requireOrganization, requireProject, grantsOf };
}
