-- Up Migration
ALTER TABLE app.fs_message ADD COLUMN request_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE app.fs_message ADD COLUMN run_id uuid;
ALTER TABLE app.fs_message ADD FOREIGN KEY(organization_id,project_id,workspace_id,run_id)
  REFERENCES app.fs_run(organization_id,project_id,workspace_id,id);
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve immutable message inputs; use forward repair.'; END $$;
