-- Up Migration
-- Contract 1.18 / docs/specs/project-access-admin.md section 1: what a project manager needs
-- to know about a project. Options live in packages/contracts/projects/options.mjs.
ALTER TABLE app.project DROP CONSTRAINT project_status_check;
ALTER TABLE app.project ADD CONSTRAINT project_status_check
 CHECK (status IN ('preparing', 'active', 'live', 'completed', 'archived'));
ALTER TABLE app.project DROP CONSTRAINT project_project_type_check;
ALTER TABLE app.project ADD CONSTRAINT project_project_type_check
 CHECK (project_type IN ('implementation', 'rollout', 'upgrade', 'conversion', 'enhancement',
  'support', 'migration', 'other'));

ALTER TABLE app.project
 ADD COLUMN short_name varchar(20) NOT NULL DEFAULT '',
 ADD COLUMN methodology varchar(16) NOT NULL DEFAULT 'activate'
  CHECK (methodology IN ('activate', 'asap', 'agile', 'hybrid')),
 ADD COLUMN contract_role varchar(16) NOT NULL DEFAULT 'prime'
  CHECK (contract_role IN ('prime', 'subcontract', 'direct')),
 ADD COLUMN prime_contractor varchar(200) NOT NULL DEFAULT '',
 ADD COLUMN sap_product varchar(20)
  CHECK (sap_product IN ('ecc', 's4_onpremise', 's4_private', 's4_public', 'bw4', 'other')),
 ADD COLUMN sap_release varchar(60) NOT NULL DEFAULT '',
 ADD COLUMN deployment varchar(16) CHECK (deployment IN ('on_premise', 'private_cloud', 'public_cloud')),
 ADD COLUMN modules text[] NOT NULL DEFAULT '{}',
 ADD COLUMN language varchar(2) NOT NULL DEFAULT 'ZH' CHECK (language ~ '^[A-Z]{2}$'),
 ADD COLUMN namespace varchar(12) NOT NULL DEFAULT 'Z' CHECK (namespace ~ '^(Z|Y|/[A-Z0-9_]{1,10}/)$'),
 ADD COLUMN default_package varchar(30) NOT NULL DEFAULT '' CHECK (default_package ~ '^([A-Z0-9_/$]{1,30})?$'),
 ADD COLUMN transport_method varchar(10) CHECK (transport_method IN ('charm', 'manual')),
 ADD COLUMN manager_id uuid REFERENCES app.app_user(id),
 ADD COLUMN director_id uuid REFERENCES app.app_user(id),
 ADD COLUMN architect_id uuid REFERENCES app.app_user(id),
 ADD COLUMN dev_lead_id uuid REFERENCES app.app_user(id),
 ADD COLUMN basis_lead_id uuid REFERENCES app.app_user(id),
 ADD COLUMN contract_no varchar(60) NOT NULL DEFAULT '',
 ADD COLUMN contract_model varchar(16) CHECK (contract_model IN ('fixed', 'per_day', 'time_material')),
 ADD COLUMN contract_days numeric(7, 1) CHECK (contract_days >= 0),
 ADD COLUMN dev_budget_days numeric(7, 1) CHECK (dev_budget_days >= 0),
 ADD COLUMN team_size smallint CHECK (team_size >= 0);

-- SAP Activate phases; the current phase is the first one in progress.
CREATE TABLE app.project_phase (
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 phase_key varchar(20) NOT NULL CHECK (phase_key IN ('discover', 'prepare', 'explore', 'realize', 'deploy', 'run')),
 name varchar(30) NOT NULL CHECK (length(btrim(name)) > 0),
 sort smallint NOT NULL,
 planned_start date,
 planned_end date,
 actual_start date,
 actual_end date,
 status varchar(12) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 PRIMARY KEY (project_id, phase_key),
 CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
 CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start),
 FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id)
);

-- Milestones; preset ones keep a key (code_freeze, go_live, ...) other pages refer to.
CREATE TABLE app.project_milestone (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 milestone_key varchar(30),
 name varchar(60) NOT NULL CHECK (length(btrim(name)) > 0),
 phase_key varchar(20) CHECK (phase_key IN ('discover', 'prepare', 'explore', 'realize', 'deploy', 'run')),
 planned_on date,
 achieved_on date,
 notes varchar(500) NOT NULL DEFAULT '',
 sort integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 UNIQUE (project_id, milestone_key),
 FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id)
);
CREATE INDEX ix_project_milestone_project ON app.project_milestone(project_id, sort);

CREATE TABLE app.project_module_lead (
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 module varchar(10) NOT NULL CHECK (module ~ '^[A-Z][A-Z0-9]{1,9}$'),
 user_id uuid NOT NULL REFERENCES app.app_user(id),
 PRIMARY KEY (project_id, module),
 FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id)
);

-- Customer-side contacts: not platform users, an address book of the project.
CREATE TABLE app.project_contact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name varchar(60) NOT NULL CHECK (length(btrim(name)) > 0),
 title varchar(60) NOT NULL DEFAULT '',
 department varchar(60) NOT NULL DEFAULT '',
 contact_role varchar(20) NOT NULL DEFAULT 'other'
  CHECK (contact_role IN ('customer_pm', 'it_lead', 'business_owner', 'key_user', 'other')),
 modules text[] NOT NULL DEFAULT '{}',
 phone varchar(40) NOT NULL DEFAULT '',
 email varchar(254) NOT NULL DEFAULT '',
 notes varchar(500) NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id)
);
CREATE INDEX ix_project_contact_project ON app.project_contact(project_id, name);

-- Weekly health reports; the latest one is the project's current health.
CREATE TABLE app.project_health (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 reported_on date NOT NULL DEFAULT current_date,
 overall varchar(6) NOT NULL CHECK (overall IN ('green', 'yellow', 'red')),
 schedule varchar(6) NOT NULL CHECK (schedule IN ('green', 'yellow', 'red')),
 scope varchar(6) NOT NULL CHECK (scope IN ('green', 'yellow', 'red')),
 cost varchar(6) NOT NULL CHECK (cost IN ('green', 'yellow', 'red')),
 quality varchar(6) NOT NULL CHECK (quality IN ('green', 'yellow', 'red')),
 note varchar(500) NOT NULL DEFAULT '',
 reported_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id)
);
CREATE INDEX ix_project_health_project ON app.project_health(project_id, reported_on DESC, created_at DESC);

-- Existing projects get the preset phases and milestones new projects are created with.
INSERT INTO app.project_phase(organization_id, project_id, phase_key, name, sort)
SELECT p.organization_id, p.id, ph.key, ph.name, ph.sort
FROM app.project p CROSS JOIN (VALUES
 ('discover', '发现', 1), ('prepare', '准备', 2), ('explore', '探索', 3),
 ('realize', '实现', 4), ('deploy', '部署', 5), ('run', '运行', 6)) AS ph(key, name, sort);
INSERT INTO app.project_milestone(organization_id, project_id, milestone_key, name, phase_key, sort)
SELECT p.organization_id, p.id, m.key, m.name, m.phase, m.sort
FROM app.project p CROSS JOIN (VALUES
 ('kickoff', '项目启动会', 'prepare', 1), ('blueprint_signoff', '蓝图签字', 'explore', 2),
 ('code_freeze', '开发冻结', 'realize', 3), ('sit_start', '集成测试（SIT）开始', 'realize', 4),
 ('sit_end', '集成测试（SIT）结束', 'realize', 5), ('uat_done', '用户验收（UAT）完成', 'deploy', 6),
 ('cutover_start', '切换开始', 'deploy', 7), ('go_live', '上线', 'deploy', 8),
 ('hypercare_end', '上线支持结束', 'run', 9)) AS m(key, name, phase, sort);

GRANT SELECT, INSERT, UPDATE ON app.project_phase TO sap_workbench_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.project_milestone, app.project_module_lead,
 app.project_contact TO sap_workbench_app;
GRANT SELECT, INSERT ON app.project_health TO sap_workbench_app;

-- Down Migration
DROP TABLE app.project_health, app.project_contact, app.project_module_lead,
 app.project_milestone, app.project_phase;
ALTER TABLE app.project DROP COLUMN short_name, DROP COLUMN methodology, DROP COLUMN contract_role,
 DROP COLUMN prime_contractor, DROP COLUMN sap_product, DROP COLUMN sap_release,
 DROP COLUMN deployment, DROP COLUMN modules, DROP COLUMN language, DROP COLUMN namespace,
 DROP COLUMN default_package, DROP COLUMN transport_method, DROP COLUMN manager_id,
 DROP COLUMN director_id, DROP COLUMN architect_id, DROP COLUMN dev_lead_id,
 DROP COLUMN basis_lead_id, DROP COLUMN contract_no, DROP COLUMN contract_model,
 DROP COLUMN contract_days, DROP COLUMN dev_budget_days, DROP COLUMN team_size;
