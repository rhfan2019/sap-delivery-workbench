-- Up Migration
CREATE TABLE app.item_work_version (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES app.fs_workspace(id),
 stage text NOT NULL CHECK(stage IN ('design','development')),
 revision integer NOT NULL CHECK(revision>0),
 document jsonb NOT NULL,
 markdown text NOT NULL,
 content_hash text NOT NULL,
 design_version_id uuid REFERENCES app.item_work_version(id),
 source_artifact_id uuid REFERENCES app.fsd_agent_revision(id),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,stage,revision)
);
GRANT SELECT,INSERT ON app.item_work_version TO sap_workbench_app;
CREATE INDEX item_work_version_workspace ON app.item_work_version(workspace_id,stage,revision DESC);
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve work versions; use forward repair.'; END $$;
