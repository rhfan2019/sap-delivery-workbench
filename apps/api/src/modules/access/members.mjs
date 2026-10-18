import { SENSITIVE_PERMISSIONS } from '@sap-delivery-workbench/contracts/access/catalog';
import { failure } from '../../platform/auth.mjs';
import { listRoles } from './roles.mjs';
import * as v from './validation.mjs';

// Project members and their project roles (docs/specs/project-access-admin.md 2.4, 2.7).
// Membership anchors the project roles, so the access module maintains app.project_member.

const today = () => new Date().toISOString().slice(0, 10);
const active = (a) => a.validFrom <= today() && (!a.validTo || a.validTo >= today());

export async function projectMembers(db, org, projectId) {
  const members = (
    await db.query(
      `SELECT u.id,u.display_name AS "displayName",u.login_name AS "loginName",u.email,u.status AS "accountStatus",
        u.person_type AS "personType",u.skill_modules AS "skillModules",pos.name AS "positionName",
        m.status AS "organizationStatus",pm.joined_at AS "joinedAt",pm.row_version AS "rowVersion"
      FROM app.project_member pm JOIN app.app_user u ON u.id=pm.user_id
      JOIN app.organization_member m ON m.organization_id=pm.organization_id AND m.user_id=pm.user_id
      LEFT JOIN app.access_position pos ON pos.id=u.position_id
      WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.status='active' ORDER BY u.display_name,u.id`,
      [org, projectId],
    )
  ).rows;
  const roles = (
    await db.query(
      `SELECT a.id,a.user_id,a.role_id AS "roleId",r.code AS "roleCode",r.name AS "roleName",r.kind AS "roleKind",
        a.modules,a.own_only AS "ownOnly",a.valid_from::text AS "validFrom",a.valid_to::text AS "validTo",
        a.row_version AS "rowVersion"
      FROM app.access_project_role a JOIN app.access_role r ON r.id=a.role_id
      WHERE a.organization_id=$1 AND a.project_id=$2 ORDER BY r.code`,
      [org, projectId],
    )
  ).rows;
  for (const m of members)
    m.roles = roles
      .filter((r) => r.user_id === m.id)
      .map(({ user_id, ...r }) => ({ ...r, active: active(r) }));
  return members;
}

function roleRows(body, knownModules) {
  if (!Array.isArray(body?.roles) || !body.roles.length || body.roles.length > 20)
    throw failure(400, '请至少选择一个项目内角色。');
  const rows = body.roles.map((r) => ({
    roleId: v.uuid(r?.roleId, '角色'),
    modules: v.strings(r?.modules, '模块范围', knownModules),
    ownOnly: r?.ownOnly === true,
    ...v.validity(r),
  }));
  if (new Set(rows.map((r) => r.roleId)).size !== rows.length)
    throw failure(400, '同一个角色只能分配一次。');
  return rows;
}

// Section 2.7: any project role may be handed out, but one carrying sensitive permissions
// only by someone holding them here; nobody changes their own roles.
async function checkRoles(org, db, current, grant, userId, rows) {
  if (userId === current.user.id) throw failure(400, '不能修改自己在项目中的角色。');
  const all = await listRoles(db, org);
  const { rows: users } = await db.query(
    `SELECT u.person_type AS "personType" FROM app.app_user u JOIN app.organization_member m
    ON m.user_id=u.id AND m.organization_id=$1 WHERE u.id=$2 AND u.status='active' AND m.status='active'`,
    [org, userId],
  );
  if (!users[0]) throw failure(409, '只能添加当前企业的有效用户。');
  for (const row of rows) {
    const role = all.find((r) => r.id === row.roleId);
    if (!role || role.scope !== 'project') throw failure(400, '请选择项目级角色。');
    if (role.status !== 'active') throw failure(409, `角色“${role.name}”已停用。`);
    const sensitive = role.permissions.filter(
      (c) => SENSITIVE_PERMISSIONS.includes(c) && !grant.has(c),
    );
    if (sensitive.length)
      throw Object.assign(
        failure(403, `角色“${role.name}”含有您在本项目没有的敏感权限，不能分配。`),
        { code: 'ACCESS_ESCALATION', details: { permissions: sensitive } },
      );
    if (users[0].personType !== 'employee' && !row.validTo)
      throw failure(400, '分包与外部人员的角色必须设结束日期。');
  }
}
async function writeRoles(org, db, current, projectId, userId, rows) {
  const existing = (
    await db.query(
      'SELECT id,role_id FROM app.access_project_role WHERE organization_id=$1 AND project_id=$2 AND user_id=$3',
      [org, projectId, userId],
    )
  ).rows;
  const keep = rows.map((r) => r.roleId);
  await db.query(
    'DELETE FROM app.access_project_role WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND NOT role_id=ANY($4)',
    [org, projectId, userId, keep],
  );
  for (const r of rows) {
    const prior = existing.find((e) => e.role_id === r.roleId);
    if (prior)
      await db.query(
        `UPDATE app.access_project_role SET modules=$2,own_only=$3,valid_from=$4,valid_to=$5,granted_by=$6,
        row_version=row_version+1,updated_at=now() WHERE id=$1`,
        [prior.id, r.modules, r.ownOnly, r.validFrom, r.validTo, current.user.id],
      );
    else
      await db.query(
        `INSERT INTO app.access_project_role(organization_id,project_id,user_id,role_id,modules,own_only,valid_from,valid_to,granted_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          org,
          projectId,
          userId,
          r.roleId,
          r.modules,
          r.ownOnly,
          r.validFrom,
          r.validTo,
          current.user.id,
        ],
      );
  }
}

// Adds a member with project roles given by code (used when a project is created with its
// manager). Runs inside the caller's transaction; `grant` is the caller's grant in the project.
export async function addMember(org, db, current, grant, userId, roleCodes) {
  const all = await listRoles(db, org);
  const rows = roleCodes.map((code) => {
    const role = all.find((r) => r.code === code);
    if (!role) throw failure(400, `角色 ${code} 不存在。`);
    return { roleId: role.id, modules: [], ownOnly: false, ...v.validity({}) };
  });
  await checkRoles(org, db, current, grant, userId, rows);
  await db.query(
    `INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)
    ON CONFLICT(organization_id,project_id,user_id) DO UPDATE SET status='active',joined_at=now(),
    row_version=app.project_member.row_version+1,updated_at=now()`,
    [org, grant.project.id, userId],
  );
  await writeRoles(org, db, current, grant.project.id, userId, rows);
}

export function memberRoutes(app, ctx) {
  const { pool, organizationId: org, readProject, writeProject } = ctx;
  const base = '/api/projects/:projectId/members';

  app.get(base, async (req) => {
    const { project } = await readProject(req, 'project.member:view');
    return projectMembers(pool, org, project.id);
  });
  // The project roles a member manager chooses from (role:view is not needed for this).
  app.get('/api/projects/:projectId/roles', async (req) => {
    await readProject(req, 'project.member:view');
    return (await listRoles(pool, org)).filter((r) => r.scope === 'project');
  });
  // Active users who are not members yet, with the project roles their position suggests.
  app.get('/api/projects/:projectId/member-candidates', async (req) => {
    const { project } = await readProject(req, 'project.member:manage');
    const { rows } = await pool.query(
      `SELECT u.id,u.display_name AS "displayName",u.login_name AS "loginName",u.person_type AS "personType",
        u.skill_modules AS "skillModules",pos.name AS "positionName",
        COALESCE((SELECT array_agg(pr.role_id) FROM app.access_position_role pr JOIN app.access_role r ON r.id=pr.role_id
          WHERE pr.position_id=u.position_id AND r.scope='project' AND r.status='active'),'{}') AS "defaultRoleIds"
      FROM app.app_user u JOIN app.organization_member m ON m.user_id=u.id AND m.organization_id=$1
      LEFT JOIN app.access_position pos ON pos.id=u.position_id
      WHERE u.status='active' AND m.status='active' AND NOT EXISTS(
        SELECT 1 FROM app.project_member pm WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.user_id=u.id AND pm.status='active')
      ORDER BY u.display_name,u.id`,
      [org, project.id],
    );
    return rows;
  });

  const modulesOf = (project) => (project.modules?.length ? project.modules : undefined);

  app.post(base, async (req, reply) => {
    const userId = v.uuid(req.body?.userId, '用户');
    const result = await writeProject(
      req,
      'project.member:manage',
      'access.project_member.add',
      'project',
      async (db, current, grant) => {
        const rows = roleRows(req.body, modulesOf(grant.project));
        await checkRoles(org, db, current, grant, userId, rows);
        const { rows: member } = await db.query(
          "SELECT 1 FROM app.project_member WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'",
          [org, grant.project.id, userId],
        );
        if (member[0]) throw failure(409, '该用户已是项目成员。');
        await db.query(
          `INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)
          ON CONFLICT(organization_id,project_id,user_id) DO UPDATE SET status='active',joined_at=now(),
          row_version=app.project_member.row_version+1,updated_at=now()`,
          [org, grant.project.id, userId],
        );
        await writeRoles(org, db, current, grant.project.id, userId, rows);
        return {
          subjectId: grant.project.id,
          data: await projectMembers(db, org, grant.project.id),
          details: { userId, roles: rows },
        };
      },
    );
    reply.code(201);
    return result;
  });
  app.put(base + '/:userId/roles', async (req) => {
    const userId = v.uuid(req.params.userId, '用户');
    return writeProject(
      req,
      'project.member:manage',
      'access.project_member.roles',
      'project',
      async (db, current, grant) => {
        const rows = roleRows(req.body, modulesOf(grant.project));
        const { rows: member } = await db.query(
          "SELECT 1 FROM app.project_member WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'",
          [org, grant.project.id, userId],
        );
        if (!member[0]) throw failure(404, '成员不存在。');
        await checkRoles(org, db, current, grant, userId, rows);
        // Taking away a sensitive role needs the same rights as handing it out.
        const all = await listRoles(db, org);
        const removed = (
          await db.query(
            'SELECT role_id FROM app.access_project_role WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND NOT role_id=ANY($4)',
            [org, grant.project.id, userId, rows.map((r) => r.roleId)],
          )
        ).rows.map((r) => all.find((x) => x.id === r.role_id));
        if (
          removed.some((r) =>
            r.permissions.some((c) => SENSITIVE_PERMISSIONS.includes(c) && !grant.has(c)),
          )
        )
          throw failure(403, '撤销的角色含有您在本项目没有的敏感权限。');
        await writeRoles(org, db, current, grant.project.id, userId, rows);
        return {
          subjectId: grant.project.id,
          data: await projectMembers(db, org, grant.project.id),
          details: { userId, roles: rows },
        };
      },
    );
  });
  app.delete(base + '/:userId', async (req) => {
    const userId = v.uuid(req.params.userId, '用户'),
      revision = v.version(req.body?.rowVersion);
    return writeProject(
      req,
      'project.member:manage',
      'access.project_member.remove',
      'project',
      async (db, current, grant) => {
        if (userId === current.user.id) throw failure(400, '不能把自己移出项目。');
        const all = await listRoles(db, org);
        const held = (
          await db.query(
            'SELECT role_id FROM app.access_project_role WHERE organization_id=$1 AND project_id=$2 AND user_id=$3',
            [org, grant.project.id, userId],
          )
        ).rows.map((r) => all.find((x) => x.id === r.role_id));
        if (
          held.some((r) =>
            r.permissions.some((c) => SENSITIVE_PERMISSIONS.includes(c) && !grant.has(c)),
          )
        )
          throw failure(403, '该成员持有您在本项目没有的敏感权限，不能移出。');
        await db.query(
          'DELETE FROM app.access_project_role WHERE organization_id=$1 AND project_id=$2 AND user_id=$3',
          [org, grant.project.id, userId],
        );
        const { rowCount } = await db.query(
          `UPDATE app.project_member SET status='removed',row_version=row_version+1,updated_at=now()
          WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND status='active' AND row_version=$4`,
          [org, grant.project.id, userId, revision],
        );
        if (!rowCount) throw failure(409, '成员已被其他操作更新，请刷新后重试。');
        return {
          subjectId: grant.project.id,
          data: await projectMembers(db, org, grant.project.id),
          details: { userId },
        };
      },
    );
  });
}
