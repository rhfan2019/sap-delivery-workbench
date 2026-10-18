-- Up Migration
-- Contract 1.18 / docs/specs/project-access-admin.md section 2: role-based access control.
-- Roles hold permission codes from packages/contracts/access/catalog.mjs; built-in roles and
-- positions are synchronized by the API at startup (access module, syncBuiltInRoles).
CREATE TABLE app.access_role (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 code varchar(40) NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
 name varchar(60) NOT NULL CHECK (length(btrim(name)) > 0),
 description varchar(300) NOT NULL DEFAULT '',
 kind varchar(10) NOT NULL CHECK (kind IN ('single', 'composite')),
 scope varchar(12) NOT NULL CHECK (scope IN ('organization', 'project')),
 built_in boolean NOT NULL DEFAULT false,
 status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
 created_by uuid REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 UNIQUE (organization_id, code),
 UNIQUE (organization_id, id)
);

CREATE TABLE app.access_role_permission (
 organization_id uuid NOT NULL,
 role_id uuid NOT NULL,
 permission varchar(60) NOT NULL CHECK (permission ~ '^[a-z][a-z_.]*:[a-z]+$'),
 PRIMARY KEY (role_id, permission),
 FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE app.access_role_composition (
 organization_id uuid NOT NULL,
 composite_id uuid NOT NULL,
 member_id uuid NOT NULL,
 PRIMARY KEY (composite_id, member_id),
 CHECK (composite_id <> member_id),
 FOREIGN KEY (organization_id, composite_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id, member_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_access_role_composition_member ON app.access_role_composition(member_id);

-- One level only: a composite holds single roles; a project composite holds project roles.
CREATE FUNCTION app.access_check_composition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c app.access_role; m app.access_role;
BEGIN
  SELECT * INTO c FROM app.access_role WHERE id = NEW.composite_id;
  SELECT * INTO m FROM app.access_role WHERE id = NEW.member_id;
  IF c.kind <> 'composite' OR m.kind <> 'single' THEN
    RAISE EXCEPTION 'A composite role holds single roles only' USING ERRCODE = '23514';
  END IF;
  IF c.scope = 'project' AND m.scope <> 'project' THEN
    RAISE EXCEPTION 'A project composite holds project roles only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER access_role_composition_check BEFORE INSERT OR UPDATE ON app.access_role_composition
 FOR EACH ROW EXECUTE FUNCTION app.access_check_composition();

CREATE TABLE app.access_position (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 code varchar(40) NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
 name varchar(60) NOT NULL CHECK (length(btrim(name)) > 0),
 description varchar(300) NOT NULL DEFAULT '',
 status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 UNIQUE (organization_id, code),
 UNIQUE (organization_id, id)
);

CREATE TABLE app.access_position_role (
 organization_id uuid NOT NULL,
 position_id uuid NOT NULL,
 role_id uuid NOT NULL,
 PRIMARY KEY (position_id, role_id),
 FOREIGN KEY (organization_id, position_id) REFERENCES app.access_position(organization_id, id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE app.app_user
 ADD COLUMN position_id uuid REFERENCES app.access_position(id) ON DELETE SET NULL,
 ADD COLUMN person_type varchar(16) NOT NULL DEFAULT 'employee'
  CHECK (person_type IN ('employee', 'subcontractor', 'external')),
 ADD COLUMN skill_modules text[] NOT NULL DEFAULT '{}';

-- Organization-level assignment: the role applies organization-wide; its project permissions
-- apply to the projects in project_scope (all, the projects of some customers, some projects, none).
CREATE TABLE app.access_assignment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 user_id uuid NOT NULL,
 role_id uuid NOT NULL,
 project_scope varchar(12) NOT NULL DEFAULT 'all'
  CHECK (project_scope IN ('all', 'customers', 'projects', 'none')),
 scope_ids uuid[] NOT NULL DEFAULT '{}',
 valid_from date NOT NULL DEFAULT current_date,
 valid_to date,
 granted_by uuid REFERENCES app.app_user(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 UNIQUE (organization_id, user_id, role_id),
 CHECK ((project_scope IN ('customers', 'projects')) = (cardinality(scope_ids) > 0)),
 CHECK (valid_to IS NULL OR valid_to >= valid_from),
 FOREIGN KEY (organization_id, user_id) REFERENCES app.organization_member(organization_id, user_id),
 FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id)
);
CREATE INDEX ix_access_assignment_role ON app.access_assignment(role_id);

-- Project-level assignment of a project member: modules narrows item edits and agent use
-- (empty = all modules); own_only limits them to items the member is responsible for.
CREATE TABLE app.access_project_role (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 user_id uuid NOT NULL,
 role_id uuid NOT NULL,
 modules text[] NOT NULL DEFAULT '{}',
 own_only boolean NOT NULL DEFAULT false,
 valid_from date NOT NULL DEFAULT current_date,
 valid_to date,
 granted_by uuid REFERENCES app.app_user(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 UNIQUE (project_id, user_id, role_id),
 CHECK (valid_to IS NULL OR valid_to >= valid_from),
 FOREIGN KEY (organization_id, project_id, user_id)
  REFERENCES app.project_member(organization_id, project_id, user_id),
 FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id)
);
CREATE INDEX ix_access_project_role_user ON app.access_project_role(organization_id, user_id);
CREATE INDEX ix_access_project_role_role ON app.access_project_role(role_id);

-- Organization-level roles are assigned organization-wide, project roles inside a project.
CREATE FUNCTION app.access_check_assignment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wanted text := CASE TG_TABLE_NAME WHEN 'access_assignment' THEN 'organization' ELSE 'project' END;
BEGIN
  IF (SELECT scope FROM app.access_role WHERE id = NEW.role_id) <> wanted THEN
    RAISE EXCEPTION 'Role scope does not match the assignment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER access_assignment_scope BEFORE INSERT OR UPDATE ON app.access_assignment
 FOR EACH ROW EXECUTE FUNCTION app.access_check_assignment_scope();
CREATE TRIGGER access_project_role_scope BEFORE INSERT OR UPDATE ON app.access_project_role
 FOR EACH ROW EXECUTE FUNCTION app.access_check_assignment_scope();

-- Existing rights carry over: administrators become super administrators of all projects, and
-- every active project member gets the architect role in that project (the list and both
-- assistants), so nobody loses access on the day of the migration. Startup sync fills in
-- the names, permissions and members of these built-in roles.
INSERT INTO app.access_role(organization_id, code, name, kind, scope, built_in)
SELECT o.id, r.code, r.name, r.kind, r.scope, true
FROM app.organization o CROSS JOIN (VALUES
 ('SYS_SUPER_ADMIN', '超级管理员', 'single', 'organization'),
 ('C_ARCHITECT', '方案架构师', 'composite', 'project')) AS r(code, name, kind, scope);

INSERT INTO app.access_assignment(organization_id, user_id, role_id, project_scope, valid_from)
SELECT m.organization_id, m.user_id, r.id, 'all', m.joined_at::date
FROM app.organization_member m
JOIN app.access_role r ON r.organization_id = m.organization_id AND r.code = 'SYS_SUPER_ADMIN'
WHERE m.access_level = 'admin';

INSERT INTO app.access_project_role(organization_id, project_id, user_id, role_id, valid_from)
SELECT pm.organization_id, pm.project_id, pm.user_id, r.id, pm.joined_at::date
FROM app.project_member pm
JOIN app.access_role r ON r.organization_id = pm.organization_id AND r.code = 'C_ARCHITECT'
WHERE pm.status = 'active';

ALTER TABLE app.organization_member DROP COLUMN access_level;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.access_role, app.access_role_permission,
 app.access_role_composition, app.access_position, app.access_position_role,
 app.access_assignment, app.access_project_role TO sap_workbench_app;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Access control replaced the administrator flag; use forward repair.'; END $$;
