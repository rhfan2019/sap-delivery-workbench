-- Up Migration
-- docs/modules/list-report.md 4: a person's saved views of a list report (filter fields,
-- conditions, columns, sort), one project at a time. Removed with its owner's data only by hand.
CREATE TABLE app.list_view (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  project_id uuid NOT NULL REFERENCES app.project(id),
  owner_id uuid NOT NULL REFERENCES app.app_user(id),
  list_key text NOT NULL CHECK (char_length(list_key) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  is_default boolean NOT NULL DEFAULT false,
  auto_apply boolean NOT NULL DEFAULT true,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX list_view_name
  ON app.list_view(organization_id, project_id, owner_id, list_key, lower(name));
CREATE UNIQUE INDEX list_view_default
  ON app.list_view(organization_id, project_id, owner_id, list_key) WHERE is_default;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.list_view TO sap_workbench_app;

-- Down Migration
DROP TABLE app.list_view;
