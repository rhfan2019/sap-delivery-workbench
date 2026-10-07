import { connectDatabase } from './lib/database.mjs';
import { audit } from '../apps/api/src/auth.mjs';

// Explicit deployment operation; never run automatically on application startup.
const [name, login] = process.argv.slice(2);
if (!name || name.length > 200 || !login)
  throw new Error('Usage: configure-organization.mjs <organization-name> <existing-admin-login>');
const org = process.env.DEFAULT_ORGANIZATION_ID;
if (!org) throw new Error('DEFAULT_ORGANIZATION_ID is required.');
const db = await connectDatabase();
try {
  await db.query('BEGIN');
  const user = (
    await db.query(
      `SELECT u.id FROM app.app_user u JOIN app.organization_member m ON m.user_id=u.id WHERE m.organization_id=$1 AND u.login_name=$2 AND u.status='active' AND m.status='active'`,
      [org, login],
    )
  ).rows[0];
  if (!user)
    throw new Error('The named account is not an active member of the default organization.');
  await db.query(
    'UPDATE app.organization SET name=$2,row_version=row_version+1,updated_at=now() WHERE id=$1 AND name<>$2',
    [org, name],
  );
  await db.query(
    "UPDATE app.organization_member SET access_level='admin',row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND access_level<>'admin'",
    [org, user.id],
  );
  await audit(db, 'deployment.configure_organization', 'success', org, user.id);
  await db.query('COMMIT');
  console.log(
    'Default organization name and designated administrator configured; IDs, passwords and memberships preserved.',
  );
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
