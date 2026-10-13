-- Up Migration
-- Contract 1.6 / docs/specs/development-list.md: the development list is rebuilt on the
-- user's field table. Existing items and everything hanging off them are cleared (user
-- decision 2026-10-12); files under .runtime stay on disk for the user to clean up.
TRUNCATE app.abap_fsd_agent_session CASCADE;
TRUNCATE app.development_event, app.development_file;
DROP TABLE app.fs_version, app.fs_draft;
DROP TABLE app.development_item CASCADE;

CREATE TABLE app.development_item (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 item_no integer NOT NULL CHECK(item_no BETWEEN 1 AND 99999),
 code varchar(5) GENERATED ALWAYS AS (lpad(item_no::text, 5, '0')) STORED,
 module varchar(16) NOT NULL CHECK(length(btrim(module)) > 0),
 kind varchar(20) NOT NULL CHECK(kind IN ('report','function','interface','enhancement')),
 name varchar(200) NOT NULL CHECK(length(btrim(name)) > 0),
 business_function text NOT NULL DEFAULT '',
 priority varchar(10) NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
 difficulty varchar(10) NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('hard','medium','easy')),
 change_type varchar(20) NOT NULL DEFAULT 'new' CHECK(change_type IN ('new','rebuild','optimize')),
 registered_on date NOT NULL DEFAULT current_date,
 business_owner varchar(100) NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 transaction_code varchar(200) NOT NULL DEFAULT '',
 custom_values jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(custom_values) = 'object'),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES app.app_user(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1,
 deleted_at timestamptz,
 UNIQUE(organization_id, project_id, id),
 UNIQUE(organization_id, project_id, item_no),
 FOREIGN KEY(organization_id, project_id) REFERENCES app.project(organization_id, id)
);
CREATE INDEX development_item_list ON app.development_item(organization_id, project_id, item_no DESC)
 WHERE deleted_at IS NULL;
CREATE INDEX development_item_custom ON app.development_item USING gin(custom_values);

-- Four rows per item, one per phase; the phases do not depend on each other.
CREATE TABLE app.development_item_phase (
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 item_id uuid NOT NULL,
 phase varchar(20) NOT NULL CHECK(phase IN ('fsd','development','consultant_test','user_test')),
 assignee_id uuid,
 effort_days numeric(5,1) CHECK(effort_days >= 0),
 planned_start date,
 planned_end date,
 actual_end date,
 progress smallint NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 status varchar(20) NOT NULL DEFAULT 'not_started'
  CHECK(status IN ('not_started','in_progress','completed','delayed','cancelled')),
 notes text NOT NULL DEFAULT '',
 updated_by uuid REFERENCES app.app_user(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(item_id, phase),
 CHECK(effort_days IS NULL OR phase IN ('fsd','development')),
 CHECK(planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
 CHECK(status <> 'completed' OR progress = 100),
 FOREIGN KEY(organization_id, project_id, item_id)
  REFERENCES app.development_item(organization_id, project_id, id),
 FOREIGN KEY(organization_id, project_id, assignee_id)
  REFERENCES app.project_member(organization_id, project_id, user_id)
);
CREATE INDEX development_item_phase_status ON app.development_item_phase(organization_id, project_id, phase, status);
CREATE INDEX development_item_phase_assignee ON app.development_item_phase(organization_id, project_id, phase, assignee_id);

-- SAP repository objects (TADIR key). One object may serve several items.
CREATE TABLE app.development_item_object (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 item_id uuid NOT NULL,
 pgmid varchar(4) NOT NULL DEFAULT 'R3TR' CHECK(pgmid ~ '^[A-Z0-9]{4}$'),
 object_type varchar(4) NOT NULL CHECK(object_type ~ '^[A-Z0-9]{4}$'),
 object_name varchar(120) NOT NULL CHECK(length(btrim(object_name)) > 0 AND object_name = upper(object_name)),
 sort_order integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(item_id, pgmid, object_type, object_name),
 FOREIGN KEY(organization_id, project_id, item_id)
  REFERENCES app.development_item(organization_id, project_id, id)
);
CREATE INDEX development_item_object_name ON app.development_item_object(organization_id, project_id, object_type, object_name);

CREATE TABLE app.development_tag (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name varchar(30) NOT NULL CHECK(length(btrim(name)) > 0),
 color varchar(16) NOT NULL DEFAULT 'gray'
  CHECK(color IN ('gray','blue','green','orange','red','purple','teal','yellow')),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id, project_id, id),
 FOREIGN KEY(organization_id, project_id) REFERENCES app.project(organization_id, id)
);
CREATE UNIQUE INDEX development_tag_name ON app.development_tag(organization_id, project_id, lower(name));

CREATE TABLE app.development_item_tag (
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 item_id uuid NOT NULL,
 tag_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(item_id, tag_id),
 FOREIGN KEY(organization_id, project_id, item_id)
  REFERENCES app.development_item(organization_id, project_id, id),
 FOREIGN KEY(organization_id, project_id, tag_id)
  REFERENCES app.development_tag(organization_id, project_id, id) ON DELETE CASCADE
);
CREATE INDEX development_item_tag_tag ON app.development_item_tag(tag_id);

-- Project-level custom columns; values live in development_item.custom_values keyed by id.
CREATE TABLE app.development_field (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 project_id uuid NOT NULL,
 label varchar(50) NOT NULL CHECK(length(btrim(label)) > 0),
 field_type varchar(20) NOT NULL
  CHECK(field_type IN ('text','long_text','number','date','select','multi_select','member','checkbox','url')),
 options jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(options) = 'array'),
 group_key varchar(20) NOT NULL DEFAULT 'custom'
  CHECK(group_key IN ('basic','fsd','development','consultant_test','user_test','custom')),
 sort_order integer NOT NULL DEFAULT 0,
 required boolean NOT NULL DEFAULT false,
 archived_at timestamptz,
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(organization_id, project_id) REFERENCES app.project(organization_id, id)
);
CREATE UNIQUE INDEX development_field_label ON app.development_field(organization_id, project_id, lower(label))
 WHERE archived_at IS NULL;

ALTER TABLE app.development_event ADD FOREIGN KEY(organization_id, project_id, item_id)
 REFERENCES app.development_item(organization_id, project_id, id);
ALTER TABLE app.development_file ADD FOREIGN KEY(organization_id, project_id, item_id)
 REFERENCES app.development_item(organization_id, project_id, id);
ALTER TABLE app.abap_fsd_agent_session ADD FOREIGN KEY(item_id) REFERENCES app.development_item(id);

-- Items are soft-deleted; objects are replaced as a list; tags and their links are removable.
GRANT SELECT, INSERT, UPDATE ON app.development_item, app.development_item_phase, app.development_field TO sap_workbench_app;
GRANT SELECT, INSERT, DELETE ON app.development_item_object, app.development_item_tag TO sap_workbench_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.development_tag TO sap_workbench_app;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'The development list rebuild is forward-only; restore from a backup instead.'; END $$;
