import { randomUUID, randomBytes } from 'node:crypto';
import { connectDatabase } from '../../apps/api/src/platform/database.mjs';
import { assertIsolatedDatabase } from '../../scripts/testing/run-tests.mjs';

export async function transaction(run) {
  assertIsolatedDatabase(process.env);
  const db = await connectDatabase();
  try {
    await db.query('BEGIN');
    return await run(db);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
}

export async function fixture(db) {
  const scope = Object.fromEntries(
    ['organizationId', 'projectId', 'actorId', 'itemId', 'customerId', 'sessionId'].map((k) => [
      k,
      randomUUID(),
    ]),
  );
  const { organizationId: o, projectId: p, actorId: u, itemId: i, customerId: c } = scope;
  await db.query('INSERT INTO app.organization(id,code,name) VALUES($1,$2,$2)', [
    o,
    'F' + o.slice(0, 8).toUpperCase(),
  ]);
  await db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$2)', [
    u,
    'fs-' + u,
  ]);
  await db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
    o,
    u,
  ]);
  await db.query("INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$2,'C','C')", [
    c,
    o,
  ]);
  await db.query(
    "INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$2,$3,'P','P')",
    [p, o, c],
  );
  await db.query(
    'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
    [o, p, u],
  );
  await db.query(
    "INSERT INTO app.auth_session(id,organization_id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes',now()+interval '8 hours')",
    [scope.sessionId, o, u, randomBytes(32)],
  );
  await db.query(
    "INSERT INTO app.development_item(id,organization_id,project_id,item_no,name,module,kind,created_by) VALUES($1,$2,$3,1,'Item','FICO','report',$4)",
    [i, o, p, u],
  );
  for (const phase of ['fsd', 'development', 'consultant_test', 'user_test'])
    await db.query(
      'INSERT INTO app.development_item_phase(organization_id,project_id,item_id,phase) VALUES($1,$2,$3,$4)',
      [o, p, i, phase],
    );
  return scope;
}

export async function violation(db, action, code) {
  await db.query('SAVEPOINT check_violation');
  try {
    const { default: assert } = await import('node:assert/strict');
    await assert.rejects(action, (error) => error.code === code);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT check_violation');
  }
}
