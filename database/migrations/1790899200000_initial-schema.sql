-- Up Migration
-- Source: database design V0.1, approved for execution on 2026-10-02.
CREATE SCHEMA app;

CREATE TABLE app.organization (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(32) NOT NULL UNIQUE,
    name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
    status varchar(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
    CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')
);

CREATE TABLE app.app_user (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    login_name varchar(64) NOT NULL UNIQUE,
    display_name varchar(100) NOT NULL CHECK (length(btrim(display_name)) > 0),
    email varchar(254),
    status varchar(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
    CHECK (login_name ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
);

CREATE TABLE app.user_password (
    user_id uuid PRIMARY KEY REFERENCES app.app_user(id) ON DELETE RESTRICT,
    password_hash text NOT NULL CHECK (length(password_hash) > 0),
    must_change_password boolean NOT NULL DEFAULT true,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);

CREATE TABLE app.organization_member (
    organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES app.app_user(id) ON DELETE RESTRICT,
    status varchar(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    joined_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
    PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX ix_organization_member_user
    ON app.organization_member(user_id, organization_id);

CREATE TABLE app.customer (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
    code varchar(32) NOT NULL,
    name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
    customer_kind varchar(16) NOT NULL DEFAULT 'external'
        CHECK (customer_kind IN ('external', 'self')),
    status varchar(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    description text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
    UNIQUE (organization_id, code),
    UNIQUE (organization_id, id),
    CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')
);
CREATE UNIQUE INDEX ux_customer_self
    ON app.customer(organization_id) WHERE customer_kind = 'self';

CREATE TABLE app.project (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
    customer_id uuid NOT NULL,
    code varchar(32) NOT NULL,
    name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
    project_type varchar(24) NOT NULL DEFAULT 'implementation'
        CHECK (project_type IN
            ('implementation', 'rollout', 'enhancement', 'support', 'migration', 'other')),
    status varchar(16) NOT NULL DEFAULT 'preparing'
        CHECK (status IN ('preparing', 'active', 'completed', 'archived')),
    is_paused boolean NOT NULL DEFAULT false,
    planned_start_date date,
    planned_end_date date,
    description text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
    UNIQUE (organization_id, code),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, customer_id)
        REFERENCES app.customer(organization_id, id) ON DELETE RESTRICT,
    CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CHECK (planned_start_date IS NULL OR planned_end_date IS NULL
           OR planned_end_date >= planned_start_date),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    CHECK (NOT is_paused OR status IN ('preparing', 'active'))
);
CREATE INDEX ix_project_customer ON app.project(organization_id, customer_id);
CREATE INDEX ix_project_status_updated
    ON app.project(organization_id, status, updated_at DESC, id DESC);

CREATE TABLE app.project_member (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'removed')),
    joined_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
    PRIMARY KEY (organization_id, project_id, user_id),
    FOREIGN KEY (organization_id, project_id)
        REFERENCES app.project(organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, user_id)
        REFERENCES app.organization_member(organization_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX ix_project_member_user_all
    ON app.project_member(organization_id, user_id);
CREATE INDEX ix_project_member_user_active
    ON app.project_member(organization_id, user_id, project_id) WHERE status = 'active';

CREATE TABLE app.auth_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    issued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    idle_expires_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    FOREIGN KEY (organization_id, user_id)
        REFERENCES app.organization_member(organization_id, user_id) ON DELETE RESTRICT,
    CHECK (expires_at > issued_at),
    CHECK (last_seen_at >= issued_at AND last_seen_at < expires_at),
    CHECK (idle_expires_at > last_seen_at AND idle_expires_at <= expires_at),
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);
CREATE INDEX ix_auth_session_user ON app.auth_session(user_id, organization_id);
CREATE INDEX ix_auth_session_member ON app.auth_session(organization_id, user_id);
CREATE INDEX ix_auth_session_expiry ON app.auth_session(expires_at);

CREATE TABLE app.login_throttle (
    scope varchar(16) NOT NULL CHECK (scope IN ('login_name', 'ip')),
    key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
    window_started_at timestamptz NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    blocked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope, key_hash)
);
CREATE INDEX ix_login_throttle_updated ON app.login_throttle(updated_at);

CREATE TABLE app.audit_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid,
    actor_user_id uuid,
    action varchar(64) NOT NULL CHECK (length(btrim(action)) > 0),
    outcome varchar(16) NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
    subject_type varchar(64),
    subject_id uuid,
    request_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    CHECK ((subject_type IS NULL) = (subject_id IS NULL))
);
CREATE INDEX ix_audit_event_org_time
    ON app.audit_event(organization_id, occurred_at DESC, id DESC);
CREATE INDEX ix_audit_event_request ON app.audit_event(request_id);
CREATE INDEX ix_audit_event_time ON app.audit_event(occurred_at);

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Initial schema is forward-only; restore a verified backup instead of dropping business tables.'; END $$;
