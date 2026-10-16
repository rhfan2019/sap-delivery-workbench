-- Up Migration
-- Contract 3.4: function modules and classes that test data creation may call, per SAP system,
-- and one record per authorized creation run.
CREATE TABLE app.sap_system_allowlist (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 system_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('BAPI','FM','CLASS')),
 name text NOT NULL CHECK (name ~ '^(/[A-Z0-9_]+/)?[A-Z][A-Z0-9_]{0,29}$'),
 description text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 UNIQUE (organization_id, system_id, name),
 FOREIGN KEY (organization_id, system_id) REFERENCES app.sap_system(organization_id, id)
);

CREATE TABLE app.sap_test_data_run (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 project_id uuid NOT NULL REFERENCES app.project(id),
 system_id uuid NOT NULL,
 environment varchar(3) NOT NULL CHECK (environment IN ('DEV','QAS')),
 client text,
 sap_user text NOT NULL,
 agent text NOT NULL,
 agent_session_id uuid,
 request_id text NOT NULL,
 purpose text NOT NULL,
 class_name text NOT NULL,
 source text NOT NULL,
 functions text[] NOT NULL DEFAULT '{}',
 status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
 output text NOT NULL DEFAULT '',
 error text,
 cleaned_up boolean NOT NULL DEFAULT false,
 authorized_by uuid NOT NULL REFERENCES app.app_user(id),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 FOREIGN KEY (organization_id, system_id) REFERENCES app.sap_system(organization_id, id)
);
CREATE INDEX sap_test_data_run_project ON app.sap_test_data_run(organization_id, project_id, started_at DESC);
CREATE UNIQUE INDEX sap_test_data_run_request ON app.sap_test_data_run(agent, agent_session_id, request_id);

GRANT SELECT,INSERT,UPDATE ON app.sap_system_allowlist TO sap_workbench_app;
GRANT SELECT,INSERT,UPDATE ON app.sap_test_data_run TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve test data run records; use forward repair.'; END $$;
