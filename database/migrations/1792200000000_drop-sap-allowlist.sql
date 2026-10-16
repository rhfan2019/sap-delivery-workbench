-- Up Migration
-- Contract 1.9: test data code may call any BAPI, function module or class; the per-system
-- allowlist is dropped (user decision 2026-10-16). A blacklist is deferred.
DROP TABLE app.sap_system_allowlist;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'The allowlist was dropped on purpose; use forward repair.'; END $$;
