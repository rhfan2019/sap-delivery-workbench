-- Up Migration
ALTER TABLE app.fs_export ADD COLUMN manifest jsonb NOT NULL DEFAULT '{}';
ALTER TABLE app.fs_export ADD COLUMN error_code text;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve export provenance; use forward repair.'; END $$;
