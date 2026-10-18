import { randomBytes } from 'node:crypto';
import { failure } from '../../platform/auth.mjs';
import { hashPassword } from '../../platform/password.mjs';
import { describeUsers, keepsSuperAdmin, saveProfile } from '../access/public.mjs';
import { changed } from './context.mjs';
import * as v from './validation.mjs';

// Accounts of the organization. Position, person type, skill modules and roles belong to the
// access module; this module stores the account and asks access for the rest.
const userColumns = `u.id,u.login_name AS "loginName",u.display_name AS "displayName",u.email,u.status,
  u.row_version AS "rowVersion",u.last_login_at AS "lastLoginAt",u.created_at AS "createdAt",m.joined_at AS "joinedAt",
  (SELECT count(*)::int FROM app.project_member pm WHERE pm.organization_id=m.organization_id AND pm.user_id=u.id AND pm.status='active') AS "projectCount"`;

export function userRoutes(app, ctx) {
  const { pool, organizationId: org, authorize, write } = ctx;
  async function load(db, ids) {
    const { rows } = await db.query(
      `SELECT ${userColumns} FROM app.app_user u JOIN app.organization_member m ON m.user_id=u.id
      WHERE m.organization_id=$1 ${ids ? 'AND u.id=ANY($2)' : ''} ORDER BY u.display_name,u.id`,
      ids ? [org, ids] : [org],
    );
    const profiles = await describeUsers(
      db,
      org,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, ...profiles.get(r.id) }));
  }
  const one = async (db, id) => {
    const [user] = await load(db, [id]);
    if (!user) throw failure(404, '用户不存在或不属于当前企业。');
    return user;
  };
  async function singleOrganization(db, id) {
    const { rows } = await db.query(
      'SELECT 1 FROM app.organization_member WHERE user_id=$1 AND organization_id<>$2 LIMIT 1',
      [id, org],
    );
    if (rows[0]) throw failure(409, '该账号关联多个组织，请由部署管理员维护全局账号资料。');
  }

  app.get('/api/admin/users', async (req) => {
    await authorize(req, 'user:view');
    return load(pool);
  });
  app.get('/api/admin/users/:id', async (req) => {
    await authorize(req, 'user:view');
    return one(pool, v.uuid(req.params.id));
  });
  app.post('/api/admin/users', async (req, reply) => {
    const login = v.text(req.body?.loginName, '登录账号', 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login))
      throw failure(400, '账号须为 3–64 位英文字母、数字、点、下划线或连字符。');
    const name = v.text(req.body.displayName, '姓名', 100),
      email = v.email(req.body.email);
    const temporaryPassword = randomBytes(18).toString('base64url'),
      hash = await hashPassword(temporaryPassword);
    const result = await write(
      req,
      'user:manage',
      'admin.user.create',
      'user',
      async (db, current) => {
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
        await db.query(
          'INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)',
          [org, user.id],
        );
        const profile = await saveProfile(ctx, db, current, user.id, req.body);
        return {
          subjectId: user.id,
          data: { user: await one(db, user.id), temporaryPassword, granted: profile.granted },
          details: { positionId: profile.positionId, granted: profile.granted },
        };
      },
    );
    reply.code(201);
    return result;
  });
  app.patch('/api/admin/users/:id', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion),
      name = v.text(req.body?.displayName, '姓名', 100),
      email = v.email(req.body?.email),
      status = v.choice(req.body?.status, ['active', 'disabled'], '账号状态');
    return write(req, 'user:manage', 'admin.user.update', 'user', async (db, current) => {
      const user = await one(db, id);
      await singleOrganization(db, id);
      if (status === 'disabled' && user.status === 'active') {
        if (id === current.user.id) throw failure(400, '不能停用当前登录的账号。');
        await keepsSuperAdmin(db, org, { userId: id });
      }
      await db.query('SELECT id FROM app.app_user WHERE id=$1 FOR UPDATE', [id]);
      changed(
        await db.query(
          'UPDATE app.app_user SET display_name=$2,email=$3,status=$4,row_version=row_version+1,updated_at=now() WHERE id=$1 AND row_version=$5 RETURNING id',
          [id, name, email, status, revision],
        ),
      );
      const profile = await saveProfile(ctx, db, current, id, req.body);
      if (status === 'disabled')
        await db.query(
          'UPDATE app.auth_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
          [id],
        );
      return {
        subjectId: id,
        data: { user: await one(db, id), granted: profile.granted },
        details: { status, positionId: profile.positionId, granted: profile.granted },
      };
    });
  });
  app.post('/api/admin/users/:id/reset-password', async (req) => {
    const id = v.uuid(req.params.id),
      revision = v.version(req.body?.rowVersion);
    const temporaryPassword = randomBytes(18).toString('base64url'),
      hash = await hashPassword(temporaryPassword);
    return write(
      req,
      'user.password:reset',
      'admin.user.reset_password',
      'user',
      async (db, current) => {
        if (id === current.user.id) throw failure(400, '请在个人资料中修改自己的密码。');
        await one(db, id);
        await singleOrganization(db, id);
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
      },
    );
  });

  // The signed-in user's own account (the personal profile page).
  app.get('/api/me', async (req) => {
    const current = await authorize(req);
    return one(pool, current.user.id);
  });
  app.patch('/api/me', async (req) => {
    const name = v.text(req.body?.displayName, '姓名', 100),
      email = v.email(req.body?.email),
      revision = v.version(req.body?.rowVersion);
    return write(req, null, 'user.profile.update', 'user', async (db, current) => {
      changed(
        await db.query(
          'UPDATE app.app_user SET display_name=$2,email=$3,row_version=row_version+1,updated_at=now() WHERE id=$1 AND row_version=$4 RETURNING id',
          [current.user.id, name, email, revision],
        ),
      );
      return { subjectId: current.user.id, data: await one(db, current.user.id) };
    });
  });
}
