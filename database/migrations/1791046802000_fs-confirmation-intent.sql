-- Up Migration
ALTER TABLE app.fs_confirmation ADD COLUMN intent jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(intent)='object');
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Confirmation intent is audit history; use forward repair.'; END $$;
