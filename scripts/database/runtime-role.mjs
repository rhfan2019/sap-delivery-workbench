// The application's restricted role. Only provisioning gives it a login and a password.
export async function ensureRuntimeRole(client) {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [
    'sap_workbench_app',
  ]);
  if (!exists.rowCount) await client.query('CREATE ROLE sap_workbench_app NOLOGIN');
}
