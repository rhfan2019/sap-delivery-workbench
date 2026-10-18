import { syncBuiltInRoles } from '../../apps/api/src/modules/access/builtin.mjs';

// Contract 3.5 for tests: grant a built-in role by code. With `projectId` the user becomes an
// active project member holding the project role; otherwise the role is assigned
// organization-wide with a project scope (all projects by default).
export async function grantRole(
  db,
  organizationId,
  userId,
  code,
  {
    projectId,
    projectScope = 'all',
    scopeIds = [],
    modules = [],
    ownOnly = false,
    validTo = null,
  } = {},
) {
  const ids = await syncBuiltInRoles(db, organizationId);
  const roleId = ids.get(code);
  if (!roleId) throw new Error('Unknown built-in role ' + code);
  if (projectId) {
    await db.query(
      `INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)
      ON CONFLICT(organization_id,project_id,user_id) DO UPDATE SET status='active'`,
      [organizationId, projectId, userId],
    );
    await db.query(
      `INSERT INTO app.access_project_role(organization_id,project_id,user_id,role_id,modules,own_only,valid_to)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(project_id,user_id,role_id) DO UPDATE SET modules=EXCLUDED.modules,
      own_only=EXCLUDED.own_only,valid_to=EXCLUDED.valid_to`,
      [organizationId, projectId, userId, roleId, modules, ownOnly, validTo],
    );
  } else
    await db.query(
      `INSERT INTO app.access_assignment(organization_id,user_id,role_id,project_scope,scope_ids,valid_to)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,user_id,role_id) DO UPDATE SET
      project_scope=EXCLUDED.project_scope,scope_ids=EXCLUDED.scope_ids,valid_to=EXCLUDED.valid_to`,
      [organizationId, userId, roleId, projectScope, scopeIds, validTo],
    );
  return roleId;
}

// Removes test organizations and accounts with everything that hangs off them, children
// first (the business tables use RESTRICT foreign keys on purpose).
export async function dropOrganizations(db, organizationIds, userIds = []) {
  const orgs = [organizationIds].flat();
  const scoped = [
    'sap_user_credential',
    'project_sap_system',
    'sap_credential_policy',
    'access_project_role',
    'access_assignment',
    'access_position_role',
    'access_role_composition',
    'access_role_permission',
    'project_health',
    'project_contact',
    'project_module_lead',
    'project_milestone',
    'project_phase',
    'project_preference',
  ];
  await db.query('UPDATE app.app_user SET position_id=NULL WHERE id=ANY($1::uuid[])', [userIds]);
  for (const table of scoped)
    await db.query(`DELETE FROM app.${table} WHERE organization_id=ANY($1::uuid[])`, [orgs]);
  await db.query(
    'UPDATE app.app_user SET position_id=NULL WHERE position_id IN (SELECT id FROM app.access_position WHERE organization_id=ANY($1::uuid[]))',
    [orgs],
  );
  for (const table of ['access_position', 'access_role'])
    await db.query(`DELETE FROM app.${table} WHERE organization_id=ANY($1::uuid[])`, [orgs]);
  await db.query('DELETE FROM app.auth_session WHERE organization_id=ANY($1::uuid[])', [orgs]);
  await db.query('DELETE FROM app.project_member WHERE organization_id=ANY($1::uuid[])', [orgs]);
  await db.query(
    'UPDATE app.project SET manager_id=NULL,director_id=NULL,architect_id=NULL,dev_lead_id=NULL,basis_lead_id=NULL WHERE organization_id=ANY($1::uuid[])',
    [orgs],
  );
  await db.query('DELETE FROM app.project WHERE organization_id=ANY($1::uuid[])', [orgs]);
  await db.query('DELETE FROM app.customer WHERE organization_id=ANY($1::uuid[])', [orgs]);
  await db.query('DELETE FROM app.organization_member WHERE organization_id=ANY($1::uuid[])', [
    orgs,
  ]);
  await db.query('DELETE FROM app.user_password WHERE user_id=ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM app.app_user WHERE id=ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM app.audit_event WHERE organization_id=ANY($1::uuid[])', [orgs]);
  await db.query('DELETE FROM app.organization WHERE id=ANY($1::uuid[])', [orgs]);
}
