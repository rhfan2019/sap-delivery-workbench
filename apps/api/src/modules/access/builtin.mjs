import { randomUUID } from 'node:crypto';
import {
  BUILT_IN_POSITIONS,
  BUILT_IN_ROLES,
  PERMISSION_CODES,
} from '@sap-delivery-workbench/contracts/access/catalog';

// Built-in roles follow the catalog: names, permissions and members are rewritten on every
// start, so a catalog change reaches every organization (the super administrator always holds
// every permission). Permissions the catalog no longer has are removed from custom roles too.
// Built-in positions are created once and are ordinary data afterwards.
// Runs inside the caller's transaction.
export async function syncBuiltInRoles(db, organizationId) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'access-sync:' + organizationId,
  ]);
  const ids = new Map();
  for (const role of BUILT_IN_ROLES) {
    const { rows } = await db.query(
      `INSERT INTO app.access_role(organization_id,code,name,description,kind,scope,built_in)
       VALUES($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,
         description=EXCLUDED.description,kind=EXCLUDED.kind,scope=EXCLUDED.scope,built_in=true,
         status='active',
         row_version=CASE WHEN (app.access_role.name,app.access_role.description,app.access_role.status)
           IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.description,'active')
           THEN app.access_role.row_version+1 ELSE app.access_role.row_version END
       RETURNING id`,
      [organizationId, role.code, role.name, role.description, role.kind, role.scope],
    );
    ids.set(role.code, rows[0].id);
  }
  for (const role of BUILT_IN_ROLES) {
    const id = ids.get(role.code);
    if (role.kind === 'single') {
      await db.query(
        'DELETE FROM app.access_role_permission WHERE role_id=$1 AND NOT permission=ANY($2)',
        [id, role.permissions],
      );
      await db.query(
        `INSERT INTO app.access_role_permission(organization_id,role_id,permission)
         SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`,
        [organizationId, id, role.permissions],
      );
    } else {
      const members = role.members.map((code) => ids.get(code));
      await db.query(
        'DELETE FROM app.access_role_composition WHERE composite_id=$1 AND NOT member_id=ANY($2)',
        [id, members],
      );
      await db.query(
        `INSERT INTO app.access_role_composition(organization_id,composite_id,member_id)
         SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING`,
        [organizationId, id, members],
      );
    }
  }
  const retired = await db.query(
    'DELETE FROM app.access_role_permission WHERE organization_id=$1 AND NOT permission=ANY($2) RETURNING role_id,permission',
    [organizationId, PERMISSION_CODES],
  );
  if (retired.rowCount)
    await db.query(
      `INSERT INTO app.audit_event(organization_id,action,outcome,subject_type,request_id,details)
       VALUES($1,'access.permission.retire','success','role',$2,$3)`,
      [
        organizationId,
        randomUUID(),
        JSON.stringify({ removed: retired.rows.map((r) => r.permission) }),
      ],
    );
  for (const position of BUILT_IN_POSITIONS) {
    const { rows } = await db.query(
      `INSERT INTO app.access_position(organization_id,code,name) VALUES($1,$2,$3)
       ON CONFLICT(organization_id,code) DO NOTHING RETURNING id`,
      [organizationId, position.code, position.name],
    );
    if (!rows[0]) continue;
    const roles = [...position.organizationRoles, ...position.projectRoles].map((c) => ids.get(c));
    await db.query(
      `INSERT INTO app.access_position_role(organization_id,position_id,role_id)
       SELECT $1,$2,unnest($3::uuid[])`,
      [organizationId, rows[0].id, roles],
    );
  }
  return ids;
}

// Deployment operations (bootstrap, configure-organization): make an account a super
// administrator of all projects. Idempotent; runs inside the caller's transaction.
export async function grantSuperAdmin(db, organizationId, userId) {
  const ids = await syncBuiltInRoles(db, organizationId);
  await db.query(
    `INSERT INTO app.access_assignment(organization_id,user_id,role_id,project_scope)
    VALUES($1,$2,$3,'all') ON CONFLICT(organization_id,user_id,role_id)
    DO UPDATE SET project_scope='all',scope_ids='{}',valid_to=NULL,
      valid_from=LEAST(app.access_assignment.valid_from,current_date),
      row_version=app.access_assignment.row_version+1,updated_at=now()`,
    [organizationId, userId, ids.get('SYS_SUPER_ADMIN')],
  );
}
