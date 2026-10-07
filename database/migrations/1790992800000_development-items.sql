-- Up Migration
CREATE TABLE app.development_item (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 code varchar(32) NOT NULL, name varchar(200) NOT NULL CHECK(length(btrim(name))>0),
 module varchar(32) NOT NULL, kind varchar(20) NOT NULL CHECK(kind IN ('function','interface','report','enhancement','form')),
 change_type varchar(20) NOT NULL DEFAULT 'new' CHECK(change_type IN ('new','optimize','rebuild')),
 priority varchar(10) NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
 business_owner_id uuid, developer_id uuid, tester_id uuid,
 planned_fs_date date, planned_dev_date date, planned_test_date date,
 summary text NOT NULL DEFAULT '', acceptance text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 blocked_reason text NOT NULL DEFAULT '', stage varchar(20) NOT NULL DEFAULT 'fs_draft' CHECK(stage IN ('fs_draft','ready')),
 created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), row_version bigint NOT NULL DEFAULT 1,
 UNIQUE(organization_id,project_id,id), UNIQUE(organization_id,project_id,code),
 FOREIGN KEY(organization_id,project_id) REFERENCES app.project(organization_id,id),
 FOREIGN KEY(organization_id,project_id,business_owner_id) REFERENCES app.project_member(organization_id,project_id,user_id),
 FOREIGN KEY(organization_id,project_id,developer_id) REFERENCES app.project_member(organization_id,project_id,user_id),
 FOREIGN KEY(organization_id,project_id,tester_id) REFERENCES app.project_member(organization_id,project_id,user_id)
);
CREATE INDEX ix_development_project ON app.development_item(organization_id,project_id,created_at DESC,id);
CREATE TABLE app.fs_draft (
 item_id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
 fs_number varchar(100) NOT NULL DEFAULT '', sections jsonb NOT NULL DEFAULT '{}',
 row_version bigint NOT NULL DEFAULT 1, submitted_version_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES app.app_user(id),
 FOREIGN KEY(organization_id,project_id,item_id) REFERENCES app.development_item(organization_id,project_id,id),
 CHECK(jsonb_typeof(sections)='object')
);
CREATE TABLE app.fs_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, item_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0), fs_number varchar(100) NOT NULL,
 sections jsonb NOT NULL, note varchar(500) NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(item_id,version_number), UNIQUE(item_id,id),
 FOREIGN KEY(organization_id,project_id,item_id) REFERENCES app.development_item(organization_id,project_id,id)
);
-- Submission pointers are validated in the same locked transaction as snapshots;
-- no cyclic FK: version rows remain immutable and versions reference their item.
CREATE TABLE app.development_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, item_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES app.app_user(id), action varchar(50) NOT NULL, changes jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,item_id) REFERENCES app.development_item(organization_id,project_id,id)
);
CREATE TABLE app.development_file (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, item_id uuid NOT NULL,
 name varchar(200) NOT NULL, size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880), checksum varchar(64) NOT NULL,
 created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,item_id) REFERENCES app.development_item(organization_id,project_id,id)
);
CREATE TABLE app.project_preference (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, project_id uuid,
 PRIMARY KEY(organization_id,user_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES app.organization_member(organization_id,user_id),
 FOREIGN KEY(organization_id,project_id) REFERENCES app.project(organization_id,id)
);
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Use a reviewed forward migration to preserve delivery history.'; END $$;
