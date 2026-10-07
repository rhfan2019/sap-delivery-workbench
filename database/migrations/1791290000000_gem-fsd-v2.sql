-- Up Migration
CREATE TABLE app.gem_fsd_v2_run (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 project_id uuid NOT NULL REFERENCES app.project(id),
 item_id uuid NOT NULL REFERENCES app.development_item(id),
 actor_id uuid NOT NULL REFERENCES app.app_user(id),
 conversation_id uuid NOT NULL,
 parent_id uuid REFERENCES app.gem_fsd_v2_run(id),
 request_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('running','completed','waiting_user','failed','cancelled','interrupted')),
 input jsonb NOT NULL,
 snapshot jsonb NOT NULL DEFAULT '{}',
 markdown text,
 content_hash text,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX gem_fsd_v2_item_history ON app.gem_fsd_v2_run(organization_id,item_id,actor_id,created_at DESC);
GRANT SELECT,INSERT,UPDATE ON app.gem_fsd_v2_run TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve v2 documents; use forward repair.'; END $$;
