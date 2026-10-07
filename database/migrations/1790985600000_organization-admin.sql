-- Up Migration
-- Fixed organization-level administration boundary, not a generic RBAC engine.
ALTER TABLE app.organization_member ADD COLUMN access_level varchar(16) NOT NULL DEFAULT 'member'
    CHECK (access_level IN ('admin', 'member'));

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Removing management authorization requires a reviewed forward migration.'; END $$;
