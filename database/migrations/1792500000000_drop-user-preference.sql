-- Up Migration
-- Contract 1.17: one look for everyone (DESIGN.md 2.0), so the per-person theme and mode of
-- contract 1.14 are no longer stored. The user confirmed removing the table and its data
-- on 2026-10-17.
DROP TABLE app.user_preference;
-- Down Migration
CREATE TABLE app.user_preference (
 user_id uuid PRIMARY KEY REFERENCES app.app_user(id) ON DELETE CASCADE,
 theme varchar(32) NOT NULL DEFAULT 'navy' CHECK (theme ~ '^[a-z][a-z0-9-]{1,31}$'),
 mode varchar(8) NOT NULL DEFAULT 'system' CHECK (mode IN ('light', 'dark', 'system')),
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
GRANT SELECT, INSERT, UPDATE ON app.user_preference TO sap_workbench_app;
