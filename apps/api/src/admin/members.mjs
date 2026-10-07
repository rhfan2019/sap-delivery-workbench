import { randomBytes } from 'node:crypto';
import { failure } from '../auth.mjs';
import { hashPassword } from '../password.mjs';
import { changed, found } from './context.mjs';
import * as v from './validation.mjs';

const userColumns = `u.id,u.login_name AS "loginName",u.display_name AS "displayName",u.email,u.status,
  u.row_version AS "rowVersion",u.last_login_at AS "lastLoginAt",m.status AS "memberStatus",
  m.access_level AS "accessLevel",m.row_version AS "memberVersion",m.joined_at AS "joinedAt"`;
async function target(db, org, id) {
  return found(
    await db.query(
      `SELECT ${userColumns} FROM app.app_user u JOIN app.organization_member m ON m.user_id=u.id WHERE m.organization_id=$1 AND u.id=$2`,
      [org, id],
    ),
    '用户',
  );
}
async function localAccount(db, org, id) {
  const { rows } = await db.query(
    'SELECT 1 FROM app.organization_member WHERE user_id=$1 AND organization_id<>$2 LIMIT 1',
    [id, org],
  );
  if (rows[0]) throw failure(409, '该账号关联多个组织，请由部署管理员维护全局账号资料。');
}
async function protectAdmin(db, org, user, current, disabling) {
  if (!disabling) return;
  if (user.id === current.user.id) throw failure(400, '不能停用、移出或降级当前登录的管理员。');
  if (user.accessLevel === 'admin' && user.memberStatus === 'active' && user.status === 'active') {
    const { rows } = await db.query(
      `SELECT count(*) FROM app.organization_member m JOIN app.app_user u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.access_level='admin' AND m.status='active' AND u.status='active'`,
      [org],
    );
    if (Number(rows[0].count) <= 1) throw failure(409, '必须保留至少一位有效企业管理员。');
  }
}
export function memberRoutes(app, ctx) {
  const { pool, organizationId: org, authorize, write } = ctx;
  app.get('/api/admin/users', async (req) => {
    await authorize(req);
    return (
      await pool.query(
        `SELECT ${userColumns},(SELECT count(*)::int FROM app.project_member pm WHERE pm.organization_id=m.organization_id AND pm.user_id=u.id AND pm.status='active') AS "projectCount" FROM app.app_user u JOIN app.organization_member m ON m.user_id=u.id WHERE m.organization_id=$1 ORDER BY u.created_at,u.id`,
        [org],
      )
    ).rows;
  });
  app.post('/api/admin/users', async (req, reply) => {
    await authorize(req);
    const login = v.text(req.body?.loginName, '登录账号', 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login))
      throw failure(400, '账号须为 3–64 位英文字母、数字、点、下划线或连字符。');
    const name = v.text(req.body.displayName, '姓名', 100),
      email = v.email(req.body.email);
    const temporaryPassword = randomBytes(18).toString('base64url'),
      hash = await hashPassword(temporaryPassword);
    const result = await write(req, 'admin.user.create', 'user', async (db) => {
      const user = changed(
        await db.query(
          'INSERT INTO app.app_user(login_name,display_name,email) VALUES($1,$2,$3) RETURNING id',
          [login, name, email],
        ),
      );
      await db.query('INSERT INTO app.user_password(user_id,password_hash) VALUES($1,$2)', [
        user.id,
        hash,
      ]);
      await db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
        org,
        user.id,
      ]);
      return {
        subjectId: user.id,
        data: { user: await target(db, org, user.id), temporaryPassword },
      };
    });
    reply.code(201);
    return result;
  });
  app.patch('/api/admin/users/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion),
      name = v.text(req.body?.displayName, '姓名', 100),
      email = v.email(req.body?.email),
      status = v.choice(req.body?.status, ['active', 'disabled'], '账号状态');
    return write(req, 'admin.user.update', 'user', async (db, current) => {
      const user = await target(db, org, id);
      await localAccount(db, org, id);
      await protectAdmin(db, org, user, current, status === 'disabled');
      await db.query('SELECT id FROM app.app_user WHERE id=$1 FOR UPDATE', [id]);
      changed(
        await db.query(
          'UPDATE app.app_user SET display_name=$2,email=$3,status=$4,row_version=row_version+1,updated_at=now() WHERE id=$1 AND row_version=$5 RETURNING id',
          [id, name, email, status, revision],
        ),
      );
      if (status === 'disabled')
        await db.query(
          'UPDATE app.auth_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
          [id],
        );
      return { subjectId: id, data: await target(db, org, id) };
    });
  });
  app.post('/api/admin/users/:id/reset-password', async (req) => {
    await authorize(req);
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion);
    const temporaryPassword = randomBytes(18).toString('base64url'),
      hash = await hashPassword(temporaryPassword);
    return write(req, 'admin.user.reset_password', 'user', async (db, current) => {
      if (id === current.user.id) throw failure(400, '请在个人设置中修改自己的密码。');
      await target(db, org, id);
      await localAccount(db, org, id);
      await db.query('SELECT id FROM app.app_user WHERE id=$1 FOR UPDATE', [id]);
      changed(
        await db.query(
          'UPDATE app.app_user SET row_version=row_version+1,updated_at=now() WHERE id=$1 AND row_version=$2 RETURNING id',
          [id, revision],
        ),
      );
      await db.query(
        'UPDATE app.user_password SET password_hash=$2,must_change_password=true,changed_at=now(),row_version=row_version+1 WHERE user_id=$1',
        [id, hash],
      );
      await db.query(
        'UPDATE app.auth_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [id],
      );
      return { subjectId: id, data: { temporaryPassword } };
    });
  });
  app.patch('/api/admin/members/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion),
      status = v.choice(req.body?.status, ['active', 'disabled'], '企业成员状态'),
      access = v.choice(req.body?.accessLevel, ['admin', 'member'], '管理身份');
    return write(req, 'admin.member.update', 'user', async (db, current) => {
      const user = await target(db, org, id);
      await protectAdmin(db, org, user, current, status === 'disabled' || access !== 'admin');
      if (status === 'active' && user.status !== 'active')
        throw failure(409, '请先启用该账号，再启用企业成员。');
      changed(
        await db.query(
          'UPDATE app.organization_member SET status=$3,access_level=$4,row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND row_version=$5 RETURNING user_id',
          [org, id, status, access, revision],
        ),
      );
      if (status === 'disabled') {
        await db.query(
          'UPDATE app.auth_session SET revoked_at=now() WHERE organization_id=$1 AND user_id=$2 AND revoked_at IS NULL',
          [org, id],
        );
        await db.query(
          "UPDATE app.project_member SET status='removed',row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND status='active'",
          [org, id],
        );
      }
      return { subjectId: id, data: await target(db, org, id) };
    });
  });
  async function project(db, id, editing = false) {
    const p = found(
      await db.query('SELECT id,status FROM app.project WHERE organization_id=$1 AND id=$2', [
        org,
        id,
      ]),
      '项目',
    );
    if (editing && p.status === 'archived') throw failure(409, '已归档项目只读，不能调整成员。');
    return p;
  }
  app.get('/api/admin/projects/:id/members', async (req) => {
    await authorize(req);
    const id = v.uuid(req.params.id);
    await project(pool, id);
    return (
      await pool.query(
        `SELECT u.id,u.display_name AS "displayName",u.login_name AS "loginName",u.status AS "accountStatus",m.status AS "organizationStatus",pm.status,pm.row_version AS "rowVersion",pm.joined_at AS "joinedAt" FROM app.project_member pm JOIN app.app_user u ON u.id=pm.user_id JOIN app.organization_member m ON m.user_id=pm.user_id AND m.organization_id=pm.organization_id WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.status='active' ORDER BY u.display_name,u.id`,
        [org, id],
      )
    ).rows;
  });
  app.post('/api/admin/projects/:id/members', async (req) => {
    const id = v.uuid(req.params.id),
      userId = v.uuid(req.body?.userId);
    return write(req, 'admin.project_member.add', 'project', async (db) => {
      await project(db, id, true);
      const user = await target(db, org, userId);
      if (user.status !== 'active' || user.memberStatus !== 'active')
        throw failure(409, '只能添加当前企业的有效成员。');
      await db.query(
        `INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)
        ON CONFLICT(organization_id,project_id,user_id) DO UPDATE SET status='active',row_version=app.project_member.row_version+1,updated_at=now() WHERE app.project_member.status='removed'`,
        [org, id, userId],
      );
      return { subjectId: id, data: { ok: true } };
    });
  });
  app.delete('/api/admin/projects/:id/members/:userId', async (req) => {
    const id = v.uuid(req.params.id),
      userId = v.uuid(req.params.userId),
      revision = v.version(req.body?.rowVersion);
    return write(req, 'admin.project_member.remove', 'project', async (db) => {
      await project(db, id, true);
      found(
        await db.query(
          'SELECT user_id FROM app.project_member WHERE organization_id=$1 AND project_id=$2 AND user_id=$3',
          [org, id, userId],
        ),
        '成员',
      );
      changed(
        await db.query(
          "UPDATE app.project_member SET status='removed',row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND row_version=$4 RETURNING user_id",
          [org, id, userId, revision],
        ),
      );
      return { subjectId: id, data: { ok: true } };
    });
  });
}
