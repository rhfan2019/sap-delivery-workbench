-- Up Migration
-- Complete checkpoint protocol metadata before worker execution is enabled.
ALTER TABLE app.fs_run_checkpoint ADD COLUMN idempotency_receipts jsonb NOT NULL;
ALTER TABLE app.fs_run_checkpoint ADD COLUMN cancel_epoch bigint NOT NULL CHECK(cancel_epoch>=0);
ALTER TABLE app.fs_run_checkpoint ADD COLUMN config_versions jsonb NOT NULL;
ALTER TABLE app.fs_run_checkpoint ADD COLUMN last_event_sequence bigint NOT NULL CHECK(last_event_sequence>=0);
-- Role commands precede workspace creation and cannot use workspace-scoped receipts.
CREATE TABLE app.fs_project_command_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES app.app_user(id), action text NOT NULL, key uuid NOT NULL,
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,actor_id,action,key),
 FOREIGN KEY(organization_id,project_id) REFERENCES app.project(organization_id,id)
);
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve command receipts and checkpoint history; use forward repair.'; END $$;
