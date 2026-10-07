-- Up Migration
ALTER TABLE app.fs_publication ADD COLUMN reason text NOT NULL DEFAULT '';
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve publication history; use forward repair.'; END $$;
