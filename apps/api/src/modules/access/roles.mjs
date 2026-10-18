import {
  BUILT_IN_ROLES,
  ORGANIZATION_PERMISSIONS,
  PERMISSION_CODES,
  PROJECT_PERMISSIONS,
  permissionOf,
  viewOf,
} from '@sap-delivery-workbench/contracts/access/catalog';
import { failure } from '../../platform/auth.mjs';
import * as v from './validation.mjs';

// Roles, positions and the permission report (docs/specs/project-access-admin.md 2.5–2.8).

const roleColumns = `r.id,r.code,r.name,r.description,r.kind,r.scope,r.built_in AS "builtIn",r.status,
  r.row_version AS "rowVersion",r.updated_at AS "updatedAt"`;

// Every role of the organization with its effective permissions, members and usage counts.
export async function listRoles(db, org) {
  const roles = (
    await db.query(
      `SELECT ${roleColumns},
        (SELECT count(*)::int FROM app.access_assignment a WHERE a.role_id=r.id) AS "assignmentCount",
        (SELECT count(*)::int FROM app.access_project_role a WHERE a.role_id=r.id) AS "projectAssignmentCount",
        (SELECT count(*)::int FROM app.access_role_composition c WHERE c.member_id=r.id) AS "compositeCount",
        (SELECT count(*)::int FROM app.access_position_role pr WHERE pr.role_id=r.id) AS "positionCount"
      FROM app.access_role r WHERE r.organization_id=$1 ORDER BY r.built_in DESC,r.scope,r.kind DESC,r.code`,
      [org],
    )
  ).rows;
  const permissions = (
    await db.query(
      'SELECT role_id,permission FROM app.access_role_permission WHERE organization_id=$1',
      [org],
    )
  ).rows;
  const compositions = (
    await db.query(
      'SELECT composite_id,member_id FROM app.access_role_composition WHERE organization_id=$1',
      [org],
    )
  ).rows;
  const byId = new Map(roles.map((r) => [r.id, r]));
  const own = (id) => permissions.filter((p) => p.role_id === id).map((p) => p.permission);
  const order = (codes) => PERMISSION_CODES.filter((c) => codes.includes(c));
  for (const r of roles) {
    if (r.kind === 'single') {
      r.permissions = order(own(r.id));
      r.members = [];
    } else {
      const members = compositions
        .filter((c) => c.composite_id === r.id)
        .map((c) => byId.get(c.member_id));
      r.members = members.map(({ id, code, name, scope, status }) => ({
        id,
        code,
        name,
        scope,
        status,
      }));
      r.permissions = order([
        ...new Set(members.filter((m) => m.status === 'active').flatMap((m) => own(m.id))),
      ]);
    }
    r.inUse = r.assignmentCount + r.projectAssignmentCount + r.compositeCount + r.positionCount > 0;
  }
  // Built-in roles in catalog order (project manager first), custom roles after them by code.
  const rank = (r) => {
    const i = BUILT_IN_ROLES.findIndex((b) => b.code === r.code);
    return i < 0 ? BUILT_IN_ROLES.length : i;
  };
  return roles.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
}

export async function roleById(db, org, id) {
  const role = (await listRoles(db, org)).find((r) => r.id === id);
  if (!role) throw failure(404, '角色不存在。');
  return role;
}

// Who holds a role, directly or through a composite.
export async function roleHolders(db, org, id) {
  const { rows } = await db.query(
    `WITH roles AS (SELECT $2::uuid AS id UNION SELECT composite_id FROM app.access_role_composition WHERE member_id=$2)
    SELECT 'organization' AS level,a.id AS "assignmentId",u.id AS "userId",u.display_name AS "displayName",
      u.login_name AS "loginName",r.code AS "viaCode",r.name AS "viaName",a.project_scope AS "projectScope",
      NULL::uuid AS "projectId",NULL AS "projectName",a.valid_from::text AS "validFrom",a.valid_to::text AS "validTo"
    FROM app.access_assignment a JOIN roles ON roles.id=a.role_id JOIN app.access_role r ON r.id=a.role_id
    JOIN app.app_user u ON u.id=a.user_id WHERE a.organization_id=$1
    UNION ALL
    SELECT 'project',a.id,u.id,u.display_name,u.login_name,r.code,r.name,'projects',p.id,p.name,
      a.valid_from::text,a.valid_to::text
    FROM app.access_project_role a JOIN roles ON roles.id=a.role_id JOIN app.access_role r ON r.id=a.role_id
    JOIN app.app_user u ON u.id=a.user_id JOIN app.project p ON p.id=a.project_id
    JOIN app.project_member pm ON pm.organization_id=a.organization_id AND pm.project_id=a.project_id AND pm.user_id=a.user_id AND pm.status='active'
    WHERE a.organization_id=$1
    ORDER BY "displayName","projectName"`,
    [org, id],
  );
  return rows;
}

// Who holds a permission, and through which role (the permission report).
export async function permissionHolders(db, org, code) {
  const roles = (await listRoles(db, org)).filter((r) => r.permissions.includes(code));
  const holders = [];
  for (const role of roles)
    for (const h of await roleHolders(db, org, role.id))
      if (h.viaCode === role.code) holders.push({ ...h, roleId: role.id });
  return holders;
}

// Section 2.2: a group's other permissions imply its view permission.
export function withViews(codes) {
  return PERMISSION_CODES.filter((c) => codes.includes(c) || codes.some((x) => viewOf(x) === c));
}

// Section 2.7: nobody grants what they do not hold. Organization permissions must be held at
// organization level; project permissions through an organization assignment covering all projects.
export async function missingForGrant(access, db, userId, codes) {
  const grants = await access.grantsOf(db, userId);
  const org = new Set(
    grants
      .filter((g) => g.level === 'organization' && ORGANIZATION_PERMISSIONS.includes(g.permission))
      .map((g) => g.permission),
  );
  const everywhere = new Set(
    grants
      .filter(
        (g) =>
          g.level === 'organization' &&
          g.projectScope === 'all' &&
          PROJECT_PERMISSIONS.includes(g.permission),
      )
      .map((g) => g.permission),
  );
  return codes.filter((c) => !(ORGANIZATION_PERMISSIONS.includes(c) ? org : everywhere).has(c));
}
export function escalation(missing) {
  return Object.assign(
    failure(
      403,
      `不能授予自己没有的权限：${missing
        .slice(0, 5)
        .map((c) => permissionOf(c)?.label ?? c)
        .join('、')}${missing.length > 5 ? ` 等 ${missing.length} 项` : ''}。`,
    ),
    { code: 'ACCESS_ESCALATION', details: { permissions: missing } },
  );
}

const builtInCodes = new Set(BUILT_IN_ROLES.map((r) => r.code));
function roleInput(body = {}, existing) {
  const name = v.text(body.name, '角色名称', 60);
  const description = v.text(body.description, '说明', 300, { optional: true });
  const status = v.choice(
    body.status,
    ['active', 'inactive'],
    '角色状态',
    existing?.status ?? 'active',
  );
  if (existing) return { name, description, status };
  const code = v.code(body.code, '角色编码');
  if (builtInCodes.has(code)) throw failure(409, '该编码属于系统预置角色，请换一个编码。');
  return {
    code,
    name,
    description,
    status,
    kind: v.choice(body.kind, ['single', 'composite'], '角色类型'),
    scope: v.choice(body.scope, ['organization', 'project'], '角色层级'),
  };
}

export function roleRoutes(app, ctx) {
  const { pool, organizationId: org, authorize, write } = ctx;
  const base = '/api/admin/roles';

  app.get(base, async (req) => {
    await authorize(req, 'role:view');
    return listRoles(pool, org);
  });
  app.get(base + '/:id', async (req) => {
    await authorize(req, 'role:view');
    const role = await roleById(pool, org, v.uuid(req.params.id));
    const containedIn = (await listRoles(pool, org))
      .filter((r) => r.members.some((m) => m.id === role.id))
      .map(({ id, code, name }) => ({ id, code, name }));
    return { ...role, containedIn, holders: await roleHolders(pool, org, role.id) };
  });
  app.get('/api/admin/permissions/:code/holders', async (req) => {
    await authorize(req, 'role:view');
    const code = String(req.params.code);
    if (!PERMISSION_CODES.includes(code)) throw failure(404, '权限点不存在。');
    return permissionHolders(pool, org, code);
  });

  // Validates the content of a role (permissions or members) and the grantor's own rights.
  async function content(db, current, role, body) {
    if (role.kind === 'single') {
      const codes = withViews(v.strings(body.permissions, '权限点', PERMISSION_CODES));
      if (role.scope === 'project' && codes.some((c) => !PROJECT_PERMISSIONS.includes(c)))
        throw failure(400, '项目级角色只能包含项目级权限点。');
      const missing = await missingForGrant(ctx, db, current.user.id, codes);
      if (missing.length) throw escalation(missing);
      return { permissions: codes, members: [] };
    }
    const ids = v.uuids(body.members ?? [], '包含的角色');
    if (!ids.length) throw failure(400, '复合角色至少包含一个单一角色。');
    const all = await listRoles(db, org);
    const members = ids.map((id) => all.find((r) => r.id === id));
    if (members.some((m) => !m || m.kind !== 'single'))
      throw failure(400, '复合角色只能包含单一角色。');
    if (role.scope === 'project' && members.some((m) => m.scope !== 'project'))
      throw failure(400, '项目级复合角色只能包含项目级单一角色。');
    const missing = await missingForGrant(ctx, db, current.user.id, [
      ...new Set(members.flatMap((m) => m.permissions)),
    ]);
    if (missing.length) throw escalation(missing);
    return { permissions: [], members: ids };
  }
  async function store(db, id, role, { permissions, members }) {
    await db.query('DELETE FROM app.access_role_permission WHERE role_id=$1', [id]);
    await db.query('DELETE FROM app.access_role_composition WHERE composite_id=$1', [id]);
    if (role.kind === 'single')
      await db.query(
        `INSERT INTO app.access_role_permission(organization_id,role_id,permission) SELECT $1,$2,unnest($3::text[])`,
        [org, id, permissions],
      );
    else
      await db.query(
        `INSERT INTO app.access_role_composition(organization_id,composite_id,member_id) SELECT $1,$2,unnest($3::uuid[])`,
        [org, id, members],
      );
  }

  app.post(base, async (req, reply) => {
    const input = roleInput(req.body);
    const result = await write(
      req,
      'role:manage',
      'access.role.create',
      'role',
      async (db, current) => {
        const body = content(db, current, input, req.body);
        const values = await body;
        const { rows } = await db.query(
          `INSERT INTO app.access_role(organization_id,code,name,description,kind,scope,status,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            org,
            input.code,
            input.name,
            input.description,
            input.kind,
            input.scope,
            input.status,
            current.user.id,
          ],
        );
        await store(db, rows[0].id, input, values);
        return {
          subjectId: rows[0].id,
          data: await roleById(db, org, rows[0].id),
          details: { code: input.code, ...values },
        };
      },
    );
    reply.code(201);
    return result;
  });
  app.patch(base + '/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion);
    return write(req, 'role:manage', 'access.role.update', 'role', async (db, current) => {
      const existing = await roleById(db, org, id);
      if (existing.builtIn) throw failure(409, '系统预置角色不能修改，可以复制为新角色后调整。');
      const input = roleInput(req.body, existing);
      const values = await content(db, current, existing, req.body);
      const { rowCount } = await db.query(
        `UPDATE app.access_role SET name=$3,description=$4,status=$5,row_version=row_version+1,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND row_version=$6`,
        [org, id, input.name, input.description, input.status, revision],
      );
      if (!rowCount) throw failure(409, '角色已被其他操作更新，请刷新后重试。');
      await store(db, id, existing, values);
      return {
        subjectId: id,
        data: await roleById(db, org, id),
        details: { code: existing.code, ...values, status: input.status },
      };
    });
  });
  app.delete(base + '/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion);
    return write(req, 'role:manage', 'access.role.delete', 'role', async (db) => {
      const existing = await roleById(db, org, id);
      if (existing.builtIn) throw failure(409, '系统预置角色不能删除。');
      if (existing.inUse)
        throw failure(409, '角色正在被分配、复合角色或职位使用，请先撤销这些引用，或改为停用。');
      const { rowCount } = await db.query(
        'DELETE FROM app.access_role WHERE organization_id=$1 AND id=$2 AND row_version=$3',
        [org, id, revision],
      );
      if (!rowCount) throw failure(409, '角色已被其他操作更新，请刷新后重试。');
      return { subjectId: id, data: { ok: true }, details: { code: existing.code } };
    });
  });

  // Positions (section 2.6).
  const positionBase = '/api/admin/positions';
  async function listPositions(db) {
    const positions = (
      await db.query(
        `SELECT p.id,p.code,p.name,p.description,p.status,p.row_version AS "rowVersion",
          (SELECT count(*)::int FROM app.app_user u JOIN app.organization_member m ON m.user_id=u.id AND m.organization_id=p.organization_id WHERE u.position_id=p.id) AS "userCount"
        FROM app.access_position p WHERE p.organization_id=$1 ORDER BY p.name,p.id`,
        [org],
      )
    ).rows;
    const roles = (
      await db.query(
        `SELECT pr.position_id,r.id,r.code,r.name,r.scope,r.kind FROM app.access_position_role pr
        JOIN app.access_role r ON r.id=pr.role_id WHERE pr.organization_id=$1 ORDER BY r.code`,
        [org],
      )
    ).rows;
    for (const p of positions)
      p.roles = roles
        .filter((r) => r.position_id === p.id)
        .map(({ id, code, name, scope, kind }) => ({ id, code, name, scope, kind }));
    return positions;
  }
  app.get(positionBase, async (req) => {
    await authorize(req, 'user:view');
    return listPositions(pool);
  });
  for (const method of ['post', 'patch'])
    app[method](positionBase + (method === 'patch' ? '/:id' : ''), async (req, reply) => {
      const editing = method === 'patch';
      const id = editing ? v.uuid(req.params.id) : null;
      const body = req.body ?? {};
      const input = {
        code: v.code(body.code, '职位编码'),
        name: v.text(body.name, '职位名称', 60),
        description: v.text(body.description, '说明', 300, { optional: true }),
        status: v.choice(body.status, ['active', 'inactive'], '职位状态', 'active'),
        roles: v.uuids(body.roleIds ?? [], '默认角色'),
      };
      const result = await write(
        req,
        'position:manage',
        editing ? 'access.position.update' : 'access.position.create',
        'position',
        async (db) => {
          const known = await listRoles(db, org);
          if (input.roles.some((r) => !known.some((k) => k.id === r)))
            throw failure(400, '默认角色不存在。');
          let positionId = id;
          if (editing) {
            const { rowCount } = await db.query(
              `UPDATE app.access_position SET code=$3,name=$4,description=$5,status=$6,row_version=row_version+1,updated_at=now()
              WHERE organization_id=$1 AND id=$2 AND row_version=$7`,
              [
                org,
                id,
                input.code,
                input.name,
                input.description,
                input.status,
                v.version(body.rowVersion),
              ],
            );
            if (!rowCount) throw failure(409, '职位已被其他操作更新，请刷新后重试。');
            await db.query('DELETE FROM app.access_position_role WHERE position_id=$1', [id]);
          } else
            positionId = (
              await db.query(
                `INSERT INTO app.access_position(organization_id,code,name,description,status) VALUES($1,$2,$3,$4,$5) RETURNING id`,
                [org, input.code, input.name, input.description, input.status],
              )
            ).rows[0].id;
          await db.query(
            `INSERT INTO app.access_position_role(organization_id,position_id,role_id) SELECT $1,$2,unnest($3::uuid[])`,
            [org, positionId, input.roles],
          );
          return {
            subjectId: positionId,
            data: (await listPositions(db)).find((p) => p.id === positionId),
            details: { code: input.code, roles: input.roles },
          };
        },
      );
      if (!editing) reply.code(201);
      return result;
    });
  app.delete(positionBase + '/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion);
    return write(req, 'position:manage', 'access.position.delete', 'position', async (db) => {
      const position = (await listPositions(db)).find((p) => p.id === id);
      if (!position) throw failure(404, '职位不存在。');
      if (position.userCount)
        throw failure(409, '仍有用户担任该职位，请先为他们更换职位，或改为停用。');
      const { rowCount } = await db.query(
        'DELETE FROM app.access_position WHERE organization_id=$1 AND id=$2 AND row_version=$3',
        [org, id, revision],
      );
      if (!rowCount) throw failure(409, '职位已被其他操作更新，请刷新后重试。');
      return { subjectId: id, data: { ok: true }, details: { code: position.code } };
    });
  });
}
