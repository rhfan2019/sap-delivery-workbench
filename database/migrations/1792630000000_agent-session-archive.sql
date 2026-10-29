-- Up Migration
-- docs/guides/development-discipline.md section 5: design and development assistant
-- conversations are archived and restored, never deleted (they carry output versions and
-- audit history). An archived conversation is read-only and folded away in the switcher.
ALTER TABLE app.abap_fsd_agent_session ADD COLUMN archived_at timestamptz;
ALTER TABLE app.abap_dev_agent_session ADD COLUMN archived_at timestamptz;

-- Down Migration
ALTER TABLE app.abap_dev_agent_session DROP COLUMN archived_at;
ALTER TABLE app.abap_fsd_agent_session DROP COLUMN archived_at;
