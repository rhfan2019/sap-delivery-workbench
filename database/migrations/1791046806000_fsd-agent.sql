-- Up Migration
CREATE TABLE app.fsd_agent_session (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES app.organization(id), actor_id uuid NOT NULL REFERENCES app.app_user(id),
 selection jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,actor_id,id)
);
CREATE TABLE app.fsd_agent_run (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, actor_id uuid NOT NULL, conversation_id uuid NOT NULL,
 request_id uuid NOT NULL, request_hash text NOT NULL, state text NOT NULL, snapshot jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,actor_id,request_id), FOREIGN KEY(organization_id,actor_id,conversation_id) REFERENCES app.fsd_agent_session(organization_id,actor_id,id)
);
CREATE TABLE app.fsd_agent_revision (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, actor_id uuid NOT NULL, conversation_id uuid NOT NULL, run_id uuid NOT NULL REFERENCES app.fsd_agent_run(id),
 revision integer NOT NULL CHECK(revision>0), spec jsonb NOT NULL, markdown text NOT NULL, content_hash text NOT NULL, evidence jsonb NOT NULL, manifest jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(conversation_id,revision), UNIQUE(run_id),
 FOREIGN KEY(organization_id,actor_id,conversation_id) REFERENCES app.fsd_agent_session(organization_id,actor_id,id)
);
CREATE TABLE app.fsd_agent_attachment (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, actor_id uuid NOT NULL, conversation_id uuid NOT NULL,
 name text NOT NULL, bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 20971520), content_hash text NOT NULL, state text NOT NULL,
 extraction jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,actor_id,conversation_id) REFERENCES app.fsd_agent_session(organization_id,actor_id,id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.fsd_agent_session,app.fsd_agent_run,app.fsd_agent_revision,app.fsd_agent_attachment TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve FSD evidence; use forward repair.'; END $$;
