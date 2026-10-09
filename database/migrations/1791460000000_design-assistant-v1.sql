-- Up Migration
CREATE TABLE app.fsd_v1_task (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES app.organization(id),
 project_id uuid NOT NULL REFERENCES app.project(id), item_id uuid NOT NULL REFERENCES app.development_item(id),
 actor_id uuid NOT NULL REFERENCES app.app_user(id), revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX fsd_v1_task_scope ON app.fsd_v1_task(organization_id,project_id,item_id,created_at);
CREATE TABLE app.fsd_v1_run (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES app.fsd_v1_task(id), thread_id uuid NOT NULL UNIQUE,
 input_snapshot_id uuid NOT NULL, snapshot jsonb NOT NULL, assets jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','WAITING','COMPLETED','FAILED','CANCELLED')),
 expected_revision integer NOT NULL, generation bigint NOT NULL DEFAULT 0,
 lease_until timestamptz, lease_owner text, state jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX fsd_v1_one_writer ON app.fsd_v1_run(task_id) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE app.fsd_v1_request (
 organization_id uuid NOT NULL, actor_id uuid NOT NULL, request_id uuid NOT NULL,
 payload_hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(organization_id,actor_id,request_id)
);
CREATE TABLE app.fsd_v1_event (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id uuid NOT NULL UNIQUE,
 task_id uuid NOT NULL REFERENCES app.fsd_v1_task(id), run_id uuid REFERENCES app.fsd_v1_run(id),
 actor_id uuid, event_type text NOT NULL, data jsonb NOT NULL,
 dispatch_status text NOT NULL DEFAULT 'RECORDED' CHECK(dispatch_status IN ('RECORDED','PENDING','CLAIMED','DONE')),
 dispatch_attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX fsd_v1_event_cursor ON app.fsd_v1_event(task_id,sequence);
CREATE INDEX fsd_v1_outbox ON app.fsd_v1_event(dispatch_status,created_at);
CREATE TABLE app.fsd_v1_commit (
 commit_key text PRIMARY KEY, run_id uuid NOT NULL REFERENCES app.fsd_v1_run(id), step_id text NOT NULL,
 input_snapshot_id uuid NOT NULL, proposal_hash text NOT NULL, before_revision integer NOT NULL,
 after_revision integer NOT NULL, result jsonb NOT NULL, event_id uuid NOT NULL REFERENCES app.fsd_v1_event(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.fsd_v1_operation (
 id text PRIMARY KEY, run_id uuid NOT NULL REFERENCES app.fsd_v1_run(id), kind text NOT NULL,
 status text NOT NULL CHECK(status IN ('RESERVED','SETTLED','UNKNOWN')), reservation jsonb NOT NULL,
 result jsonb, result_hash text, error jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 settled_at timestamptz
);
CREATE TABLE app.fsd_v1_attempt (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES app.fsd_v1_run(id), generation bigint NOT NULL,
 trace_id text, state jsonb NOT NULL, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), ended_at timestamptz
);
CREATE TABLE app.fsd_v1_attachment (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES app.fsd_v1_task(id), name text NOT NULL,
 media_type text NOT NULL, bytes bytea NOT NULL CHECK(octet_length(bytes)<=20971520),
 content_hash text NOT NULL, extraction jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE SCHEMA IF NOT EXISTS fsd_checkpoint;
GRANT USAGE ON SCHEMA fsd_checkpoint TO sap_workbench_app;
GRANT SELECT,INSERT,UPDATE ON app.fsd_v1_task,app.fsd_v1_run,app.fsd_v1_request,app.fsd_v1_event,app.fsd_v1_commit,app.fsd_v1_operation,app.fsd_v1_attempt,app.fsd_v1_attachment TO sap_workbench_app;
GRANT USAGE,SELECT ON SEQUENCE app.fsd_v1_event_sequence_seq TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve design history and checkpoint data; use a forward migration.'; END $$;
