-- Up Migration
-- audit: comments on assistant runs and published optimization proposals.
CREATE TABLE app.audit_comment (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 target_type text NOT NULL CHECK(target_type IN ('abap_fsd_agent_turn')),
 target_id uuid NOT NULL,
 body text NOT NULL CHECK(length(btrim(body)) > 0),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE INDEX audit_comment_target ON app.audit_comment(organization_id, target_type, target_id, created_at);
CREATE INDEX audit_comment_time ON app.audit_comment(organization_id, created_at DESC);

-- Written by scripts/maintenance/publish-proposal.mjs (Claude Code), read by the audit page.
CREATE TABLE app.audit_proposal (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 title text NOT NULL CHECK(length(btrim(title)) > 0),
 markdown text NOT NULL,
 period_from timestamptz,
 period_to timestamptz,
 sources jsonb NOT NULL DEFAULT '{}',
 author text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_proposal_time ON app.audit_proposal(organization_id, created_at DESC);

GRANT SELECT ON app.audit_event TO sap_workbench_app;
GRANT SELECT,INSERT,UPDATE(deleted_at) ON app.audit_comment TO sap_workbench_app;
GRANT SELECT,INSERT ON app.audit_proposal TO sap_workbench_app;
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Preserve audit comments and proposals; use forward repair.'; END $$;
