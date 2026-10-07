-- Up Migration
ALTER TABLE app.fsd_agent_session ADD COLUMN context jsonb NOT NULL DEFAULT '{}';
ALTER TABLE app.fsd_agent_session ADD COLUMN cleared_at timestamptz;
CREATE INDEX fsd_session_work_scope ON app.fsd_agent_session(organization_id,actor_id,(selection->>'projectId'),(selection->>'itemId'),(selection->>'workspaceStage')) WHERE cleared_at IS NULL;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve conversation context; use forward repair.'; END $$;
