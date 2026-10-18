import { SUPER_ADMIN } from '@sap-delivery-workbench/contracts/access/catalog';
import { failure } from '../../platform/auth.mjs';
import { listRoles, missingForGrant, escalation } from './roles.mjs';
import * as v from './validation.mjs';

// Organization-level assignments, the user permission view and the user facts the access
// module keeps on app_user (docs/specs/project-access-admin.md 2.6–2.8).

const today = () => new Date().toISOString().slice(0, 10);
const active = (a) => a.validFrom <= today() && (!a.validTo || a.validTo >= today());

// Section 2.7: the organization keeps at least one valid super administrator. `change`
// describes what the pending write removes: an assignment, or every assignment of a user.
export async function keepsSuperAdmin(db, org, change = {}) {
  const { rows } = await db.query(
    `SELECT count(DISTINCT a.user_id)::int AS n FROM app.access_assignment a
    JOIN app.access_role r ON r.id=a.role_id AND r.code=$2 AND r.status='active'
    JOIN app.organization_member m ON m.organization_id=a.organization_id AND m.user_id=a.user_id AND m.status='active'
    JOIN app.app_user u ON u.id=a.user_id AND u.status='active'
    WHERE a.organization_id=$1 AND a.valid_from<=current_date AND (a.valid_to IS NULL OR a.valid_to>=current_date)
    AND a.id IS DISTINCT FROM $3::uuid AND a.user_id IS DISTINCT FROM $4::uuid`,
    [org, SUPER_ADMIN, change.assignmentId ?? null, change.userId ?? null],
  );
  if (rows[0].n < 1) throw failure(409, '必须保留至少一位有效的超级管理员。');
}

const assignmentColumns = `a.id,a.role_id AS "roleId",r.code AS "roleCode",r.name AS "roleName",r.kind AS "roleKind",
  a.project_scope AS "projectScope",a.scope_ids AS "scopeIds",a.valid_from::text AS "validFrom",a.valid_to::text AS "validTo",
  g.display_name AS "grantedBy",a.granted_at AS "grantedAt",a.row_version AS "rowVersion"`;
export async function userAssignments(db, org, userId) {
  return (
    await db.query(
      `SELECT ${assignmentColumns} FROM app.access_assignment a JOIN app.access_role r ON r.id=a.role_id
      LEFT JOIN app.app_user g ON g.id=a.granted_by WHERE a.organization_id=$1 AND a.user_id=$2 ORDER BY r.code`,
      [org, userId],
    )
  ).rows.map((a) => ({ ...a, active: active(a) }));
}

// Position, person type, skill modules and organization roles of some users, for user lists.
export async function describeUsers(db, org, userIds) {
  if (!userIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT u.id,u.person_type AS "personType",u.skill_modules AS "skillModules",
      p.id AS "positionId",p.name AS "positionName",
      COALESCE((SELECT json_agg(json_build_object('code',r.code,'name',r.name,'validTo',a.valid_to) ORDER BY r.code)
        FROM app.access_assignment a JOIN app.access_role r ON r.id=a.role_id
        WHERE a.organization_id=$1 AND a.user_id=u.id AND a.valid_from<=current_date
        AND (a.valid_to IS NULL OR a.valid_to>=current_date)),'[]') AS roles
    FROM app.app_user u LEFT JOIN app.access_position p ON p.id=u.position_id AND p.organization_id=$1
    WHERE u.id=ANY($2)`,
    [org, userIds],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        personType: r.personType,
        skillModules: r.skillModules,
        position: r.positionId ? { id: r.positionId, name: r.positionName } : null,
        roles: r.roles,
      },
    ]),
  );
}

// Person type, skill modules and position of a user (called by admin when saving a user).
// With `grantRoles`, the position's organization roles are granted (only adding; section 2.6).
export async function saveProfile(ctx, db, current, userId, body = {}) {
  const org = ctx.organizationId;
  const personType = v.choice(
    body.personType,
    ['employee', 'subcontractor', 'external'],
    '人员类型',
    'employee',
  );
  const skillModules = v.strings(body.skillModules, '擅长模块');
  const positionId = body.positionId ? v.uuid(body.positionId, '职位') : null;
  if (positionId) {
    const { rows } = await db.query(
      "SELECT id FROM app.access_position WHERE organization_id=$1 AND id=$2 AND status='active'",
      [org, positionId],
    );
    if (!rows[0]) throw failure(400, '职位不存在或已停用。');
  }
  await db.query(
    'UPDATE app.app_user SET person_type=$2,skill_modules=$3,position_id=$4 WHERE id=$1',
    [userId, personType, skillModules, positionId],
  );
  const granted = [];
  if (positionId && body.grantPositionRoles) {
    const roles = (
      await db.query(
        `SELECT r.id,r.code FROM app.access_position_role pr JOIN app.access_role r ON r.id=pr.role_id
        WHERE pr.position_id=$1 AND r.scope='organization' AND r.status='active'`,
        [positionId],
      )
    ).rows;
    if (roles.length && userId === current.user.id) throw failure(400, '不能给自己授予角色。');
    if (roles.length && personType !== 'employee')
      throw failure(400, '分包与外部人员的角色必须设结束日期，请在用户的角色中逐个授予。');
    const all = await listRoles(db, org);
    const codes = [...new Set(roles.flatMap((r) => all.find((x) => x.id === r.id).permissions))];
    const missing = await missingForGrant(ctx, db, current.user.id, codes);
    if (missing.length) throw escalation(missing);
    for (const role of roles) {
      const { rowCount } = await db.query(
        `INSERT INTO app.access_assignment(organization_id,user_id,role_id,project_scope,granted_by)
        VALUES($1,$2,$3,'all',$4) ON CONFLICT(organization_id,user_id,role_id) DO NOTHING`,
        [org, userId, role.id, current.user.id],
      );
      if (rowCount) granted.push(role.code);
    }
  }
  return { personType, skillModules, positionId, granted };
}

function assignmentInput(body = {}) {
  const projectScope = v.choice(
    body.projectScope,
    ['all', 'customers', 'projects', 'none'],
    '项目范围',
    'all',
  );
  const scopeIds = ['customers', 'projects'].includes(projectScope)
    ? v.uuids(body.scopeIds ?? [], '范围对象')
    : [];
  if (['customers', 'projects'].includes(projectScope) && !scopeIds.length)
    throw failure(400, '请选择范围内的客户或项目。');
  return { projectScope, scopeIds, ...v.validity(body) };
}

export function assignmentRoutes(app, ctx) {
  const { pool, organizationId: org, authorize, write } = ctx;
  async function target(db, id) {
    const { rows } = await db.query(
      `SELECT u.id,u.person_type AS "personType",u.status FROM app.app_user u
      JOIN app.organization_member m ON m.user_id=u.id WHERE m.organization_id=$1 AND u.id=$2`,
      [org, id],
    );
    if (!rows[0]) throw failure(404, '用户不存在或不属于当前企业。');
    return rows[0];
  }
  async function checkScopeIds(db, input) {
    if (!input.scopeIds.length) return;
    const table = input.projectScope === 'customers' ? 'customer' : 'project';
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM app.${table} WHERE organization_id=$1 AND id=ANY($2)`,
      [org, input.scopeIds],
    );
    if (rows[0].n !== input.scopeIds.length) throw failure(400, '范围内的客户或项目不存在。');
  }

  // Everything one user holds: organization assignments, project roles and effective permissions.
  app.get('/api/admin/users/:id/access', async (req) => {
    await authorize(req, 'user:view');
    const id = v.uuid(req.params.id);
    await target(pool, id);
    const projects = (
      await pool.query(
        `SELECT a.id,a.project_id AS "projectId",p.code AS "projectCode",p.name AS "projectName",p.status AS "projectStatus",
          r.code AS "roleCode",r.name AS "roleName",a.modules,a.own_only AS "ownOnly",
          a.valid_from::text AS "validFrom",a.valid_to::text AS "validTo"
        FROM app.access_project_role a JOIN app.access_role r ON r.id=a.role_id JOIN app.project p ON p.id=a.project_id
        JOIN app.project_member pm ON pm.organization_id=a.organization_id AND pm.project_id=a.project_id AND pm.user_id=a.user_id AND pm.status='active'
        WHERE a.organization_id=$1 AND a.user_id=$2 ORDER BY p.name,r.code`,
        [org, id],
      )
    ).rows.map((a) => ({ ...a, active: active(a) }));
    const effective = (await ctx.projects(pool, id)).map((g) => ({
      projectId: g.project.id,
      projectCode: g.project.code,
      projectName: g.project.name,
      permissions: g.sources(),
    }));
    return {
      assignments: await userAssignments(pool, org, id),
      projectRoles: projects,
      organization: await ctx.organization(pool, id, { withSources: true }),
      projects: effective,
    };
  });

  app.post('/api/admin/users/:id/assignments', async (req, reply) => {
    const id = v.uuid(req.params.id),
      roleId = v.uuid(req.body?.roleId, '角色'),
      input = assignmentInput(req.body);
    const result = await write(
      req,
      'assignment:manage',
      'access.assignment.create',
      'user',
      async (db, current) => {
        if (id === current.user.id) throw failure(400, '不能修改自己的角色。');
        const user = await target(db, id);
        if (user.personType !== 'employee' && !input.validTo)
          throw failure(400, '分包与外部人员的角色必须设结束日期。');
        await checkScopeIds(db, input);
        const role = (await listRoles(db, org)).find((r) => r.id === roleId);
        if (!role || role.scope !== 'organization') throw failure(400, '请选择企业级角色。');
        if (role.status !== 'active') throw failure(409, '角色已停用。');
        const missing = await missingForGrant(ctx, db, current.user.id, role.permissions);
        if (missing.length) throw escalation(missing);
        const { rows } = await db.query(
          `INSERT INTO app.access_assignment(organization_id,user_id,role_id,project_scope,scope_ids,valid_from,valid_to,granted_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,user_id,role_id) DO NOTHING RETURNING id`,
          [
            org,
            id,
            roleId,
            input.projectScope,
            input.scopeIds,
            input.validFrom,
            input.validTo,
            current.user.id,
          ],
        );
        if (!rows[0]) throw failure(409, '该用户已有这个角色，请修改原分配。');
        return {
          subjectId: id,
          data: await userAssignments(db, org, id),
          details: { assignmentId: rows[0].id, role: role.code, ...input },
        };
      },
    );
    reply.code(201);
    return result;
  });

  async function assignment(db, id) {
    const { rows } = await db.query(
      `SELECT a.*,r.code AS role_code FROM app.access_assignment a
      JOIN app.access_role r ON r.id=a.role_id WHERE a.organization_id=$1 AND a.id=$2`,
      [org, id],
    );
    if (!rows[0]) throw failure(404, '分配不存在。');
    return rows[0];
  }
  app.patch('/api/admin/assignments/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion),
      input = assignmentInput(req.body);
    return write(
      req,
      'assignment:manage',
      'access.assignment.update',
      'user',
      async (db, current) => {
        const existing = await assignment(db, id);
        if (existing.user_id === current.user.id) throw failure(400, '不能修改自己的角色。');
        const user = await target(db, existing.user_id);
        if (user.personType !== 'employee' && !input.validTo)
          throw failure(400, '分包与外部人员的角色必须设结束日期。');
        await checkScopeIds(db, input);
        const role = (await listRoles(db, org)).find((r) => r.id === existing.role_id);
        const missing = await missingForGrant(ctx, db, current.user.id, role.permissions);
        if (missing.length) throw escalation(missing);
        const { rowCount } = await db.query(
          `UPDATE app.access_assignment SET project_scope=$3,scope_ids=$4,valid_from=$5,valid_to=$6,granted_by=$7,
        row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND row_version=$8`,
          [
            org,
            id,
            input.projectScope,
            input.scopeIds,
            input.validFrom,
            input.validTo,
            current.user.id,
            revision,
          ],
        );
        if (!rowCount) throw failure(409, '分配已被其他操作更新，请刷新后重试。');
        if (existing.role_code === SUPER_ADMIN) {
          const stillValid =
            input.validFrom <= today() && (!input.validTo || input.validTo >= today());
          if (!stillValid) await keepsSuperAdmin(db, org, { assignmentId: id });
        }
        return {
          subjectId: existing.user_id,
          data: await userAssignments(db, org, existing.user_id),
          details: { assignmentId: id, role: existing.role_code, ...input },
        };
      },
    );
  });
  app.delete('/api/admin/assignments/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion);
    return write(
      req,
      'assignment:manage',
      'access.assignment.delete',
      'user',
      async (db, current) => {
        const existing = await assignment(db, id);
        if (existing.user_id === current.user.id) throw failure(400, '不能修改自己的角色。');
        if (existing.role_code === SUPER_ADMIN)
          await keepsSuperAdmin(db, org, { assignmentId: id });
        const { rowCount } = await db.query(
          'DELETE FROM app.access_assignment WHERE organization_id=$1 AND id=$2 AND row_version=$3',
          [org, id, revision],
        );
        if (!rowCount) throw failure(409, '分配已被其他操作更新，请刷新后重试。');
        return {
          subjectId: existing.user_id,
          data: await userAssignments(db, org, existing.user_id),
          details: { assignmentId: id, role: existing.role_code },
        };
      },
    );
  });
}
