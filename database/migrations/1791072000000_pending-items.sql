-- Up Migration
ALTER TABLE app.development_item ADD COLUMN deleted_at timestamptz;
ALTER TABLE app.sap_system ADD COLUMN last_test_status text CHECK(last_test_status IN ('passed','failed')),
 ADD COLUMN last_test_message text, ADD COLUMN last_test_at timestamptz, ADD COLUMN backend_version text;
-- Down Migration
ALTER TABLE app.sap_system DROP COLUMN backend_version, DROP COLUMN last_test_at, DROP COLUMN last_test_message, DROP COLUMN last_test_status;
ALTER TABLE app.development_item DROP COLUMN deleted_at;
