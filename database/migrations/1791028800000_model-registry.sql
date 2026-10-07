-- Up Migration
CREATE TABLE app.llm_credential (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES app.organization(id),
 secret_cipher text NOT NULL, created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,id)
);
CREATE TABLE app.llm_model (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES app.organization(id),
 latest_version_id uuid, row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,id)
);
CREATE TABLE app.llm_model_version (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, model_id uuid NOT NULL,
 version_no bigint NOT NULL CHECK(version_no>0),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
 credential_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,model_id,id), UNIQUE(model_id,version_no),
 FOREIGN KEY(organization_id,model_id) REFERENCES app.llm_model(organization_id,id),
 FOREIGN KEY(organization_id,credential_id) REFERENCES app.llm_credential(organization_id,id)
);
ALTER TABLE app.llm_model ADD CONSTRAINT fk_llm_latest FOREIGN KEY(organization_id,id,latest_version_id)
 REFERENCES app.llm_model_version(organization_id,model_id,id);
CREATE TABLE app.llm_default (
 organization_id uuid PRIMARY KEY REFERENCES app.organization(id),
 model_id uuid NOT NULL, version_id uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(organization_id,model_id,version_id) REFERENCES app.llm_model_version(organization_id,model_id,id)
);
CREATE TABLE app.llm_test_run (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, model_id uuid NOT NULL, version_id uuid NOT NULL,
 status varchar(16) NOT NULL CHECK(status IN('running','passed','failed','timeout')),
 code varchar(40), safe_message varchar(300), latency_ms integer CHECK(latency_ms>=0),
 adapter_version varchar(32) NOT NULL, capabilities jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(capabilities)='array'),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at timestamptz,
 expires_at timestamptz,
 FOREIGN KEY(organization_id,model_id,version_id) REFERENCES app.llm_model_version(organization_id,model_id,id),
 CHECK((status='running')=(finished_at IS NULL)),
 CHECK(status<>'passed' OR expires_at IS NOT NULL)
);
CREATE INDEX ix_llm_models_org ON app.llm_model(organization_id,updated_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX ix_llm_versions_org ON app.llm_model_version(organization_id,model_id);
CREATE INDEX ix_llm_tests_version ON app.llm_test_run(organization_id,version_id,started_at DESC,id);
CREATE UNIQUE INDEX ux_llm_test_running ON app.llm_test_run(version_id) WHERE status='running';
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Model history is forward-only; restore a verified backup instead.'; END $$;
