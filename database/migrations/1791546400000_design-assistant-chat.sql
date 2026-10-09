-- Up Migration
-- User-visible content is deliberately separate from diagnostic/audit events.
CREATE TABLE app.fsd_v1_chat_turn (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES app.fsd_v1_task(id),
 run_id uuid NOT NULL REFERENCES app.fsd_v1_run(id),
 input jsonb NOT NULL, last_seq integer NOT NULL DEFAULT 0 CHECK(last_seq>=0),
 terminal boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX fsd_v1_chat_turn_history ON app.fsd_v1_chat_turn(task_id,created_at,id);
CREATE TABLE app.fsd_v1_chat_event (
 turn_id uuid NOT NULL REFERENCES app.fsd_v1_chat_turn(id),
 seq integer NOT NULL CHECK(seq>0), type text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(turn_id,seq)
);
GRANT SELECT,INSERT,UPDATE ON app.fsd_v1_chat_turn,app.fsd_v1_chat_event TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve conversation history; use a forward migration.'; END $$;
