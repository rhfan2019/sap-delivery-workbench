import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, validPassword } from './password.mjs';

export const digest = (value) => createHash('sha256').update(value).digest();
export const failure = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export async function transaction(pool, operation, { boundedSave = false } = {}) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (boundedSave) {
      // PostgreSQL 17: apply before any advisory or row lock, including COMMIT.
      await db.query("SET LOCAL lock_timeout = '5s'");
      await db.query("SET LOCAL statement_timeout = '10s'");
      await db.query("SET LOCAL transaction_timeout = '15s'");
    }
    const result = await operation(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function audit(db, action, outcome, org = null, user = null) {
  await db.query(
    'INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,request_id) VALUES($1,$2,$3,$4,$5)',
    [org, user, action, outcome, randomUUID()],
  );
}

export async function createAuth(pool, organizationId) {
  const dummy = await hashPassword(randomBytes(24).toString('hex'));
  async function throttle(login, ip) {
    return transaction(pool, async (db) => {
      let blocked = false;
      // Reserve attempts atomically before expensive hashing. Successful logins count too.
      for (const [scope, key, limit] of [
        ['ip', ip, 60],
        ['login_name', login, 10],
      ]) {
        const { rows } = await db.query(
          `INSERT INTO app.login_throttle(scope,key_hash,window_started_at,attempt_count,updated_at)
          VALUES($1,$2,clock_timestamp(),1,clock_timestamp()) ON CONFLICT(scope,key_hash) DO UPDATE SET
          attempt_count=CASE WHEN app.login_throttle.window_started_at < clock_timestamp()-interval '15 minutes' THEN 1 ELSE app.login_throttle.attempt_count+1 END,
          window_started_at=CASE WHEN app.login_throttle.window_started_at < clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE app.login_throttle.window_started_at END,
          updated_at=clock_timestamp() RETURNING attempt_count`,
          [scope, digest(key)],
        );
        blocked ||= rows[0].attempt_count > limit;
      }
      return blocked;
    });
  }
  async function login(loginName, password, ip) {
    const name = typeof loginName === 'string' ? loginName.trim().toLowerCase() : '';
    if (name.length > 64 || typeof password !== 'string' || password.length > 256)
      throw failure(400, '请输入有效的账号和密码。');
    if (await throttle(name, ip)) throw failure(429, '尝试次数过多，请在 15 分钟后重试。');
    const { rows } = await pool.query(
      'SELECT u.id,p.password_hash,p.row_version FROM app.app_user u JOIN app.user_password p ON p.user_id=u.id WHERE u.login_name=$1',
      [name],
    );
    const candidate = rows[0];
    const verified = await verifyPassword(candidate?.password_hash ?? dummy, password);
    const rejected = async () => {
      await audit(pool, 'auth.login', 'failure', organizationId, candidate?.id);
      throw failure(401, '账号或密码错误，或账号当前不可用。');
    };
    if (!candidate || !verified) return rejected();
    const result = await transaction(pool, async (db) => {
      const { rows: accounts } = await db.query(
        `SELECT u.id,u.display_name,u.login_name,p.must_change_password,p.row_version,p.password_hash,o.name AS organization_name,m.access_level
        FROM app.app_user u JOIN app.user_password p ON p.user_id=u.id
        JOIN app.organization_member m ON m.user_id=u.id JOIN app.organization o ON o.id=m.organization_id
        WHERE u.id=$1 AND o.id=$2 AND u.status='active' AND m.status='active' AND o.status='active'
        FOR UPDATE OF u,p,m,o`,
        [candidate.id, organizationId],
      );
      const account = accounts[0];
      if (
        !account ||
        account.row_version !== candidate.row_version ||
        account.password_hash !== candidate.password_hash
      )
        return null;
      const token = randomBytes(32).toString('hex');
      await db.query(
        `INSERT INTO app.auth_session(organization_id,user_id,token_hash,idle_expires_at,expires_at)
        VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours')`,
        [organizationId, account.id, digest(token)],
      );
      await db.query('UPDATE app.app_user SET last_login_at=now() WHERE id=$1', [account.id]);
      await audit(db, 'auth.login', 'success', organizationId, account.id);
      return { token, identity: identity(account) };
    });
    return result ?? rejected();
  }
  function identity(row) {
    return {
      user: { id: row.id, loginName: row.login_name, displayName: row.display_name },
      organization: { id: organizationId, name: row.organization_name },
      mustChangePassword: row.must_change_password,
      canManageOrganization: row.access_level === 'admin',
    };
  }
  async function session(token) {
    if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw failure(401, '请先登录。');
    const { rows } = await pool.query(
      `UPDATE app.auth_session s SET last_seen_at=clock_timestamp(),
      idle_expires_at=LEAST(clock_timestamp()+interval '30 minutes',s.expires_at)
      FROM app.app_user u,app.user_password p,app.organization_member m,app.organization o
      WHERE s.token_hash=$1 AND s.organization_id=$2 AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      AND u.id=s.user_id AND u.status='active' AND p.user_id=u.id
      AND m.user_id=u.id AND m.organization_id=s.organization_id AND m.status='active'
      AND o.id=s.organization_id AND o.status='active'
      RETURNING s.id AS session_id,u.id,u.login_name,u.display_name,p.must_change_password,o.name AS organization_name,m.access_level`,
      [digest(token), organizationId],
    );
    if (!rows[0]) throw failure(401, '登录已失效，请重新登录。');
    return { ...identity(rows[0]), sessionId: rows[0].session_id };
  }
  async function logout(token) {
    if (!/^[a-f0-9]{64}$/.test(token ?? '')) return;
    await transaction(pool, async (db) => {
      const { rows } = await db.query(
        'UPDATE app.auth_session SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING user_id,organization_id',
        [digest(token)],
      );
      if (rows[0])
        await audit(db, 'auth.logout', 'success', rows[0].organization_id, rows[0].user_id);
    });
  }
  async function changePassword(current, oldPassword, newPassword, ip) {
    if (!validPassword(newPassword)) throw failure(400, '新密码需要 12–128 个字符。');
    if (oldPassword === newPassword) throw failure(400, '新密码不能与原密码相同。');
    if (await throttle('password:' + current.user.id, ip))
      throw failure(429, '尝试次数过多，请稍后重试。');
    const { rows } = await pool.query(
      'SELECT password_hash,row_version FROM app.user_password WHERE user_id=$1',
      [current.user.id],
    );
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, oldPassword)))
      throw failure(400, '当前密码不正确。');
    const hash = await hashPassword(newPassword);
    await transaction(pool, async (db) => {
      await db.query('SELECT id FROM app.app_user WHERE id=$1 FOR UPDATE', [current.user.id]);
      const { rows: credentials } = await db.query(
        'SELECT row_version FROM app.user_password WHERE user_id=$1 FOR UPDATE',
        [current.user.id],
      );
      const { rows: sessions } = await db.query(
        `SELECT id FROM app.auth_session WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() AND idle_expires_at>now() FOR UPDATE`,
        [current.sessionId],
      );
      if (!sessions[0] || credentials[0]?.row_version !== rows[0].row_version)
        throw failure(401, '登录状态已变化，请重新登录。');
      await db.query(
        'UPDATE app.user_password SET password_hash=$2,must_change_password=false,changed_at=now(),row_version=row_version+1 WHERE user_id=$1',
        [current.user.id, hash],
      );
      await db.query(
        'UPDATE app.auth_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [current.user.id],
      );
      await audit(db, 'auth.password_change', 'success', organizationId, current.user.id);
    });
  }
  return { login, session, logout, changePassword };
}
