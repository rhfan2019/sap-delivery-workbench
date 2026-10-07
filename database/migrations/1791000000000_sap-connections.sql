-- Up Migration
CREATE TABLE app.sap_system (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 code varchar(32) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
 name varchar(200) NOT NULL CHECK (length(btrim(name))>0),
 owner_customer_id uuid,
 sap_url varchar(2048) NOT NULL,
 language varchar(2) NOT NULL DEFAULT 'EN' CHECK (language ~ '^[A-Z]{2}$'),
 status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version>0),
 UNIQUE (organization_id,id), UNIQUE (organization_id,code),
 FOREIGN KEY (organization_id,owner_customer_id) REFERENCES app.customer(organization_id,id)
);
CREATE TABLE app.sap_system_grant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 system_id uuid NOT NULL, customer_id uuid NOT NULL,
 expires_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version>0),
 UNIQUE (organization_id,system_id,customer_id),
 FOREIGN KEY (organization_id,system_id) REFERENCES app.sap_system(organization_id,id),
 FOREIGN KEY (organization_id,customer_id) REFERENCES app.customer(organization_id,id)
);
CREATE TABLE app.project_sap_config (
 organization_id uuid NOT NULL, project_id uuid NOT NULL,
 environment varchar(3) NOT NULL CHECK (environment IN ('DEV','QAS','PRD')),
 system_id uuid, client varchar(3) CHECK (client ~ '^\d{3}$'),
 username varchar(128), language varchar(2) CHECK (language ~ '^[A-Z]{2}$'),
 password_mode varchar(8) NOT NULL DEFAULT 'none' CHECK (password_mode IN ('none','override')),
 password_cipher text, credential_binding varchar(64),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id,project_id,environment),
 FOREIGN KEY (organization_id,project_id) REFERENCES app.project(organization_id,id),
 FOREIGN KEY (organization_id,system_id) REFERENCES app.sap_system(organization_id,id),
 CHECK ((password_mode='override')=(password_cipher IS NOT NULL)),
 CHECK ((password_cipher IS NULL)=(credential_binding IS NULL))
);
CREATE TABLE app.user_project_sap_config (
 organization_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL,
 environment varchar(3) NOT NULL CHECK (environment IN ('DEV','QAS','PRD')),
 system_id uuid, client varchar(3) CHECK (client ~ '^\d{3}$'),
 username varchar(128), language varchar(2) CHECK (language ~ '^[A-Z]{2}$'),
 password_mode varchar(8) NOT NULL DEFAULT 'inherit' CHECK (password_mode IN ('inherit','none','override')),
 password_cipher text, credential_binding varchar(64),
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id,project_id,user_id,environment),
 FOREIGN KEY (organization_id,project_id,user_id) REFERENCES app.project_member(organization_id,project_id,user_id),
 FOREIGN KEY (organization_id,system_id) REFERENCES app.sap_system(organization_id,id),
 CHECK ((password_mode='override')=(password_cipher IS NOT NULL)),
 CHECK ((password_cipher IS NULL)=(credential_binding IS NULL))
);
CREATE INDEX ix_project_sap_system ON app.project_sap_config(organization_id,system_id);
CREATE INDEX ix_user_sap_system ON app.user_project_sap_config(organization_id,system_id);
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'SAP credentials require a reviewed forward migration; do not drop live configuration.'; END $$;
