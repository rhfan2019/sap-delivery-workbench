-- Up Migration
ALTER TABLE app.fs_workspace ADD COLUMN assistant_reset_at timestamptz;
GRANT DELETE ON app.item_work_version TO sap_workbench_app;
-- Down Migration
ALTER TABLE app.fs_workspace DROP COLUMN assistant_reset_at;
REVOKE DELETE ON app.item_work_version FROM sap_workbench_app;
