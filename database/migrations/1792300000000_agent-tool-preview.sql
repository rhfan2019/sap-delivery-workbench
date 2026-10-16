-- Up Migration
-- The run steps show a readable preview of each tool result (query rows, found objects, the SAP
-- error message) instead of raw JSON; see docs/specs/agent-conversation-ux.md 4.4.
ALTER TABLE app.abap_fsd_agent_tool_call ADD COLUMN preview jsonb;
ALTER TABLE app.abap_dev_agent_tool_call ADD COLUMN preview jsonb;
-- Down Migration
ALTER TABLE app.abap_dev_agent_tool_call DROP COLUMN preview;
ALTER TABLE app.abap_fsd_agent_tool_call DROP COLUMN preview;
