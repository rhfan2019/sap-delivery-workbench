-- Up Migration
-- Contract 1.14: the site theme and light/dark mode each person picks (个人设置 › 外观),
-- kept with the account so it follows them across browsers. Owned by platform.
CREATE TABLE app.user_preference (
 user_id uuid PRIMARY KEY REFERENCES app.app_user(id) ON DELETE CASCADE,
 theme varchar(32) NOT NULL DEFAULT 'navy' CHECK (theme ~ '^[a-z][a-z0-9-]{1,31}$'),
 mode varchar(8) NOT NULL DEFAULT 'system' CHECK (mode IN ('light', 'dark', 'system')),
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
GRANT SELECT, INSERT, UPDATE ON app.user_preference TO sap_workbench_app;
-- Down Migration
DROP TABLE app.user_preference;
