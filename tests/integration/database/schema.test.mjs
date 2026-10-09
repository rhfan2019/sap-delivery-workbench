import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { connectDatabase } from '../../../apps/api/src/platform/database.mjs';

const expectedTables = [
  'fsd_v1_task',
  'fsd_v1_run',
  'fsd_v1_request',
  'fsd_v1_event',
  'fsd_v1_commit',
  'fsd_v1_operation',
  'fsd_v1_attempt',
  'fsd_v1_attachment',
  'fsd_v1_chat_turn',
  'fsd_v1_chat_event',
  'app_user',
  'audit_event',
  'auth_session',
  'customer',
  'development_event',
  'development_file',
  'development_item',
  'fs_draft',
  'fs_version',
  'fs_workspace',
  'fs_template_version',
  'fs_document_revision',
  'fs_session',
  'fs_message',
  'fs_attachment',
  'fs_parse_result',
  'fs_evidence',
  'fs_entity',
  'fs_entity_revision',
  'fs_dependency',
  'fs_context_snapshot',
  'fs_confirmation',
  'fs_change_set',
  'fs_run',
  'fs_run_checkpoint',
  'fs_run_event',
  'fs_command_receipt',
  'fs_review',
  'fs_review_request',
  'fs_approval',
  'fs_project_role',
  'fs_project_command_receipt',
  'fs_export',
  'fs_publication',
  'fsd_agent_session',
  'fsd_agent_run',
  'fsd_agent_revision',
  'fsd_agent_attachment',
  'fsd_agent_workflow_event',
  'item_work_version',
  'gem_fsd_v2_run',
  'llm_credential',
  'llm_default',
  'llm_model',
  'llm_model_version',
  'llm_test_run',
  'login_throttle',
  'organization',
  'organization_member',
  'project',
  'project_member',
  'project_preference',
  'project_sap_config',
  'sap_system',
  'sap_system_grant',
  'user_password',
  'user_project_sap_config',
];

async function transaction(run, options) {
  const client = await connectDatabase(options);
  try {
    await client.query('BEGIN');
    return await run(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

async function fixture(client) {
  const org = randomUUID(),
    otherOrg = randomUUID(),
    user = randomUUID();
  const customer = randomUUID(),
    project = randomUUID();
  const suffix = randomBytes(8).toString('hex');
  await client.query(
    "INSERT INTO app.organization(id,code,name) VALUES ($1,$2,'Test org'),($3,$4,'Other org')",
    [org, 'T_' + suffix.toUpperCase(), otherOrg, 'O_' + suffix.toUpperCase()],
  );
  await client.query(
    "INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,'Test user')",
    [user, 'u_' + suffix],
  );
  await client.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
    org,
    user,
  ]);
  await client.query(
    "INSERT INTO app.customer(id,organization_id,code,name) VALUES($1,$2,'CUSTOMER','Test customer')",
    [customer, org],
  );
  await client.query(
    "INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$2,$3,'PROJECT','Test project')",
    [project, org, customer],
  );
  return { org, otherOrg, user, customer, project };
}

async function expectViolation(client, sql, parameters, code) {
  await client.query('SAVEPOINT constraint_check');
  await assert.rejects(client.query(sql, parameters), (error) => error.code === code);
  await client.query('ROLLBACK TO SAVEPOINT constraint_check');
  await client.query('RELEASE SAVEPOINT constraint_check');
}

test('exactly the designed business tables including FS workspace exist', () =>
  transaction(async (client) => {
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE' ORDER BY table_name",
    );
    assert.deepEqual(
      result.rows.map((row) => row.table_name),
      expectedTables.toSorted(),
    );
  }));

test('projects cannot reference a customer in another organization', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    await expectViolation(
      client,
      "INSERT INTO app.project(organization_id,customer_id,code,name) VALUES($1,$2,'BAD','Bad')",
      [f.otherOrg, f.customer],
      '23503',
    );
  }));

test('project members must belong to the same organization', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    await client.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [f.org, f.project, f.user],
    );
    await expectViolation(
      client,
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [f.otherOrg, f.project, f.user],
      '23503',
    );
    const outsider = randomUUID();
    await client.query(
      "INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,'Outsider')",
      [outsider, 'u_' + randomBytes(8).toString('hex')],
    );
    await expectViolation(
      client,
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [f.org, f.project, outsider],
      '23503',
    );
  }));

test('customer codes are unique per organization, not globally', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    await expectViolation(
      client,
      "INSERT INTO app.customer(organization_id,code,name) VALUES($1,'CUSTOMER','Duplicate')",
      [f.org],
      '23505',
    );
    await client.query(
      "INSERT INTO app.customer(organization_id,code,name) VALUES($1,'CUSTOMER','Allowed')",
      [f.otherOrg],
    );
  }));

test('only one self customer is allowed per organization', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    await client.query(
      "INSERT INTO app.customer(organization_id,code,name,customer_kind) VALUES($1,'SELF','Self','self')",
      [f.org],
    );
    await expectViolation(
      client,
      "INSERT INTO app.customer(organization_id,code,name,customer_kind) VALUES($1,'SELF2','Self2','self')",
      [f.org],
      '23505',
    );
  }));

test('project dates and archive state remain consistent', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    await expectViolation(
      client,
      "UPDATE app.project SET planned_start_date='2026-10-03', planned_end_date='2026-10-02' WHERE id=$1",
      [f.project],
      '23514',
    );
    await expectViolation(
      client,
      "UPDATE app.project SET status='archived' WHERE id=$1",
      [f.project],
      '23514',
    );
    await client.query(
      "UPDATE app.project SET status='archived', archived_at=CURRENT_TIMESTAMP WHERE id=$1",
      [f.project],
    );
    await expectViolation(
      client,
      'UPDATE app.project SET is_paused=true WHERE id=$1',
      [f.project],
      '23514',
    );
  }));

test('login names enforce canonical form and uniqueness', () =>
  transaction(async (client) => {
    const login = 'test_' + randomBytes(8).toString('hex');
    await client.query("INSERT INTO app.app_user(login_name,display_name) VALUES($1,'User')", [
      login,
    ]);
    await expectViolation(
      client,
      "INSERT INTO app.app_user(login_name,display_name) VALUES($1,'Duplicate')",
      [login],
      '23505',
    );
    await expectViolation(
      client,
      "INSERT INTO app.app_user(login_name,display_name) VALUES('UpperCase','Bad')",
      [],
      '23514',
    );
  }));

test('session digest and expiration constraints are enforced', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    const sql =
      "INSERT INTO app.auth_session(organization_id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP + INTERVAL '30 minutes',CURRENT_TIMESTAMP + INTERVAL '12 hours')";
    const digest = randomBytes(32);
    await client.query(sql, [f.org, f.user, digest]);
    await expectViolation(client, sql, [f.org, f.user, digest], '23505');
    await expectViolation(client, sql, [f.org, f.user, randomBytes(8)], '23514');
    await expectViolation(
      client,
      "UPDATE app.auth_session SET idle_expires_at = expires_at + INTERVAL '1 second' WHERE user_id=$1",
      [f.user],
      '23514',
    );
  }));

test('stale row versions cannot overwrite a prior update', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    const sql =
      'UPDATE app.project SET name=$1,row_version=row_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND row_version=$3';
    assert.equal((await client.query(sql, ['First', f.project, 1])).rowCount, 1);
    assert.equal((await client.query(sql, ['Stale', f.project, 1])).rowCount, 0);
  }));

test('referenced business records cannot be cascade-deleted', () =>
  transaction(async (client) => {
    const f = await fixture(client);
    await expectViolation(client, 'DELETE FROM app.customer WHERE id=$1', [f.customer], '23503');
  }));
