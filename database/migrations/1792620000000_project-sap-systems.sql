-- Up Migration
-- Contract 1.18 / 3.4, docs/specs/project-access-admin.md section 3: SAP systems are registered
-- per project (development and test only, never production) without any user or password;
-- each person enters their own SAP user, kept for one login or saved encrypted under the
-- organization's policy. The organization-level system tables and the shared and personal
-- passwords are deleted (user decision 2026-10-17: delete tables that are no longer used).
CREATE TABLE app.project_sap_system (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name varchar(60) NOT NULL CHECK (length(btrim(name)) > 0),
 purpose varchar(12) NOT NULL CHECK (purpose IN ('development', 'test')),
 sid varchar(3) NOT NULL CHECK (sid ~ '^[A-Z][A-Z0-9]{2}$'),
 sap_url varchar(2048) NOT NULL,
 client varchar(3) NOT NULL CHECK (client ~ '^\d{3}$'),
 language varchar(2) NOT NULL DEFAULT 'ZH' CHECK (language ~ '^[A-Z]{2}$'),
 description varchar(300) NOT NULL DEFAULT '',
 is_default boolean NOT NULL DEFAULT false,
 status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
 last_test_status varchar(16),
 last_test_message varchar(300),
 last_test_at timestamptz,
 backend_version varchar(300),
 created_by uuid REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 UNIQUE (organization_id, project_id, id),
 -- A small landscape may use one client for both purposes; each purpose lists it once.
 UNIQUE (project_id, purpose, sap_url, client),
 CHECK (NOT is_default OR status = 'active'),
 FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id)
);
-- One default system per purpose in a project.
CREATE UNIQUE INDEX ux_project_sap_system_default ON app.project_sap_system(project_id, purpose)
 WHERE is_default;

-- A person's own SAP user for one project system, saved encrypted (AES-256-GCM, bound to the
-- user, system, address, client and SAP user). "This login only" credentials never get here.
CREATE TABLE app.sap_user_credential (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 system_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES app.app_user(id),
 sap_username varchar(128) NOT NULL CHECK (length(btrim(sap_username)) > 0),
 password_cipher text NOT NULL,
 key_version smallint NOT NULL DEFAULT 1,
 saved_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 last_used_at timestamptz,
 UNIQUE (system_id, user_id),
 FOREIGN KEY (organization_id, project_id, system_id)
  REFERENCES app.project_sap_system(organization_id, project_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_sap_user_credential_user ON app.sap_user_credential(organization_id, user_id);

CREATE TABLE app.sap_credential_policy (
 organization_id uuid PRIMARY KEY REFERENCES app.organization(id),
 allow_save boolean NOT NULL DEFAULT true,
 max_days smallint NOT NULL DEFAULT 30 CHECK (max_days BETWEEN 1 AND 365),
 idle_days smallint NOT NULL DEFAULT 14 CHECK (idle_days BETWEEN 1 AND 365),
 subcontractor_save boolean NOT NULL DEFAULT false,
 updated_by uuid REFERENCES app.app_user(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);

-- Saved credentials go away with the person's access: leaving the project, a disabled account
-- or membership, and a system whose address or client changed or that was switched off.
CREATE FUNCTION app.sap_forget_member_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    DELETE FROM app.sap_user_credential
    WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sap_forget_on_project_leave AFTER UPDATE OF status ON app.project_member
 FOR EACH ROW EXECUTE FUNCTION app.sap_forget_member_credentials();

CREATE FUNCTION app.sap_forget_user_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    IF TG_TABLE_NAME = 'app_user' THEN
      DELETE FROM app.sap_user_credential WHERE user_id = NEW.id;
    ELSE
      DELETE FROM app.sap_user_credential WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sap_forget_on_user_disable AFTER UPDATE OF status ON app.app_user
 FOR EACH ROW EXECUTE FUNCTION app.sap_forget_user_credentials();
CREATE TRIGGER sap_forget_on_member_disable AFTER UPDATE OF status ON app.organization_member
 FOR EACH ROW EXECUTE FUNCTION app.sap_forget_user_credentials();

CREATE FUNCTION app.sap_forget_system_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sap_url <> OLD.sap_url OR NEW.client <> OLD.client OR (NEW.status <> 'active' AND OLD.status = 'active') THEN
    DELETE FROM app.sap_user_credential WHERE system_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sap_forget_on_system_change AFTER UPDATE ON app.project_sap_system
 FOR EACH ROW EXECUTE FUNCTION app.sap_forget_system_credentials();

-- Development items may name the development system they target (default: the project's).
ALTER TABLE app.development_item ADD COLUMN sap_system_id uuid;
ALTER TABLE app.development_item ADD CONSTRAINT development_item_sap_system_fkey
 FOREIGN KEY (organization_id, project_id, sap_system_id)
 REFERENCES app.project_sap_system(organization_id, project_id, id) ON DELETE SET NULL (sap_system_id);

-- Each project's DEV and QAS become its default development and test system.
INSERT INTO app.project_sap_system(organization_id, project_id, name, purpose, sid, sap_url, client,
 language, description, is_default, last_test_status, last_test_message, last_test_at, backend_version)
SELECT c.organization_id, c.project_id,
 left(s.name || CASE c.environment WHEN 'DEV' THEN ' 开发' ELSE ' 测试' END, 60),
 CASE c.environment WHEN 'DEV' THEN 'development' ELSE 'test' END,
 CASE WHEN upper(s.code) ~ '^[A-Z][A-Z0-9]{2}$' THEN upper(s.code)
  WHEN upper(regexp_replace(s.code, '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z][A-Z0-9]{2}'
   THEN left(upper(regexp_replace(s.code, '[^A-Za-z0-9]', '', 'g')), 3)
  ELSE 'SAP' END,
 s.sap_url, COALESCE(c.client, '000'), COALESCE(c.language, s.language, 'ZH'),
 CASE WHEN c.client IS NULL THEN '迁移时原配置没有 Client，请核对。' ELSE '' END,
 true, s.last_test_status, left(s.last_test_message, 300), s.last_test_at, left(s.backend_version, 300)
FROM app.project_sap_config c JOIN app.sap_system s ON s.id = c.system_id AND s.organization_id = c.organization_id
WHERE c.environment IN ('DEV', 'QAS');

ALTER TABLE app.sap_test_data_run DROP CONSTRAINT sap_test_data_run_organization_id_system_id_fkey;
DROP TABLE app.user_project_sap_config, app.project_sap_config, app.sap_system_grant, app.sap_system;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.project_sap_system, app.sap_user_credential TO sap_workbench_app;
GRANT SELECT, INSERT, UPDATE ON app.sap_credential_policy TO sap_workbench_app;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'The organization SAP tables were deleted on purpose; use forward repair.'; END $$;
