import { connectDatabase, databaseConfig } from './lib/database.mjs';

const role = 'sap_workbench_app';
if (process.env.APP_DB_USER !== role) throw new Error('APP_DB_USER must be sap_workbench_app.');
const runtime = databaseConfig({ runtime: true });
if (runtime.password.length < 32)
  throw new Error('Use a generated runtime password of at least 32 characters.');
const client = await connectDatabase();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('sap-workbench-provision'))");
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
  if (!exists.rowCount) await client.query('CREATE ROLE sap_workbench_app NOLOGIN');
  await client.query(
    'ALTER ROLE sap_workbench_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ' +
      client.escapeLiteral(runtime.password),
  );
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(
    'REVOKE ALL ON DATABASE ' + client.escapeIdentifier(runtime.database) + ' FROM PUBLIC',
  );
  await client.query(
    'GRANT CONNECT ON DATABASE ' +
      client.escapeIdentifier(runtime.database) +
      ' TO sap_workbench_app',
  );
  await client.query('GRANT USAGE ON SCHEMA app TO sap_workbench_app');
  await client.query(
    'GRANT SELECT, INSERT, UPDATE ON app.organization, app.app_user, app.user_password, app.organization_member, app.customer, app.project, app.project_member, app.auth_session, app.login_throttle TO sap_workbench_app',
  );
  await client.query('GRANT DELETE ON app.auth_session, app.login_throttle TO sap_workbench_app');
  await client.query('REVOKE ALL ON app.audit_event FROM sap_workbench_app');
  await client.query('GRANT INSERT ON app.audit_event TO sap_workbench_app');
  const delivery = await client.query("SELECT to_regclass('app.development_item') AS name");
  if (delivery.rows[0].name) {
    await client.query(
      'GRANT SELECT,INSERT,UPDATE ON app.development_item,app.fs_draft,app.project_preference TO sap_workbench_app',
    );
    await client.query(
      'GRANT SELECT,INSERT ON app.fs_version,app.development_event,app.development_file TO sap_workbench_app',
    );
  }
  await client.query('REVOKE ALL ON public.pgmigrations FROM sap_workbench_app');
  if ((await client.query("SELECT to_regclass('app.sap_system') AS name")).rows[0].name) {
    await client.query(
      'GRANT SELECT,INSERT,UPDATE ON app.sap_system,app.sap_system_grant,app.project_sap_config,app.user_project_sap_config TO sap_workbench_app',
    );
  }
  if ((await client.query("SELECT to_regclass('app.llm_model') AS name")).rows[0].name) {
    await client.query(
      'GRANT SELECT,INSERT,UPDATE ON app.llm_model,app.llm_default,app.llm_test_run TO sap_workbench_app',
    );
    await client.query(
      'GRANT SELECT,INSERT ON app.llm_model_version,app.llm_credential TO sap_workbench_app',
    );
  }
  if ((await client.query("SELECT to_regclass('app.fs_workspace') AS name")).rows[0].name) {
    await client.query(
      'GRANT SELECT,INSERT,UPDATE ON app.fs_workspace,app.fs_session,app.fs_attachment,app.fs_entity,app.fs_run,app.fs_review_request,app.fs_project_role,app.fs_export TO sap_workbench_app',
    );
    await client.query(
      'GRANT SELECT,INSERT ON app.fs_template_version,app.fs_document_revision,app.fs_message,app.fs_parse_result,app.fs_evidence,app.fs_entity_revision,app.fs_dependency,app.fs_context_snapshot,app.fs_confirmation,app.fs_run_checkpoint,app.fs_run_event,app.fs_command_receipt,app.fs_review,app.fs_approval,app.fs_publication,app.fs_change_set TO sap_workbench_app',
    );
    await client.query(
      'GRANT UPDATE(status,result_revision_id) ON app.fs_change_set TO sap_workbench_app',
    );
    await client.query(
      'GRANT SELECT,INSERT ON app.fs_project_command_receipt TO sap_workbench_app',
    );
  }
  await client.query('COMMIT');
  console.log('Provisioned sap_workbench_app with limited runtime grants. No password printed.');
} catch (error) {
  await client.query('ROLLBACK');
  // Do not print a server error that could include a credential-bearing statement.
  console.error('Runtime provisioning failed; PostgreSQL error code: ' + (error.code ?? 'unknown'));
  process.exitCode = 1;
} finally {
  await client.end();
}
