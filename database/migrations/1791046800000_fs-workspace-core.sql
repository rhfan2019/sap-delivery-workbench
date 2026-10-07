-- Up Migration
CREATE TABLE app.fs_template_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES app.organization(id),
 template_key text NOT NULL, version text NOT NULL, schema_version text NOT NULL,
 slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array'), ruleset_version text NOT NULL, renderer_version text NOT NULL, hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,template_key,version), UNIQUE(organization_id,id)
);
CREATE TABLE app.fs_workspace (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, item_id uuid NOT NULL,
 fs_number text NOT NULL, profile text NOT NULL CHECK(profile IN ('report','interface','enhancement','batch','tool','form')),
 template_version_id uuid NOT NULL, draft_head uuid, review_head uuid, baseline_head uuid,
 row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0), active boolean NOT NULL DEFAULT true,
 legacy_source_id uuid, legacy_imported_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,item_id) REFERENCES app.development_item(organization_id,project_id,id),
 FOREIGN KEY(organization_id,template_version_id) REFERENCES app.fs_template_version(organization_id,id)
);
CREATE UNIQUE INDEX fs_workspace_active_item ON app.fs_workspace(item_id) WHERE active;
CREATE TABLE app.fs_document_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 seq bigint NOT NULL CHECK(seq BETWEEN 1 AND 9007199254740991), formal_number integer CHECK(formal_number>0), parent_id uuid,
 template_version_id uuid NOT NULL, ast jsonb NOT NULL, entity_manifest jsonb NOT NULL, evidence_manifest jsonb NOT NULL,
 content_hash text NOT NULL, legacy_manifest jsonb, created_by uuid NOT NULL REFERENCES app.app_user(id), origin_run_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,seq), UNIQUE(workspace_id,formal_number), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id),
 FOREIGN KEY(organization_id,template_version_id) REFERENCES app.fs_template_version(organization_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,parent_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id)
);
ALTER TABLE app.fs_workspace ADD FOREIGN KEY(organization_id,project_id,id,draft_head) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id);
ALTER TABLE app.fs_workspace ADD FOREIGN KEY(organization_id,project_id,id,review_head) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id);
ALTER TABLE app.fs_workspace ADD FOREIGN KEY(organization_id,project_id,id,baseline_head) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id);
CREATE TABLE app.fs_session (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 title text NOT NULL, created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 UNIQUE(organization_id,project_id,workspace_id,id), FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id)
);
CREATE INDEX fs_session_cursor ON app.fs_session(workspace_id,created_at,id);
CREATE TABLE app.fs_message (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, session_id uuid NOT NULL,
 seq bigint NOT NULL CHECK(seq>0), client_message_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('user','assistant','system_notice')), body text NOT NULL,
 source_selection jsonb, created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,seq), UNIQUE(session_id,client_message_id), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,session_id) REFERENCES app.fs_session(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_attachment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 client_upload_id uuid NOT NULL, source_file_id uuid REFERENCES app.development_file(id), blob_key text NOT NULL, hash text NOT NULL,
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880), mime text NOT NULL, name text NOT NULL,
 scan_status text NOT NULL CHECK(scan_status IN ('quarantined','clean','rejected','failed')), created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,client_upload_id), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id)
);
CREATE TABLE app.fs_parse_result (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, attachment_id uuid NOT NULL,
 parser_version text NOT NULL, revision bigint NOT NULL CHECK(revision>0), state text NOT NULL CHECK(state IN ('complete','partial','failed')),
 regions jsonb NOT NULL, coverage jsonb NOT NULL, warnings jsonb NOT NULL, hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(attachment_id,parser_version,revision), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,attachment_id) REFERENCES app.fs_attachment(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 source_kind text NOT NULL, source_id uuid NOT NULL, source_revision text NOT NULL, locator text NOT NULL, conclusion text NOT NULL,
 target_binding jsonb, scope text NOT NULL, hash text NOT NULL, receipt_id uuid, expires_at timestamptz, limitations jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id)
);
CREATE TABLE app.fs_entity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 stable_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('requirement','rule','decision','issue','verification')), head_revision bigint,
 UNIQUE(workspace_id,stable_id), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id)
);
CREATE TABLE app.fs_entity_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, entity_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), payload jsonb NOT NULL, content_hash text NOT NULL, created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,workspace_id,entity_id,revision), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,entity_id) REFERENCES app.fs_entity(organization_id,project_id,workspace_id,id)
);
ALTER TABLE app.fs_entity ADD FOREIGN KEY(organization_id,project_id,workspace_id,id,head_revision) REFERENCES app.fs_entity_revision(organization_id,project_id,workspace_id,entity_id,revision);
CREATE TABLE app.fs_dependency (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 source_entity uuid NOT NULL, source_revision bigint NOT NULL, target_entity uuid NOT NULL, target_revision bigint NOT NULL,
 relation text NOT NULL CHECK(relation IN ('supports','depends_on','implements','tests')),
 UNIQUE(workspace_id,source_entity,source_revision,target_entity,target_revision,relation),
 FOREIGN KEY(organization_id,project_id,workspace_id,source_entity,source_revision) REFERENCES app.fs_entity_revision(organization_id,project_id,workspace_id,entity_id,revision),
 FOREIGN KEY(organization_id,project_id,workspace_id,target_entity,target_revision) REFERENCES app.fs_entity_revision(organization_id,project_id,workspace_id,entity_id,revision)
);
CREATE INDEX fs_dependency_reverse ON app.fs_dependency(workspace_id,target_entity,target_revision);
CREATE TABLE app.fs_context_snapshot (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 version_manifest jsonb NOT NULL, message_range jsonb NOT NULL, config_versions jsonb NOT NULL, input_hash text NOT NULL, token_budget integer NOT NULL CHECK(token_budget>0), coverage jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id)
);
CREATE TABLE app.fs_confirmation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 subject_id uuid NOT NULL, subject_revision bigint NOT NULL, subject_hash text NOT NULL,
 action text NOT NULL CHECK(action IN ('confirm','reject','invalidate')), supersedes_id uuid, actor_id uuid NOT NULL REFERENCES app.app_user(id), context_snapshot_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,subject_id,subject_revision) REFERENCES app.fs_entity_revision(organization_id,project_id,workspace_id,entity_id,revision),
 FOREIGN KEY(organization_id,project_id,workspace_id,context_snapshot_id) REFERENCES app.fs_context_snapshot(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,supersedes_id) REFERENCES app.fs_confirmation(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_change_set (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 base_revision_id uuid NOT NULL, proposal jsonb NOT NULL, hash text NOT NULL, status text NOT NULL CHECK(status IN ('proposed','accepted','rejected','stale')), result_revision_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,workspace_id,id),
 CHECK((status='accepted')=(result_revision_id IS NOT NULL)),
 FOREIGN KEY(organization_id,project_id,workspace_id,base_revision_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,result_revision_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, session_id uuid,
 input_snapshot_id uuid NOT NULL, principal_user_id uuid NOT NULL REFERENCES app.app_user(id), principal_session_id uuid NOT NULL,
 intent text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','waiting_user','waiting_evidence','failed','cancel_requested','cancelled','completed')),
 node_id text NOT NULL, attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0), lease_owner text, lease_until timestamptz, fencing bigint NOT NULL DEFAULT 0,
 cancel_epoch bigint NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), budget_json jsonb NOT NULL, is_write boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,session_id) REFERENCES app.fs_session(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,input_snapshot_id) REFERENCES app.fs_context_snapshot(organization_id,project_id,workspace_id,id)
);
CREATE INDEX fs_run_claim ON app.fs_run(status,next_attempt_at);
CREATE UNIQUE INDEX fs_run_one_writer ON app.fs_run(workspace_id) WHERE is_write AND status IN ('running','cancel_requested');
ALTER TABLE app.fs_document_revision ADD FOREIGN KEY(organization_id,project_id,workspace_id,origin_run_id) REFERENCES app.fs_run(organization_id,project_id,workspace_id,id);
CREATE TABLE app.fs_run_checkpoint (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, run_id uuid NOT NULL,
 node_id text NOT NULL, attempt integer NOT NULL CHECK(attempt>=0), input_hash text NOT NULL, output_refs jsonb NOT NULL, fencing bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,node_id,attempt,input_hash), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,run_id) REFERENCES app.fs_run(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_run_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, run_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991), event_id uuid NOT NULL UNIQUE, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,sequence),
 FOREIGN KEY(organization_id,project_id,workspace_id,run_id) REFERENCES app.fs_run(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_command_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES app.app_user(id), action text NOT NULL, key uuid NOT NULL, request_hash text NOT NULL, status text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,actor_id,action,key), FOREIGN KEY(organization_id,project_id,workspace_id) REFERENCES app.fs_workspace(organization_id,project_id,id)
);
CREATE TABLE app.fs_review (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, document_revision_id uuid NOT NULL,
 document_hash text NOT NULL, ruleset_version text NOT NULL, evidence_manifest_hash text NOT NULL, kind text NOT NULL CHECK(kind IN ('rule','ai','human')), findings jsonb NOT NULL, coverage jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,document_revision_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_review_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, document_revision_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('open','returned','approved','closed')), policy_version text NOT NULL, created_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,workspace_id,id), FOREIGN KEY(organization_id,project_id,workspace_id,document_revision_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id)
);
CREATE UNIQUE INDEX fs_review_active ON app.fs_review_request(workspace_id) WHERE state='open';
CREATE TABLE app.fs_approval (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, review_request_id uuid NOT NULL, document_revision_id uuid NOT NULL,
 document_hash text NOT NULL, manifest_hash text NOT NULL, policy_version text NOT NULL, role text NOT NULL CHECK(role IN ('business_approver','technical_reviewer')),
 actor_id uuid NOT NULL REFERENCES app.app_user(id), action text NOT NULL CHECK(action IN ('approve','reject')), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,workspace_id,review_request_id) REFERENCES app.fs_review_request(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,document_revision_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_project_role (
 organization_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('business_approver','technical_reviewer','publisher')), enabled boolean NOT NULL, row_version bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,project_id,user_id,role), FOREIGN KEY(organization_id,project_id,user_id) REFERENCES app.project_member(organization_id,project_id,user_id)
);
CREATE TABLE app.fs_export (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, document_revision_id uuid NOT NULL,
 format text NOT NULL CHECK(format IN ('docx','pdf')), manifest_hash text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','ready','failed')),
 blob_key text, hash text, requested_by uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,document_revision_id,format,manifest_hash), CHECK(status<>'ready' OR (blob_key IS NOT NULL AND hash IS NOT NULL)),
 FOREIGN KEY(organization_id,project_id,workspace_id,document_revision_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id)
);
CREATE TABLE app.fs_publication (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL, document_revision_id uuid NOT NULL, previous_id uuid,
 actor_id uuid NOT NULL REFERENCES app.app_user(id), created_at timestamptz NOT NULL DEFAULT now(), action text NOT NULL CHECK(action IN ('publish','withdraw')),
 UNIQUE(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,document_revision_id) REFERENCES app.fs_document_revision(organization_id,project_id,workspace_id,id),
 FOREIGN KEY(organization_id,project_id,workspace_id,previous_id) REFERENCES app.fs_publication(organization_id,project_id,workspace_id,id)
);
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'FS history is append-only; restore a reviewed backup or apply a forward repair.'; END $$;
