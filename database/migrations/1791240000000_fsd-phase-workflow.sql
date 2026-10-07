-- Up Migration
ALTER TABLE app.fsd_agent_run ADD COLUMN lease_until timestamptz;
ALTER TABLE app.fsd_agent_run ADD COLUMN lease_owner uuid;
ALTER TABLE app.fsd_agent_session ADD COLUMN workflow jsonb NOT NULL DEFAULT '{"phase":"analysis","version":"1","activeRevisionId":null,"draftApproval":null,"finalApproval":null,"baselineId":null}';
ALTER TABLE app.fsd_agent_revision ADD COLUMN kind text NOT NULL DEFAULT 'draft' CHECK (kind IN ('draft','final'));
ALTER TABLE app.fsd_agent_revision ALTER COLUMN run_id DROP NOT NULL;
CREATE TABLE app.fsd_agent_workflow_event (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES app.fsd_agent_session(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, request_hash text NOT NULL, actor_id uuid NOT NULL REFERENCES app.app_user(id),
 command text NOT NULL, previous_state jsonb NOT NULL, resulting_state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(conversation_id,request_id)
);
UPDATE app.fsd_agent_session s SET workflow=s.workflow || jsonb_build_object('phase','draft_review','activeRevisionId',r.id,'activeRevision',r.revision,'activeContentHash',r.content_hash)
FROM (SELECT DISTINCT ON (conversation_id) * FROM app.fsd_agent_revision ORDER BY conversation_id,revision DESC) r
WHERE r.conversation_id=s.id AND COALESCE(s.selection->>'workspaceStage','design') <> 'development';
GRANT SELECT,INSERT ON app.fsd_agent_workflow_event TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve workflow audit history; use forward repair.'; END $$;
