-- Up Migration
-- abap-fsd-agent: conversation, document versions and comments are the only state.
CREATE TABLE app.abap_fsd_agent_session (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 project_id uuid NOT NULL REFERENCES app.project(id),
 item_id uuid NOT NULL REFERENCES app.development_item(id),
 title text NOT NULL DEFAULT '',
 active_turn_id uuid,
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX abap_fsd_agent_session_item ON app.abap_fsd_agent_session(organization_id, item_id, updated_at DESC);

CREATE TABLE app.abap_fsd_agent_turn (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES app.abap_fsd_agent_session(id),
 status text NOT NULL CHECK(status IN ('running','completed','interrupted','cancelled','failed')),
 stop_reason text,
 model jsonb NOT NULL DEFAULT '{}',
 usage jsonb NOT NULL DEFAULT '{}',
 error jsonb,
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX abap_fsd_agent_turn_session ON app.abap_fsd_agent_turn(session_id, started_at);
CREATE INDEX abap_fsd_agent_turn_running ON app.abap_fsd_agent_turn(status) WHERE status = 'running';

-- role/content/payload mirror the chat messages sent to the model, so a session can be replayed.
CREATE TABLE app.abap_fsd_agent_message (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES app.abap_fsd_agent_session(id),
 turn_id uuid REFERENCES app.abap_fsd_agent_turn(id),
 seq integer NOT NULL CHECK(seq > 0),
 role text NOT NULL CHECK(role IN ('user','assistant','tool')),
 content text NOT NULL DEFAULT '',
 payload jsonb NOT NULL DEFAULT '{}',
 created_by uuid REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id, seq)
);

CREATE TABLE app.abap_fsd_agent_tool_call (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES app.abap_fsd_agent_session(id),
 turn_id uuid NOT NULL REFERENCES app.abap_fsd_agent_turn(id),
 name text NOT NULL,
 arguments jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL CHECK(status IN ('ok','error','denied')),
 result_summary text NOT NULL DEFAULT '',
 duration_ms integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX abap_fsd_agent_tool_call_turn ON app.abap_fsd_agent_tool_call(turn_id, created_at);

CREATE TABLE app.abap_fsd_agent_document (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES app.abap_fsd_agent_session(id),
 turn_id uuid REFERENCES app.abap_fsd_agent_turn(id),
 version integer NOT NULL CHECK(version > 0),
 markdown text NOT NULL,
 changes jsonb NOT NULL DEFAULT '[]',
 comparison jsonb NOT NULL DEFAULT '{}',
 labels text[] NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id, version)
);

CREATE TABLE app.abap_fsd_agent_comment (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES app.abap_fsd_agent_session(id),
 anchor_text text NOT NULL,
 anchor_version integer NOT NULL CHECK(anchor_version > 0),
 body text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 replies jsonb NOT NULL DEFAULT '[]',
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
CREATE INDEX abap_fsd_agent_comment_session ON app.abap_fsd_agent_comment(session_id, created_at);

CREATE TABLE app.abap_fsd_agent_attachment (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES app.abap_fsd_agent_session(id),
 file_name text NOT NULL,
 size integer NOT NULL CHECK(size >= 0),
 storage_key text NOT NULL,
 parse_state text NOT NULL,
 extracted_text text NOT NULL DEFAULT '',
 warnings jsonb NOT NULL DEFAULT '[]',
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT,INSERT,UPDATE ON app.abap_fsd_agent_session, app.abap_fsd_agent_turn, app.abap_fsd_agent_comment TO sap_workbench_app;
GRANT SELECT,INSERT ON app.abap_fsd_agent_message, app.abap_fsd_agent_tool_call, app.abap_fsd_agent_attachment TO sap_workbench_app;
GRANT SELECT,INSERT,UPDATE(labels) ON app.abap_fsd_agent_document TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve abap-fsd-agent sessions; use forward repair.'; END $$;
