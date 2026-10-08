import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { connectDatabase } from '@sap-delivery-workbench/api/platform/database';
import { hashPassword } from '@sap-delivery-workbench/api/platform/password';
import { audit } from '@sap-delivery-workbench/api/platform/auth';
import { join, isAbsolute } from 'node:path';

const production = process.env.NODE_ENV === 'production';
const outputDir = production ? process.env.BOOTSTRAP_OUTPUT_DIR : '.runtime';
if (production && (!outputDir || !isAbsolute(outputDir)))
  throw new Error(
    'Production requires absolute BOOTSTRAP_OUTPUT_DIR for private credential handoff.',
  );

const db = await connectDatabase();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('sapwb-bootstrap'))");
  let org;
  if (process.env.DEFAULT_ORGANIZATION_ID) {
    org = (
      await db.query('SELECT id,name FROM app.organization WHERE id=$1', [
        process.env.DEFAULT_ORGANIZATION_ID,
      ])
    ).rows[0];
    if (!org) throw new Error('Configured organization does not exist.');
  } else {
    const existing = (await db.query('SELECT id,name FROM app.organization')).rows;
    if (existing.length > 1)
      throw new Error(
        'Multiple organizations exist; configure DEFAULT_ORGANIZATION_ID explicitly.',
      );
    org =
      existing[0] ??
      (
        await db.query(
          "INSERT INTO app.organization(code,name) VALUES('INSPIRE','Inspire') RETURNING id,name",
        )
      ).rows[0];
  }
  const count = (await db.query('SELECT count(*) FROM app.app_user')).rows[0].count;
  if (Number(count) > 0) {
    const available = await db.query(
      `SELECT 1 FROM app.app_user u JOIN app.user_password p ON p.user_id=u.id
      JOIN app.organization_member m ON m.user_id=u.id JOIN app.organization o ON o.id=m.organization_id
      WHERE o.id=$1 AND o.status='active' AND u.status='active' AND m.status='active' LIMIT 1`,
      [org.id],
    );
    if (!available.rows.length)
      throw new Error(
        'Configured organization has no active local account. Restore membership using a controlled deployment operation. Existing passwords are preserved.',
      );
  }
  let password;
  if (Number(count) === 0) {
    password = randomBytes(18).toString('base64url');
    const user = (
      await db.query(
        "INSERT INTO app.app_user(login_name,display_name) VALUES('admin','工作台管理员') RETURNING id",
      )
    ).rows[0];
    await db.query('INSERT INTO app.user_password(user_id,password_hash) VALUES($1,$2)', [
      user.id,
      await hashPassword(password),
    ]);
    await db.query(
      "INSERT INTO app.organization_member(organization_id,user_id,access_level) VALUES($1,$2,'admin')",
      [org.id, user.id],
    );
    await audit(db, 'deployment.bootstrap', 'success', org.id, user.id);
  }
  // Persist the recovery handoff before commit; do not print credentials in logs.
  if (password) {
    mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(outputDir, 'initial-login.txt'),
      `工作台登录\n地址：${process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173'}\n账号：admin\n临时密码：${password}\n首次登录必须修改密码；修改后此临时密码失效。\n`,
      { mode: 0o600 },
    );
  }
  await db.query('COMMIT');
  if (production) {
    mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(outputDir, 'organization.env'), `DEFAULT_ORGANIZATION_ID=${org.id}\n`, {
      mode: 0o600,
    });
  } else if (!process.env.DEFAULT_ORGANIZATION_ID)
    appendFileSync('.env', `\nDEFAULT_ORGANIZATION_ID=${org.id}\n`);
  console.log(
    password
      ? 'Initialized organization and account. Credentials saved in private bootstrap output directory (first login requires password change).'
      : 'Existing accounts preserved; passwords and memberships unchanged.',
  );
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
