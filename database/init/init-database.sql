-- SAP 智能交付工作台：在一个空数据库上一次建好全部结构。
-- 生成的文件，不要手工修改：npm run test:setup，再 npm run db:export-init。
-- Source hash: c4829106bc98c93dbbc067ced2eedd795df2f78bf51cc07db8d23ef85788e048
--
-- 包含：应用 schema、表、索引、约束、函数、触发器、运行账号的权限和迁移记录，
-- 之后的 npm run db:migrate 只执行后续新增的迁移。
-- 不包含：业务数据、运行账号的密码和首个管理员。接着运行 scripts/database/provision.mjs
-- 与 scripts/database/bootstrap.mjs（服务器上用 infra/production/init-database.sh 一键完成）。
--
-- 用法：psql -v ON_ERROR_STOP=1 -U <数据库所有者> -d <空数据库> -f init-database.sql
-- 全程在一个事务内，失败不留痕；数据库不是空的就拒绝执行。

BEGIN;

DO $init$
BEGIN
  IF to_regnamespace('app') IS NOT NULL OR to_regclass('public.pgmigrations') IS NOT NULL THEN
    RAISE EXCEPTION '数据库不是空的（已有 app schema 或迁移记录），已停止，没有做任何修改。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sap_workbench_app') THEN
    CREATE ROLE sap_workbench_app NOLOGIN;
  END IF;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sap_workbench_app', current_database());
END
$init$;

--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: access_check_assignment_scope(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.access_check_assignment_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE wanted text := CASE TG_TABLE_NAME WHEN 'access_assignment' THEN 'organization' ELSE 'project' END;
BEGIN
  IF (SELECT scope FROM app.access_role WHERE id = NEW.role_id) <> wanted THEN
    RAISE EXCEPTION 'Role scope does not match the assignment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: access_check_composition(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.access_check_composition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c app.access_role; m app.access_role;
BEGIN
  SELECT * INTO c FROM app.access_role WHERE id = NEW.composite_id;
  SELECT * INTO m FROM app.access_role WHERE id = NEW.member_id;
  IF c.kind <> 'composite' OR m.kind <> 'single' THEN
    RAISE EXCEPTION 'A composite role holds single roles only' USING ERRCODE = '23514';
  END IF;
  IF c.scope = 'project' AND m.scope <> 'project' THEN
    RAISE EXCEPTION 'A project composite holds project roles only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: sap_forget_member_credentials(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.sap_forget_member_credentials() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    DELETE FROM app.sap_user_credential
    WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: sap_forget_system_credentials(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.sap_forget_system_credentials() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.sap_url <> OLD.sap_url OR NEW.client <> OLD.client OR (NEW.status <> 'active' AND OLD.status = 'active') THEN
    DELETE FROM app.sap_user_credential WHERE system_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: sap_forget_user_credentials(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.sap_forget_user_credentials() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    IF TG_TABLE_NAME = 'app_user' THEN
      DELETE FROM app.sap_user_credential WHERE user_id = NEW.id;
    ELSE
      DELETE FROM app.sap_user_credential WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: abap_dev_agent_attachment; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_dev_agent_attachment (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    file_name text NOT NULL,
    size integer NOT NULL,
    storage_key text NOT NULL,
    parse_state text NOT NULL,
    extracted_text text DEFAULT ''::text NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT abap_dev_agent_attachment_size_check CHECK ((size >= 0))
);


--
-- Name: abap_dev_agent_comment; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_dev_agent_comment (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    target text NOT NULL,
    anchor_text text NOT NULL,
    anchor_version integer NOT NULL,
    anchor_line integer,
    body text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    replies jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT abap_dev_agent_comment_anchor_version_check CHECK ((anchor_version > 0)),
    CONSTRAINT abap_dev_agent_comment_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'stale'::text]))),
    CONSTRAINT abap_dev_agent_comment_target_check CHECK ((target = ANY (ARRAY['plan'::text, 'code'::text])))
);


--
-- Name: abap_dev_agent_message; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_dev_agent_message (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    turn_id uuid,
    seq integer NOT NULL,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT abap_dev_agent_message_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text]))),
    CONSTRAINT abap_dev_agent_message_seq_check CHECK ((seq > 0))
);


--
-- Name: abap_dev_agent_session; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_dev_agent_session (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    active_turn_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone
);


--
-- Name: abap_dev_agent_tool_call; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_dev_agent_tool_call (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    turn_id uuid NOT NULL,
    name text NOT NULL,
    arguments jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    result_summary text DEFAULT ''::text NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    preview jsonb,
    CONSTRAINT abap_dev_agent_tool_call_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text, 'denied'::text])))
);


--
-- Name: abap_dev_agent_turn; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_dev_agent_turn (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    status text NOT NULL,
    stop_reason text,
    model jsonb DEFAULT '{}'::jsonb NOT NULL,
    usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    error jsonb,
    created_by uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT abap_dev_agent_turn_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'interrupted'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: abap_dev_agent_version; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_dev_agent_version (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    turn_id uuid,
    version integer NOT NULL,
    plan text DEFAULT ''::text NOT NULL,
    code text DEFAULT ''::text NOT NULL,
    source text NOT NULL,
    source_ref text,
    basis jsonb DEFAULT '[]'::jsonb NOT NULL,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    comparison jsonb DEFAULT '{}'::jsonb NOT NULL,
    labels text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_at timestamp with time zone,
    finalized_by uuid,
    CONSTRAINT abap_dev_agent_version_source_check CHECK ((source = ANY (ARRAY['assistant'::text, 'upload'::text, 'sap'::text]))),
    CONSTRAINT abap_dev_agent_version_version_check CHECK ((version > 0))
);


--
-- Name: abap_fsd_agent_attachment; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_fsd_agent_attachment (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    file_name text NOT NULL,
    size integer NOT NULL,
    storage_key text NOT NULL,
    parse_state text NOT NULL,
    extracted_text text DEFAULT ''::text NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT abap_fsd_agent_attachment_size_check CHECK ((size >= 0))
);


--
-- Name: abap_fsd_agent_comment; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_fsd_agent_comment (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    anchor_text text NOT NULL,
    anchor_version integer NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    replies jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT abap_fsd_agent_comment_anchor_version_check CHECK ((anchor_version > 0)),
    CONSTRAINT abap_fsd_agent_comment_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);


--
-- Name: abap_fsd_agent_document; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_fsd_agent_document (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    turn_id uuid,
    version integer NOT NULL,
    markdown text NOT NULL,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    comparison jsonb DEFAULT '{}'::jsonb NOT NULL,
    labels text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_at timestamp with time zone,
    finalized_by uuid,
    CONSTRAINT abap_fsd_agent_document_version_check CHECK ((version > 0))
);


--
-- Name: abap_fsd_agent_message; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_fsd_agent_message (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    turn_id uuid,
    seq integer NOT NULL,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT abap_fsd_agent_message_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text]))),
    CONSTRAINT abap_fsd_agent_message_seq_check CHECK ((seq > 0))
);


--
-- Name: abap_fsd_agent_session; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_fsd_agent_session (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    active_turn_id uuid,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone
);


--
-- Name: abap_fsd_agent_tool_call; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_fsd_agent_tool_call (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    turn_id uuid NOT NULL,
    name text NOT NULL,
    arguments jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    result_summary text DEFAULT ''::text NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    preview jsonb,
    CONSTRAINT abap_fsd_agent_tool_call_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text, 'denied'::text])))
);


--
-- Name: abap_fsd_agent_turn; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.abap_fsd_agent_turn (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    status text NOT NULL,
    stop_reason text,
    model jsonb DEFAULT '{}'::jsonb NOT NULL,
    usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    error jsonb,
    created_by uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT abap_fsd_agent_turn_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'interrupted'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: access_assignment; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.access_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    project_scope character varying(12) DEFAULT 'all'::character varying NOT NULL,
    scope_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_to date,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT access_assignment_check CHECK ((((project_scope)::text = ANY ((ARRAY['customers'::character varying, 'projects'::character varying])::text[])) = (cardinality(scope_ids) > 0))),
    CONSTRAINT access_assignment_check1 CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT access_assignment_project_scope_check CHECK (((project_scope)::text = ANY ((ARRAY['all'::character varying, 'customers'::character varying, 'projects'::character varying, 'none'::character varying])::text[]))),
    CONSTRAINT access_assignment_row_version_check CHECK ((row_version > 0))
);


--
-- Name: access_position; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.access_position (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(60) NOT NULL,
    description character varying(300) DEFAULT ''::character varying NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT access_position_code_check CHECK (((code)::text ~ '^[A-Z][A-Z0-9_]{1,39}$'::text)),
    CONSTRAINT access_position_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT access_position_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT access_position_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: access_position_role; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.access_position_role (
    organization_id uuid NOT NULL,
    position_id uuid NOT NULL,
    role_id uuid NOT NULL
);


--
-- Name: access_project_role; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.access_project_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    modules text[] DEFAULT '{}'::text[] NOT NULL,
    own_only boolean DEFAULT false NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_to date,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT access_project_role_check CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT access_project_role_row_version_check CHECK ((row_version > 0))
);


--
-- Name: access_role; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.access_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(60) NOT NULL,
    description character varying(300) DEFAULT ''::character varying NOT NULL,
    kind character varying(10) NOT NULL,
    scope character varying(12) NOT NULL,
    built_in boolean DEFAULT false NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT access_role_code_check CHECK (((code)::text ~ '^[A-Z][A-Z0-9_]{1,39}$'::text)),
    CONSTRAINT access_role_kind_check CHECK (((kind)::text = ANY ((ARRAY['single'::character varying, 'composite'::character varying])::text[]))),
    CONSTRAINT access_role_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT access_role_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT access_role_scope_check CHECK (((scope)::text = ANY ((ARRAY['organization'::character varying, 'project'::character varying])::text[]))),
    CONSTRAINT access_role_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: access_role_composition; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.access_role_composition (
    organization_id uuid NOT NULL,
    composite_id uuid NOT NULL,
    member_id uuid NOT NULL,
    CONSTRAINT access_role_composition_check CHECK ((composite_id <> member_id))
);


--
-- Name: access_role_permission; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.access_role_permission (
    organization_id uuid NOT NULL,
    role_id uuid NOT NULL,
    permission character varying(60) NOT NULL,
    CONSTRAINT access_role_permission_permission_check CHECK (((permission)::text ~ '^[a-z][a-z_.]*:[a-z]+$'::text))
);


--
-- Name: app_user; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.app_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    login_name character varying(64) NOT NULL,
    display_name character varying(100) NOT NULL,
    email character varying(254),
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    position_id uuid,
    person_type character varying(16) DEFAULT 'employee'::character varying NOT NULL,
    skill_modules text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT app_user_display_name_check CHECK ((length(btrim((display_name)::text)) > 0)),
    CONSTRAINT app_user_login_name_check CHECK (((login_name)::text ~ '^[a-z0-9][a-z0-9._-]{2,63}$'::text)),
    CONSTRAINT app_user_person_type_check CHECK (((person_type)::text = ANY ((ARRAY['employee'::character varying, 'subcontractor'::character varying, 'external'::character varying])::text[]))),
    CONSTRAINT app_user_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT app_user_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::text[])))
);


--
-- Name: audit_comment; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.audit_comment (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    body text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT audit_comment_body_check CHECK ((length(btrim(body)) > 0)),
    CONSTRAINT audit_comment_target_type_check CHECK ((target_type = 'abap_fsd_agent_turn'::text))
);


--
-- Name: audit_event; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.audit_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    actor_user_id uuid,
    action character varying(64) NOT NULL,
    outcome character varying(16) NOT NULL,
    subject_type character varying(64),
    subject_id uuid,
    request_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT audit_event_action_check CHECK ((length(btrim((action)::text)) > 0)),
    CONSTRAINT audit_event_check CHECK (((subject_type IS NULL) = (subject_id IS NULL))),
    CONSTRAINT audit_event_details_check CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT audit_event_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['success'::character varying, 'failure'::character varying, 'denied'::character varying])::text[])))
);


--
-- Name: audit_proposal; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.audit_proposal (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    markdown text NOT NULL,
    period_from timestamp with time zone,
    period_to timestamp with time zone,
    sources jsonb DEFAULT '{}'::jsonb NOT NULL,
    author text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_proposal_title_check CHECK ((length(btrim(title)) > 0))
);


--
-- Name: auth_session; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.auth_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    issued_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    idle_expires_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT auth_session_check CHECK ((expires_at > issued_at)),
    CONSTRAINT auth_session_check1 CHECK (((last_seen_at >= issued_at) AND (last_seen_at < expires_at))),
    CONSTRAINT auth_session_check2 CHECK (((idle_expires_at > last_seen_at) AND (idle_expires_at <= expires_at))),
    CONSTRAINT auth_session_check3 CHECK (((revoked_at IS NULL) OR (revoked_at >= issued_at))),
    CONSTRAINT auth_session_token_hash_check CHECK ((octet_length(token_hash) = 32))
);


--
-- Name: customer; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.customer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(200) NOT NULL,
    customer_kind character varying(16) DEFAULT 'external'::character varying NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT customer_code_check CHECK (((code)::text ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'::text)),
    CONSTRAINT customer_customer_kind_check CHECK (((customer_kind)::text = ANY ((ARRAY['external'::character varying, 'self'::character varying])::text[]))),
    CONSTRAINT customer_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT customer_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT customer_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: development_event; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    action character varying(50) NOT NULL,
    changes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: development_field; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_field (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    label character varying(50) NOT NULL,
    field_type character varying(20) NOT NULL,
    options jsonb DEFAULT '[]'::jsonb NOT NULL,
    group_key character varying(20) DEFAULT 'custom'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    required boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT development_field_field_type_check CHECK (((field_type)::text = ANY ((ARRAY['text'::character varying, 'long_text'::character varying, 'number'::character varying, 'date'::character varying, 'select'::character varying, 'multi_select'::character varying, 'member'::character varying, 'checkbox'::character varying, 'url'::character varying])::text[]))),
    CONSTRAINT development_field_group_key_check CHECK (((group_key)::text = ANY ((ARRAY['basic'::character varying, 'fsd'::character varying, 'development'::character varying, 'consultant_test'::character varying, 'user_test'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT development_field_label_check CHECK ((length(btrim((label)::text)) > 0)),
    CONSTRAINT development_field_options_check CHECK ((jsonb_typeof(options) = 'array'::text))
);


--
-- Name: development_file; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_file (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    size integer NOT NULL,
    checksum character varying(64) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT development_file_size_check CHECK (((size >= 1) AND (size <= 5242880)))
);


--
-- Name: development_item; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_no integer NOT NULL,
    code character varying(5) GENERATED ALWAYS AS (lpad((item_no)::text, 5, '0'::text)) STORED,
    module character varying(16) NOT NULL,
    kind character varying(20) NOT NULL,
    name character varying(200) NOT NULL,
    business_function text DEFAULT ''::text NOT NULL,
    priority character varying(10) DEFAULT 'medium'::character varying NOT NULL,
    difficulty character varying(10) DEFAULT 'medium'::character varying NOT NULL,
    change_type character varying(20) DEFAULT 'new'::character varying NOT NULL,
    registered_on date DEFAULT CURRENT_DATE NOT NULL,
    business_owner character varying(100) DEFAULT ''::character varying NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    transaction_code character varying(200) DEFAULT ''::character varying NOT NULL,
    custom_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    sap_system_id uuid,
    CONSTRAINT development_item_change_type_check CHECK (((change_type)::text = ANY ((ARRAY['new'::character varying, 'rebuild'::character varying, 'optimize'::character varying])::text[]))),
    CONSTRAINT development_item_custom_values_check CHECK ((jsonb_typeof(custom_values) = 'object'::text)),
    CONSTRAINT development_item_difficulty_check CHECK (((difficulty)::text = ANY ((ARRAY['hard'::character varying, 'medium'::character varying, 'easy'::character varying])::text[]))),
    CONSTRAINT development_item_item_no_check CHECK (((item_no >= 1) AND (item_no <= 99999))),
    CONSTRAINT development_item_kind_check CHECK (((kind)::text = ANY ((ARRAY['report'::character varying, 'function'::character varying, 'interface'::character varying, 'enhancement'::character varying])::text[]))),
    CONSTRAINT development_item_module_check CHECK ((length(btrim((module)::text)) > 0)),
    CONSTRAINT development_item_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT development_item_priority_check CHECK (((priority)::text = ANY ((ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying])::text[])))
);


--
-- Name: development_item_object; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_item_object (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    pgmid character varying(4) DEFAULT 'R3TR'::character varying NOT NULL,
    object_type character varying(4) NOT NULL,
    object_name character varying(120) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT development_item_object_object_name_check CHECK (((length(btrim((object_name)::text)) > 0) AND ((object_name)::text = upper((object_name)::text)))),
    CONSTRAINT development_item_object_object_type_check CHECK (((object_type)::text ~ '^[A-Z0-9]{4}$'::text)),
    CONSTRAINT development_item_object_pgmid_check CHECK (((pgmid)::text ~ '^[A-Z0-9]{4}$'::text))
);


--
-- Name: development_item_phase; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_item_phase (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    phase character varying(20) NOT NULL,
    assignee_id uuid,
    effort_days numeric(5,1),
    planned_start date,
    planned_end date,
    actual_end date,
    progress smallint DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'not_started'::character varying NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    actual_start date,
    baseline_end date,
    CONSTRAINT development_item_phase_check CHECK (((effort_days IS NULL) OR ((phase)::text = ANY ((ARRAY['fsd'::character varying, 'development'::character varying])::text[])))),
    CONSTRAINT development_item_phase_check1 CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start))),
    CONSTRAINT development_item_phase_check2 CHECK ((((status)::text <> 'completed'::text) OR (progress = 100))),
    CONSTRAINT development_item_phase_effort_days_check CHECK ((effort_days >= (0)::numeric)),
    CONSTRAINT development_item_phase_phase_check CHECK (((phase)::text = ANY ((ARRAY['fsd'::character varying, 'development'::character varying, 'consultant_test'::character varying, 'user_test'::character varying])::text[]))),
    CONSTRAINT development_item_phase_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT development_item_phase_status_check CHECK (((status)::text = ANY ((ARRAY['not_started'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'delayed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: development_item_tag; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_item_tag (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: development_phase_transition; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_phase_transition (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_id uuid NOT NULL,
    phase character varying(20) NOT NULL,
    from_status character varying(20),
    to_status character varying(20) NOT NULL,
    actor_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL,
    backfilled boolean DEFAULT false NOT NULL,
    CONSTRAINT development_phase_transition_phase_check CHECK (((phase)::text = ANY ((ARRAY['fsd'::character varying, 'development'::character varying, 'consultant_test'::character varying, 'user_test'::character varying])::text[])))
);


--
-- Name: development_phase_transition_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.development_phase_transition ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME app.development_phase_transition_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: development_tag; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.development_tag (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name character varying(30) NOT NULL,
    color character varying(16) DEFAULT 'gray'::character varying NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT development_tag_color_check CHECK (((color)::text = ANY ((ARRAY['gray'::character varying, 'blue'::character varying, 'green'::character varying, 'orange'::character varying, 'red'::character varying, 'purple'::character varying, 'teal'::character varying, 'yellow'::character varying])::text[]))),
    CONSTRAINT development_tag_name_check CHECK ((length(btrim((name)::text)) > 0))
);


--
-- Name: list_view; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.list_view (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    list_key text NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    auto_apply boolean DEFAULT true NOT NULL,
    state jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT list_view_list_key_check CHECK (((char_length(list_key) >= 1) AND (char_length(list_key) <= 80))),
    CONSTRAINT list_view_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))
);


--
-- Name: llm_credential; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.llm_credential (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    secret_cipher text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: llm_default; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.llm_default (
    organization_id uuid NOT NULL,
    model_id uuid NOT NULL,
    version_id uuid NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT llm_default_revision_check CHECK ((revision > 0))
);


--
-- Name: llm_model; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.llm_model (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    latest_version_id uuid,
    row_version bigint DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT llm_model_row_version_check CHECK ((row_version > 0))
);


--
-- Name: llm_model_version; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.llm_model_version (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    model_id uuid NOT NULL,
    version_no bigint NOT NULL,
    config jsonb NOT NULL,
    credential_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT llm_model_connection_only CHECK ((NOT (config ?| ARRAY['maxOutputTokens'::text, 'timeoutSeconds'::text, 'temperature'::text]))),
    CONSTRAINT llm_model_version_config_check CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT llm_model_version_version_no_check CHECK ((version_no > 0))
);


--
-- Name: llm_test_run; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.llm_test_run (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    model_id uuid NOT NULL,
    version_id uuid NOT NULL,
    status character varying(16) NOT NULL,
    code character varying(40),
    safe_message character varying(300),
    latency_ms integer,
    adapter_version character varying(32) NOT NULL,
    capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    finished_at timestamp with time zone,
    expires_at timestamp with time zone,
    CONSTRAINT llm_test_run_capabilities_check CHECK ((jsonb_typeof(capabilities) = 'array'::text)),
    CONSTRAINT llm_test_run_check CHECK ((((status)::text = 'running'::text) = (finished_at IS NULL))),
    CONSTRAINT llm_test_run_check1 CHECK ((((status)::text <> 'passed'::text) OR (expires_at IS NOT NULL))),
    CONSTRAINT llm_test_run_latency_ms_check CHECK ((latency_ms >= 0)),
    CONSTRAINT llm_test_run_status_check CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'passed'::character varying, 'failed'::character varying, 'timeout'::character varying])::text[])))
);


--
-- Name: login_throttle; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.login_throttle (
    scope character varying(16) NOT NULL,
    key_hash bytea NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    blocked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT login_throttle_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT login_throttle_key_hash_check CHECK ((octet_length(key_hash) = 32)),
    CONSTRAINT login_throttle_scope_check CHECK (((scope)::text = ANY ((ARRAY['login_name'::character varying, 'ip'::character varying])::text[])))
);


--
-- Name: organization; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.organization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(200) NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT organization_code_check CHECK (((code)::text ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'::text)),
    CONSTRAINT organization_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT organization_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT organization_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::text[])))
);


--
-- Name: organization_member; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.organization_member (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT organization_member_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT organization_member_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::text[])))
);


--
-- Name: project; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(200) NOT NULL,
    project_type character varying(24) DEFAULT 'implementation'::character varying NOT NULL,
    status character varying(16) DEFAULT 'preparing'::character varying NOT NULL,
    is_paused boolean DEFAULT false NOT NULL,
    planned_start_date date,
    planned_end_date date,
    description text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    short_name character varying(20) DEFAULT ''::character varying NOT NULL,
    methodology character varying(16) DEFAULT 'activate'::character varying NOT NULL,
    contract_role character varying(16) DEFAULT 'prime'::character varying NOT NULL,
    prime_contractor character varying(200) DEFAULT ''::character varying NOT NULL,
    sap_product character varying(20),
    sap_release character varying(60) DEFAULT ''::character varying NOT NULL,
    deployment character varying(16),
    modules text[] DEFAULT '{}'::text[] NOT NULL,
    language character varying(2) DEFAULT 'ZH'::character varying NOT NULL,
    namespace character varying(12) DEFAULT 'Z'::character varying NOT NULL,
    default_package character varying(30) DEFAULT ''::character varying NOT NULL,
    transport_method character varying(10),
    manager_id uuid,
    director_id uuid,
    architect_id uuid,
    dev_lead_id uuid,
    basis_lead_id uuid,
    contract_no character varying(60) DEFAULT ''::character varying NOT NULL,
    contract_model character varying(16),
    contract_days numeric(7,1),
    dev_budget_days numeric(7,1),
    team_size smallint,
    CONSTRAINT project_check CHECK (((planned_start_date IS NULL) OR (planned_end_date IS NULL) OR (planned_end_date >= planned_start_date))),
    CONSTRAINT project_check1 CHECK ((((status)::text = 'archived'::text) = (archived_at IS NOT NULL))),
    CONSTRAINT project_check2 CHECK (((NOT is_paused) OR ((status)::text = ANY ((ARRAY['preparing'::character varying, 'active'::character varying])::text[])))),
    CONSTRAINT project_code_check CHECK (((code)::text ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'::text)),
    CONSTRAINT project_contract_days_check CHECK ((contract_days >= (0)::numeric)),
    CONSTRAINT project_contract_model_check CHECK (((contract_model)::text = ANY ((ARRAY['fixed'::character varying, 'per_day'::character varying, 'time_material'::character varying])::text[]))),
    CONSTRAINT project_contract_role_check CHECK (((contract_role)::text = ANY ((ARRAY['prime'::character varying, 'subcontract'::character varying, 'direct'::character varying])::text[]))),
    CONSTRAINT project_default_package_check CHECK (((default_package)::text ~ '^([A-Z0-9_/$]{1,30})?$'::text)),
    CONSTRAINT project_deployment_check CHECK (((deployment)::text = ANY ((ARRAY['on_premise'::character varying, 'private_cloud'::character varying, 'public_cloud'::character varying])::text[]))),
    CONSTRAINT project_dev_budget_days_check CHECK ((dev_budget_days >= (0)::numeric)),
    CONSTRAINT project_language_check CHECK (((language)::text ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT project_methodology_check CHECK (((methodology)::text = ANY ((ARRAY['activate'::character varying, 'asap'::character varying, 'agile'::character varying, 'hybrid'::character varying])::text[]))),
    CONSTRAINT project_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT project_namespace_check CHECK (((namespace)::text ~ '^(Z|Y|/[A-Z0-9_]{1,10}/)$'::text)),
    CONSTRAINT project_project_type_check CHECK (((project_type)::text = ANY ((ARRAY['implementation'::character varying, 'rollout'::character varying, 'upgrade'::character varying, 'conversion'::character varying, 'enhancement'::character varying, 'support'::character varying, 'migration'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT project_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT project_sap_product_check CHECK (((sap_product)::text = ANY ((ARRAY['ecc'::character varying, 's4_onpremise'::character varying, 's4_private'::character varying, 's4_public'::character varying, 'bw4'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT project_status_check CHECK (((status)::text = ANY ((ARRAY['preparing'::character varying, 'active'::character varying, 'live'::character varying, 'completed'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT project_team_size_check CHECK ((team_size >= 0)),
    CONSTRAINT project_transport_method_check CHECK (((transport_method)::text = ANY ((ARRAY['charm'::character varying, 'manual'::character varying])::text[])))
);


--
-- Name: project_contact; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_contact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name character varying(60) NOT NULL,
    title character varying(60) DEFAULT ''::character varying NOT NULL,
    department character varying(60) DEFAULT ''::character varying NOT NULL,
    contact_role character varying(20) DEFAULT 'other'::character varying NOT NULL,
    modules text[] DEFAULT '{}'::text[] NOT NULL,
    phone character varying(40) DEFAULT ''::character varying NOT NULL,
    email character varying(254) DEFAULT ''::character varying NOT NULL,
    notes character varying(500) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT project_contact_contact_role_check CHECK (((contact_role)::text = ANY ((ARRAY['customer_pm'::character varying, 'it_lead'::character varying, 'business_owner'::character varying, 'key_user'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT project_contact_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT project_contact_row_version_check CHECK ((row_version > 0))
);


--
-- Name: project_health; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_health (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    reported_on date DEFAULT CURRENT_DATE NOT NULL,
    overall character varying(6) NOT NULL,
    schedule character varying(6) NOT NULL,
    scope character varying(6) NOT NULL,
    cost character varying(6) NOT NULL,
    quality character varying(6) NOT NULL,
    note character varying(500) DEFAULT ''::character varying NOT NULL,
    reported_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_health_cost_check CHECK (((cost)::text = ANY ((ARRAY['green'::character varying, 'yellow'::character varying, 'red'::character varying])::text[]))),
    CONSTRAINT project_health_overall_check CHECK (((overall)::text = ANY ((ARRAY['green'::character varying, 'yellow'::character varying, 'red'::character varying])::text[]))),
    CONSTRAINT project_health_quality_check CHECK (((quality)::text = ANY ((ARRAY['green'::character varying, 'yellow'::character varying, 'red'::character varying])::text[]))),
    CONSTRAINT project_health_schedule_check CHECK (((schedule)::text = ANY ((ARRAY['green'::character varying, 'yellow'::character varying, 'red'::character varying])::text[]))),
    CONSTRAINT project_health_scope_check CHECK (((scope)::text = ANY ((ARRAY['green'::character varying, 'yellow'::character varying, 'red'::character varying])::text[])))
);


--
-- Name: project_member; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_member (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    sort_code integer,
    CONSTRAINT project_member_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT project_member_sort_code_check CHECK (((sort_code >= 0) AND (sort_code <= 9999))),
    CONSTRAINT project_member_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'removed'::character varying])::text[])))
);


--
-- Name: project_milestone; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_milestone (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    milestone_key character varying(30),
    name character varying(60) NOT NULL,
    phase_key character varying(20),
    planned_on date,
    achieved_on date,
    notes character varying(500) DEFAULT ''::character varying NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT project_milestone_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT project_milestone_phase_key_check CHECK (((phase_key)::text = ANY ((ARRAY['discover'::character varying, 'prepare'::character varying, 'explore'::character varying, 'realize'::character varying, 'deploy'::character varying, 'run'::character varying])::text[]))),
    CONSTRAINT project_milestone_row_version_check CHECK ((row_version > 0))
);


--
-- Name: project_module_lead; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_module_lead (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    module character varying(10) NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT project_module_lead_module_check CHECK (((module)::text ~ '^[A-Z][A-Z0-9]{1,9}$'::text))
);


--
-- Name: project_phase; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_phase (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    phase_key character varying(20) NOT NULL,
    name character varying(30) NOT NULL,
    sort smallint NOT NULL,
    planned_start date,
    planned_end date,
    actual_start date,
    actual_end date,
    status character varying(12) DEFAULT 'not_started'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT project_phase_check CHECK (((planned_end IS NULL) OR (planned_start IS NULL) OR (planned_end >= planned_start))),
    CONSTRAINT project_phase_check1 CHECK (((actual_end IS NULL) OR (actual_start IS NULL) OR (actual_end >= actual_start))),
    CONSTRAINT project_phase_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT project_phase_phase_key_check CHECK (((phase_key)::text = ANY ((ARRAY['discover'::character varying, 'prepare'::character varying, 'explore'::character varying, 'realize'::character varying, 'deploy'::character varying, 'run'::character varying])::text[]))),
    CONSTRAINT project_phase_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT project_phase_status_check CHECK (((status)::text = ANY ((ARRAY['not_started'::character varying, 'in_progress'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: project_preference; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_preference (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid
);


--
-- Name: project_sap_system; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.project_sap_system (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name character varying(60) NOT NULL,
    purpose character varying(12) NOT NULL,
    sid character varying(3) NOT NULL,
    sap_url character varying(2048) NOT NULL,
    client character varying(3) NOT NULL,
    language character varying(2) DEFAULT 'ZH'::character varying NOT NULL,
    description character varying(300) DEFAULT ''::character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    last_test_status character varying(16),
    last_test_message character varying(300),
    last_test_at timestamp with time zone,
    backend_version character varying(300),
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT project_sap_system_check CHECK (((NOT is_default) OR ((status)::text = 'active'::text))),
    CONSTRAINT project_sap_system_client_check CHECK (((client)::text ~ '^\d{3}$'::text)),
    CONSTRAINT project_sap_system_language_check CHECK (((language)::text ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT project_sap_system_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT project_sap_system_purpose_check CHECK (((purpose)::text = ANY ((ARRAY['development'::character varying, 'test'::character varying])::text[]))),
    CONSTRAINT project_sap_system_row_version_check CHECK ((row_version > 0)),
    CONSTRAINT project_sap_system_sid_check CHECK (((sid)::text ~ '^[A-Z][A-Z0-9]{2}$'::text)),
    CONSTRAINT project_sap_system_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: sap_credential_policy; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.sap_credential_policy (
    organization_id uuid NOT NULL,
    allow_save boolean DEFAULT true NOT NULL,
    max_days smallint DEFAULT 30 NOT NULL,
    idle_days smallint DEFAULT 14 NOT NULL,
    subcontractor_save boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT sap_credential_policy_idle_days_check CHECK (((idle_days >= 1) AND (idle_days <= 365))),
    CONSTRAINT sap_credential_policy_max_days_check CHECK (((max_days >= 1) AND (max_days <= 365))),
    CONSTRAINT sap_credential_policy_row_version_check CHECK ((row_version > 0))
);


--
-- Name: sap_test_data_run; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.sap_test_data_run (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    system_id uuid NOT NULL,
    environment character varying(3) NOT NULL,
    client text,
    sap_user text NOT NULL,
    agent text NOT NULL,
    agent_session_id uuid,
    request_id text NOT NULL,
    purpose text NOT NULL,
    class_name text NOT NULL,
    source text NOT NULL,
    functions text[] DEFAULT '{}'::text[] NOT NULL,
    status text NOT NULL,
    output text DEFAULT ''::text NOT NULL,
    error text,
    cleaned_up boolean DEFAULT false NOT NULL,
    authorized_by uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT sap_test_data_run_environment_check CHECK (((environment)::text = ANY ((ARRAY['DEV'::character varying, 'QAS'::character varying])::text[]))),
    CONSTRAINT sap_test_data_run_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: sap_user_credential; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.sap_user_credential (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    system_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sap_username character varying(128) NOT NULL,
    password_cipher text NOT NULL,
    key_version smallint DEFAULT 1 NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT sap_user_credential_sap_username_check CHECK ((length(btrim((sap_username)::text)) > 0))
);


--
-- Name: user_password; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.user_password (
    user_id uuid NOT NULL,
    password_hash text NOT NULL,
    must_change_password boolean DEFAULT true NOT NULL,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT user_password_password_hash_check CHECK ((length(password_hash) > 0)),
    CONSTRAINT user_password_row_version_check CHECK ((row_version > 0))
);


--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;


--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);


--
-- Name: abap_dev_agent_attachment abap_dev_agent_attachment_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_attachment
    ADD CONSTRAINT abap_dev_agent_attachment_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_comment abap_dev_agent_comment_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_comment
    ADD CONSTRAINT abap_dev_agent_comment_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_message abap_dev_agent_message_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_message
    ADD CONSTRAINT abap_dev_agent_message_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_message abap_dev_agent_message_session_id_seq_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_message
    ADD CONSTRAINT abap_dev_agent_message_session_id_seq_key UNIQUE (session_id, seq);


--
-- Name: abap_dev_agent_session abap_dev_agent_session_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_session
    ADD CONSTRAINT abap_dev_agent_session_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_tool_call abap_dev_agent_tool_call_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_tool_call
    ADD CONSTRAINT abap_dev_agent_tool_call_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_turn abap_dev_agent_turn_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_turn
    ADD CONSTRAINT abap_dev_agent_turn_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_version abap_dev_agent_version_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_version
    ADD CONSTRAINT abap_dev_agent_version_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_version abap_dev_agent_version_session_id_version_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_version
    ADD CONSTRAINT abap_dev_agent_version_session_id_version_key UNIQUE (session_id, version);


--
-- Name: abap_fsd_agent_attachment abap_fsd_agent_attachment_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_attachment
    ADD CONSTRAINT abap_fsd_agent_attachment_pkey PRIMARY KEY (id);


--
-- Name: abap_fsd_agent_comment abap_fsd_agent_comment_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_comment
    ADD CONSTRAINT abap_fsd_agent_comment_pkey PRIMARY KEY (id);


--
-- Name: abap_fsd_agent_document abap_fsd_agent_document_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_document
    ADD CONSTRAINT abap_fsd_agent_document_pkey PRIMARY KEY (id);


--
-- Name: abap_fsd_agent_document abap_fsd_agent_document_session_id_version_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_document
    ADD CONSTRAINT abap_fsd_agent_document_session_id_version_key UNIQUE (session_id, version);


--
-- Name: abap_fsd_agent_message abap_fsd_agent_message_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_message
    ADD CONSTRAINT abap_fsd_agent_message_pkey PRIMARY KEY (id);


--
-- Name: abap_fsd_agent_message abap_fsd_agent_message_session_id_seq_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_message
    ADD CONSTRAINT abap_fsd_agent_message_session_id_seq_key UNIQUE (session_id, seq);


--
-- Name: abap_fsd_agent_session abap_fsd_agent_session_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_session
    ADD CONSTRAINT abap_fsd_agent_session_pkey PRIMARY KEY (id);


--
-- Name: abap_fsd_agent_tool_call abap_fsd_agent_tool_call_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_tool_call
    ADD CONSTRAINT abap_fsd_agent_tool_call_pkey PRIMARY KEY (id);


--
-- Name: abap_fsd_agent_turn abap_fsd_agent_turn_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_turn
    ADD CONSTRAINT abap_fsd_agent_turn_pkey PRIMARY KEY (id);


--
-- Name: access_assignment access_assignment_organization_id_user_id_role_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_assignment
    ADD CONSTRAINT access_assignment_organization_id_user_id_role_id_key UNIQUE (organization_id, user_id, role_id);


--
-- Name: access_assignment access_assignment_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_assignment
    ADD CONSTRAINT access_assignment_pkey PRIMARY KEY (id);


--
-- Name: access_position access_position_organization_id_code_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_position
    ADD CONSTRAINT access_position_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: access_position access_position_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_position
    ADD CONSTRAINT access_position_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: access_position access_position_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_position
    ADD CONSTRAINT access_position_pkey PRIMARY KEY (id);


--
-- Name: access_position_role access_position_role_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_position_role
    ADD CONSTRAINT access_position_role_pkey PRIMARY KEY (position_id, role_id);


--
-- Name: access_project_role access_project_role_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_project_role
    ADD CONSTRAINT access_project_role_pkey PRIMARY KEY (id);


--
-- Name: access_project_role access_project_role_project_id_user_id_role_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_project_role
    ADD CONSTRAINT access_project_role_project_id_user_id_role_id_key UNIQUE (project_id, user_id, role_id);


--
-- Name: access_role_composition access_role_composition_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role_composition
    ADD CONSTRAINT access_role_composition_pkey PRIMARY KEY (composite_id, member_id);


--
-- Name: access_role access_role_organization_id_code_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role
    ADD CONSTRAINT access_role_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: access_role access_role_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role
    ADD CONSTRAINT access_role_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: access_role_permission access_role_permission_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role_permission
    ADD CONSTRAINT access_role_permission_pkey PRIMARY KEY (role_id, permission);


--
-- Name: access_role access_role_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role
    ADD CONSTRAINT access_role_pkey PRIMARY KEY (id);


--
-- Name: app_user app_user_login_name_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.app_user
    ADD CONSTRAINT app_user_login_name_key UNIQUE (login_name);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- Name: audit_comment audit_comment_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_comment
    ADD CONSTRAINT audit_comment_pkey PRIMARY KEY (id);


--
-- Name: audit_event audit_event_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_event
    ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id);


--
-- Name: audit_proposal audit_proposal_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_proposal
    ADD CONSTRAINT audit_proposal_pkey PRIMARY KEY (id);


--
-- Name: auth_session auth_session_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (id);


--
-- Name: auth_session auth_session_token_hash_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.auth_session
    ADD CONSTRAINT auth_session_token_hash_key UNIQUE (token_hash);


--
-- Name: customer customer_organization_id_code_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.customer
    ADD CONSTRAINT customer_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: customer customer_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.customer
    ADD CONSTRAINT customer_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: customer customer_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (id);


--
-- Name: development_event development_event_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_event
    ADD CONSTRAINT development_event_pkey PRIMARY KEY (id);


--
-- Name: development_field development_field_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_field
    ADD CONSTRAINT development_field_pkey PRIMARY KEY (id);


--
-- Name: development_file development_file_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_file
    ADD CONSTRAINT development_file_pkey PRIMARY KEY (id);


--
-- Name: development_item_object development_item_object_item_id_pgmid_object_type_object_na_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_object
    ADD CONSTRAINT development_item_object_item_id_pgmid_object_type_object_na_key UNIQUE (item_id, pgmid, object_type, object_name);


--
-- Name: development_item_object development_item_object_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_object
    ADD CONSTRAINT development_item_object_pkey PRIMARY KEY (id);


--
-- Name: development_item development_item_organization_id_project_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item
    ADD CONSTRAINT development_item_organization_id_project_id_id_key UNIQUE (organization_id, project_id, id);


--
-- Name: development_item development_item_organization_id_project_id_item_no_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item
    ADD CONSTRAINT development_item_organization_id_project_id_item_no_key UNIQUE (organization_id, project_id, item_no);


--
-- Name: development_item_phase development_item_phase_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_phase
    ADD CONSTRAINT development_item_phase_pkey PRIMARY KEY (item_id, phase);


--
-- Name: development_item development_item_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item
    ADD CONSTRAINT development_item_pkey PRIMARY KEY (id);


--
-- Name: development_item_tag development_item_tag_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_tag
    ADD CONSTRAINT development_item_tag_pkey PRIMARY KEY (item_id, tag_id);


--
-- Name: development_phase_transition development_phase_transition_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_phase_transition
    ADD CONSTRAINT development_phase_transition_pkey PRIMARY KEY (id);


--
-- Name: development_tag development_tag_organization_id_project_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_tag
    ADD CONSTRAINT development_tag_organization_id_project_id_id_key UNIQUE (organization_id, project_id, id);


--
-- Name: development_tag development_tag_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_tag
    ADD CONSTRAINT development_tag_pkey PRIMARY KEY (id);


--
-- Name: list_view list_view_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.list_view
    ADD CONSTRAINT list_view_pkey PRIMARY KEY (id);


--
-- Name: llm_credential llm_credential_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_credential
    ADD CONSTRAINT llm_credential_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: llm_credential llm_credential_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_credential
    ADD CONSTRAINT llm_credential_pkey PRIMARY KEY (id);


--
-- Name: llm_default llm_default_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_default
    ADD CONSTRAINT llm_default_pkey PRIMARY KEY (organization_id);


--
-- Name: llm_model llm_model_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model
    ADD CONSTRAINT llm_model_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: llm_model llm_model_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model
    ADD CONSTRAINT llm_model_pkey PRIMARY KEY (id);


--
-- Name: llm_model_version llm_model_version_model_id_version_no_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model_version
    ADD CONSTRAINT llm_model_version_model_id_version_no_key UNIQUE (model_id, version_no);


--
-- Name: llm_model_version llm_model_version_organization_id_model_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model_version
    ADD CONSTRAINT llm_model_version_organization_id_model_id_id_key UNIQUE (organization_id, model_id, id);


--
-- Name: llm_model_version llm_model_version_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model_version
    ADD CONSTRAINT llm_model_version_pkey PRIMARY KEY (id);


--
-- Name: llm_test_run llm_test_run_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_test_run
    ADD CONSTRAINT llm_test_run_pkey PRIMARY KEY (id);


--
-- Name: login_throttle login_throttle_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.login_throttle
    ADD CONSTRAINT login_throttle_pkey PRIMARY KEY (scope, key_hash);


--
-- Name: organization organization_code_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.organization
    ADD CONSTRAINT organization_code_key UNIQUE (code);


--
-- Name: organization_member organization_member_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.organization_member
    ADD CONSTRAINT organization_member_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);


--
-- Name: project_contact project_contact_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_contact
    ADD CONSTRAINT project_contact_pkey PRIMARY KEY (id);


--
-- Name: project_health project_health_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_health
    ADD CONSTRAINT project_health_pkey PRIMARY KEY (id);


--
-- Name: project_member project_member_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_member
    ADD CONSTRAINT project_member_pkey PRIMARY KEY (organization_id, project_id, user_id);


--
-- Name: project_milestone project_milestone_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_milestone
    ADD CONSTRAINT project_milestone_pkey PRIMARY KEY (id);


--
-- Name: project_milestone project_milestone_project_id_milestone_key_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_milestone
    ADD CONSTRAINT project_milestone_project_id_milestone_key_key UNIQUE (project_id, milestone_key);


--
-- Name: project_module_lead project_module_lead_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_module_lead
    ADD CONSTRAINT project_module_lead_pkey PRIMARY KEY (project_id, module);


--
-- Name: project project_organization_id_code_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_organization_id_code_key UNIQUE (organization_id, code);


--
-- Name: project project_organization_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: project_phase project_phase_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_phase
    ADD CONSTRAINT project_phase_pkey PRIMARY KEY (project_id, phase_key);


--
-- Name: project project_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);


--
-- Name: project_preference project_preference_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_preference
    ADD CONSTRAINT project_preference_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: project_sap_system project_sap_system_organization_id_project_id_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_sap_system
    ADD CONSTRAINT project_sap_system_organization_id_project_id_id_key UNIQUE (organization_id, project_id, id);


--
-- Name: project_sap_system project_sap_system_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_sap_system
    ADD CONSTRAINT project_sap_system_pkey PRIMARY KEY (id);


--
-- Name: project_sap_system project_sap_system_project_id_purpose_sap_url_client_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_sap_system
    ADD CONSTRAINT project_sap_system_project_id_purpose_sap_url_client_key UNIQUE (project_id, purpose, sap_url, client);


--
-- Name: sap_credential_policy sap_credential_policy_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_credential_policy
    ADD CONSTRAINT sap_credential_policy_pkey PRIMARY KEY (organization_id);


--
-- Name: sap_test_data_run sap_test_data_run_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_test_data_run
    ADD CONSTRAINT sap_test_data_run_pkey PRIMARY KEY (id);


--
-- Name: sap_user_credential sap_user_credential_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_user_credential
    ADD CONSTRAINT sap_user_credential_pkey PRIMARY KEY (id);


--
-- Name: sap_user_credential sap_user_credential_system_id_user_id_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_user_credential
    ADD CONSTRAINT sap_user_credential_system_id_user_id_key UNIQUE (system_id, user_id);


--
-- Name: user_password user_password_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_password
    ADD CONSTRAINT user_password_pkey PRIMARY KEY (user_id);


--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);


--
-- Name: abap_dev_agent_comment_session; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_dev_agent_comment_session ON app.abap_dev_agent_comment USING btree (session_id, created_at);


--
-- Name: abap_dev_agent_session_item; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_dev_agent_session_item ON app.abap_dev_agent_session USING btree (organization_id, item_id, updated_at DESC);


--
-- Name: abap_dev_agent_tool_call_turn; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_dev_agent_tool_call_turn ON app.abap_dev_agent_tool_call USING btree (turn_id, created_at);


--
-- Name: abap_dev_agent_turn_running; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_dev_agent_turn_running ON app.abap_dev_agent_turn USING btree (status) WHERE (status = 'running'::text);


--
-- Name: abap_dev_agent_turn_session; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_dev_agent_turn_session ON app.abap_dev_agent_turn USING btree (session_id, started_at);


--
-- Name: abap_fsd_agent_comment_session; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_fsd_agent_comment_session ON app.abap_fsd_agent_comment USING btree (session_id, created_at);


--
-- Name: abap_fsd_agent_session_item; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_fsd_agent_session_item ON app.abap_fsd_agent_session USING btree (organization_id, item_id, updated_at DESC);


--
-- Name: abap_fsd_agent_tool_call_turn; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_fsd_agent_tool_call_turn ON app.abap_fsd_agent_tool_call USING btree (turn_id, created_at);


--
-- Name: abap_fsd_agent_turn_running; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_fsd_agent_turn_running ON app.abap_fsd_agent_turn USING btree (status) WHERE (status = 'running'::text);


--
-- Name: abap_fsd_agent_turn_session; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX abap_fsd_agent_turn_session ON app.abap_fsd_agent_turn USING btree (session_id, started_at);


--
-- Name: audit_comment_target; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX audit_comment_target ON app.audit_comment USING btree (organization_id, target_type, target_id, created_at);


--
-- Name: audit_comment_time; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX audit_comment_time ON app.audit_comment USING btree (organization_id, created_at DESC);


--
-- Name: audit_proposal_time; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX audit_proposal_time ON app.audit_proposal USING btree (organization_id, created_at DESC);


--
-- Name: development_field_label; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX development_field_label ON app.development_field USING btree (organization_id, project_id, lower((label)::text)) WHERE (archived_at IS NULL);


--
-- Name: development_item_custom; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_item_custom ON app.development_item USING gin (custom_values);


--
-- Name: development_item_list; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_item_list ON app.development_item USING btree (organization_id, project_id, item_no DESC) WHERE (deleted_at IS NULL);


--
-- Name: development_item_object_name; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_item_object_name ON app.development_item_object USING btree (organization_id, project_id, object_type, object_name);


--
-- Name: development_item_phase_assignee; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_item_phase_assignee ON app.development_item_phase USING btree (organization_id, project_id, phase, assignee_id);


--
-- Name: development_item_phase_status; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_item_phase_status ON app.development_item_phase USING btree (organization_id, project_id, phase, status);


--
-- Name: development_item_tag_tag; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_item_tag_tag ON app.development_item_tag USING btree (tag_id);


--
-- Name: development_phase_transition_item; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_phase_transition_item ON app.development_phase_transition USING btree (item_id, phase, at);


--
-- Name: development_phase_transition_project; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX development_phase_transition_project ON app.development_phase_transition USING btree (organization_id, project_id, at);


--
-- Name: development_tag_name; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX development_tag_name ON app.development_tag USING btree (organization_id, project_id, lower((name)::text));


--
-- Name: ix_access_assignment_role; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_access_assignment_role ON app.access_assignment USING btree (role_id);


--
-- Name: ix_access_project_role_role; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_access_project_role_role ON app.access_project_role USING btree (role_id);


--
-- Name: ix_access_project_role_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_access_project_role_user ON app.access_project_role USING btree (organization_id, user_id);


--
-- Name: ix_access_role_composition_member; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_access_role_composition_member ON app.access_role_composition USING btree (member_id);


--
-- Name: ix_audit_event_org_time; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_audit_event_org_time ON app.audit_event USING btree (organization_id, occurred_at DESC, id DESC);


--
-- Name: ix_audit_event_request; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_audit_event_request ON app.audit_event USING btree (request_id);


--
-- Name: ix_audit_event_time; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_audit_event_time ON app.audit_event USING btree (occurred_at);


--
-- Name: ix_auth_session_expiry; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_auth_session_expiry ON app.auth_session USING btree (expires_at);


--
-- Name: ix_auth_session_member; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_auth_session_member ON app.auth_session USING btree (organization_id, user_id);


--
-- Name: ix_auth_session_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_auth_session_user ON app.auth_session USING btree (user_id, organization_id);


--
-- Name: ix_llm_models_org; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_llm_models_org ON app.llm_model USING btree (organization_id, updated_at DESC, id) WHERE (deleted_at IS NULL);


--
-- Name: ix_llm_tests_version; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_llm_tests_version ON app.llm_test_run USING btree (organization_id, version_id, started_at DESC, id);


--
-- Name: ix_llm_versions_org; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_llm_versions_org ON app.llm_model_version USING btree (organization_id, model_id);


--
-- Name: ix_login_throttle_updated; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_login_throttle_updated ON app.login_throttle USING btree (updated_at);


--
-- Name: ix_organization_member_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_organization_member_user ON app.organization_member USING btree (user_id, organization_id);


--
-- Name: ix_project_contact_project; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_project_contact_project ON app.project_contact USING btree (project_id, name);


--
-- Name: ix_project_customer; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_project_customer ON app.project USING btree (organization_id, customer_id);


--
-- Name: ix_project_health_project; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_project_health_project ON app.project_health USING btree (project_id, reported_on DESC, created_at DESC);


--
-- Name: ix_project_member_user_active; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_project_member_user_active ON app.project_member USING btree (organization_id, user_id, project_id) WHERE ((status)::text = 'active'::text);


--
-- Name: ix_project_member_user_all; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_project_member_user_all ON app.project_member USING btree (organization_id, user_id);


--
-- Name: ix_project_milestone_project; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_project_milestone_project ON app.project_milestone USING btree (project_id, sort);


--
-- Name: ix_project_status_updated; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_project_status_updated ON app.project USING btree (organization_id, status, updated_at DESC, id DESC);


--
-- Name: ix_sap_user_credential_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX ix_sap_user_credential_user ON app.sap_user_credential USING btree (organization_id, user_id);


--
-- Name: list_view_default; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX list_view_default ON app.list_view USING btree (organization_id, project_id, owner_id, list_key) WHERE is_default;


--
-- Name: list_view_name; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX list_view_name ON app.list_view USING btree (organization_id, project_id, owner_id, list_key, lower(name));


--
-- Name: sap_test_data_run_project; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX sap_test_data_run_project ON app.sap_test_data_run USING btree (organization_id, project_id, started_at DESC);


--
-- Name: sap_test_data_run_request; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX sap_test_data_run_request ON app.sap_test_data_run USING btree (agent, agent_session_id, request_id);


--
-- Name: ux_customer_self; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX ux_customer_self ON app.customer USING btree (organization_id) WHERE ((customer_kind)::text = 'self'::text);


--
-- Name: ux_llm_test_running; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX ux_llm_test_running ON app.llm_test_run USING btree (version_id) WHERE ((status)::text = 'running'::text);


--
-- Name: ux_project_sap_system_default; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX ux_project_sap_system_default ON app.project_sap_system USING btree (project_id, purpose) WHERE is_default;


--
-- Name: access_assignment access_assignment_scope; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER access_assignment_scope BEFORE INSERT OR UPDATE ON app.access_assignment FOR EACH ROW EXECUTE FUNCTION app.access_check_assignment_scope();


--
-- Name: access_project_role access_project_role_scope; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER access_project_role_scope BEFORE INSERT OR UPDATE ON app.access_project_role FOR EACH ROW EXECUTE FUNCTION app.access_check_assignment_scope();


--
-- Name: access_role_composition access_role_composition_check; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER access_role_composition_check BEFORE INSERT OR UPDATE ON app.access_role_composition FOR EACH ROW EXECUTE FUNCTION app.access_check_composition();


--
-- Name: organization_member sap_forget_on_member_disable; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER sap_forget_on_member_disable AFTER UPDATE OF status ON app.organization_member FOR EACH ROW EXECUTE FUNCTION app.sap_forget_user_credentials();


--
-- Name: project_member sap_forget_on_project_leave; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER sap_forget_on_project_leave AFTER UPDATE OF status ON app.project_member FOR EACH ROW EXECUTE FUNCTION app.sap_forget_member_credentials();


--
-- Name: project_sap_system sap_forget_on_system_change; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER sap_forget_on_system_change AFTER UPDATE ON app.project_sap_system FOR EACH ROW EXECUTE FUNCTION app.sap_forget_system_credentials();


--
-- Name: app_user sap_forget_on_user_disable; Type: TRIGGER; Schema: app; Owner: -
--

CREATE TRIGGER sap_forget_on_user_disable AFTER UPDATE OF status ON app.app_user FOR EACH ROW EXECUTE FUNCTION app.sap_forget_user_credentials();


--
-- Name: abap_dev_agent_attachment abap_dev_agent_attachment_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_attachment
    ADD CONSTRAINT abap_dev_agent_attachment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_dev_agent_attachment abap_dev_agent_attachment_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_attachment
    ADD CONSTRAINT abap_dev_agent_attachment_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_dev_agent_session(id);


--
-- Name: abap_dev_agent_comment abap_dev_agent_comment_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_comment
    ADD CONSTRAINT abap_dev_agent_comment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_dev_agent_comment abap_dev_agent_comment_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_comment
    ADD CONSTRAINT abap_dev_agent_comment_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_dev_agent_session(id);


--
-- Name: abap_dev_agent_message abap_dev_agent_message_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_message
    ADD CONSTRAINT abap_dev_agent_message_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_dev_agent_message abap_dev_agent_message_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_message
    ADD CONSTRAINT abap_dev_agent_message_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_dev_agent_session(id);


--
-- Name: abap_dev_agent_message abap_dev_agent_message_turn_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_message
    ADD CONSTRAINT abap_dev_agent_message_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES app.abap_dev_agent_turn(id);


--
-- Name: abap_dev_agent_session abap_dev_agent_session_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_session
    ADD CONSTRAINT abap_dev_agent_session_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_dev_agent_session abap_dev_agent_session_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_session
    ADD CONSTRAINT abap_dev_agent_session_item_id_fkey FOREIGN KEY (item_id) REFERENCES app.development_item(id);


--
-- Name: abap_dev_agent_session abap_dev_agent_session_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_session
    ADD CONSTRAINT abap_dev_agent_session_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: abap_dev_agent_session abap_dev_agent_session_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_session
    ADD CONSTRAINT abap_dev_agent_session_project_id_fkey FOREIGN KEY (project_id) REFERENCES app.project(id);


--
-- Name: abap_dev_agent_tool_call abap_dev_agent_tool_call_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_tool_call
    ADD CONSTRAINT abap_dev_agent_tool_call_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_dev_agent_session(id);


--
-- Name: abap_dev_agent_tool_call abap_dev_agent_tool_call_turn_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_tool_call
    ADD CONSTRAINT abap_dev_agent_tool_call_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES app.abap_dev_agent_turn(id);


--
-- Name: abap_dev_agent_turn abap_dev_agent_turn_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_turn
    ADD CONSTRAINT abap_dev_agent_turn_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_dev_agent_turn abap_dev_agent_turn_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_turn
    ADD CONSTRAINT abap_dev_agent_turn_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_dev_agent_session(id);


--
-- Name: abap_dev_agent_version abap_dev_agent_version_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_version
    ADD CONSTRAINT abap_dev_agent_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_dev_agent_version abap_dev_agent_version_finalized_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_version
    ADD CONSTRAINT abap_dev_agent_version_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES app.app_user(id);


--
-- Name: abap_dev_agent_version abap_dev_agent_version_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_version
    ADD CONSTRAINT abap_dev_agent_version_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_dev_agent_session(id);


--
-- Name: abap_dev_agent_version abap_dev_agent_version_turn_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_dev_agent_version
    ADD CONSTRAINT abap_dev_agent_version_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES app.abap_dev_agent_turn(id);


--
-- Name: abap_fsd_agent_attachment abap_fsd_agent_attachment_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_attachment
    ADD CONSTRAINT abap_fsd_agent_attachment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_fsd_agent_attachment abap_fsd_agent_attachment_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_attachment
    ADD CONSTRAINT abap_fsd_agent_attachment_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_fsd_agent_session(id);


--
-- Name: abap_fsd_agent_comment abap_fsd_agent_comment_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_comment
    ADD CONSTRAINT abap_fsd_agent_comment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_fsd_agent_comment abap_fsd_agent_comment_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_comment
    ADD CONSTRAINT abap_fsd_agent_comment_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_fsd_agent_session(id);


--
-- Name: abap_fsd_agent_document abap_fsd_agent_document_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_document
    ADD CONSTRAINT abap_fsd_agent_document_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_fsd_agent_document abap_fsd_agent_document_finalized_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_document
    ADD CONSTRAINT abap_fsd_agent_document_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES app.app_user(id);


--
-- Name: abap_fsd_agent_document abap_fsd_agent_document_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_document
    ADD CONSTRAINT abap_fsd_agent_document_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_fsd_agent_session(id);


--
-- Name: abap_fsd_agent_document abap_fsd_agent_document_turn_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_document
    ADD CONSTRAINT abap_fsd_agent_document_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES app.abap_fsd_agent_turn(id);


--
-- Name: abap_fsd_agent_message abap_fsd_agent_message_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_message
    ADD CONSTRAINT abap_fsd_agent_message_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_fsd_agent_message abap_fsd_agent_message_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_message
    ADD CONSTRAINT abap_fsd_agent_message_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_fsd_agent_session(id);


--
-- Name: abap_fsd_agent_message abap_fsd_agent_message_turn_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_message
    ADD CONSTRAINT abap_fsd_agent_message_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES app.abap_fsd_agent_turn(id);


--
-- Name: abap_fsd_agent_session abap_fsd_agent_session_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_session
    ADD CONSTRAINT abap_fsd_agent_session_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_fsd_agent_session abap_fsd_agent_session_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_session
    ADD CONSTRAINT abap_fsd_agent_session_item_id_fkey FOREIGN KEY (item_id) REFERENCES app.development_item(id);


--
-- Name: abap_fsd_agent_session abap_fsd_agent_session_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_session
    ADD CONSTRAINT abap_fsd_agent_session_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: abap_fsd_agent_session abap_fsd_agent_session_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_session
    ADD CONSTRAINT abap_fsd_agent_session_project_id_fkey FOREIGN KEY (project_id) REFERENCES app.project(id);


--
-- Name: abap_fsd_agent_tool_call abap_fsd_agent_tool_call_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_tool_call
    ADD CONSTRAINT abap_fsd_agent_tool_call_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_fsd_agent_session(id);


--
-- Name: abap_fsd_agent_tool_call abap_fsd_agent_tool_call_turn_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_tool_call
    ADD CONSTRAINT abap_fsd_agent_tool_call_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES app.abap_fsd_agent_turn(id);


--
-- Name: abap_fsd_agent_turn abap_fsd_agent_turn_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_turn
    ADD CONSTRAINT abap_fsd_agent_turn_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: abap_fsd_agent_turn abap_fsd_agent_turn_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.abap_fsd_agent_turn
    ADD CONSTRAINT abap_fsd_agent_turn_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.abap_fsd_agent_session(id);


--
-- Name: access_assignment access_assignment_granted_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_assignment
    ADD CONSTRAINT access_assignment_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES app.app_user(id);


--
-- Name: access_assignment access_assignment_organization_id_role_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_assignment
    ADD CONSTRAINT access_assignment_organization_id_role_id_fkey FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id);


--
-- Name: access_assignment access_assignment_organization_id_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_assignment
    ADD CONSTRAINT access_assignment_organization_id_user_id_fkey FOREIGN KEY (organization_id, user_id) REFERENCES app.organization_member(organization_id, user_id);


--
-- Name: access_position access_position_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_position
    ADD CONSTRAINT access_position_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: access_position_role access_position_role_organization_id_position_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_position_role
    ADD CONSTRAINT access_position_role_organization_id_position_id_fkey FOREIGN KEY (organization_id, position_id) REFERENCES app.access_position(organization_id, id) ON DELETE CASCADE;


--
-- Name: access_position_role access_position_role_organization_id_role_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_position_role
    ADD CONSTRAINT access_position_role_organization_id_role_id_fkey FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE;


--
-- Name: access_project_role access_project_role_granted_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_project_role
    ADD CONSTRAINT access_project_role_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES app.app_user(id);


--
-- Name: access_project_role access_project_role_organization_id_project_id_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_project_role
    ADD CONSTRAINT access_project_role_organization_id_project_id_user_id_fkey FOREIGN KEY (organization_id, project_id, user_id) REFERENCES app.project_member(organization_id, project_id, user_id);


--
-- Name: access_project_role access_project_role_organization_id_role_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_project_role
    ADD CONSTRAINT access_project_role_organization_id_role_id_fkey FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id);


--
-- Name: access_role_composition access_role_composition_organization_id_composite_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role_composition
    ADD CONSTRAINT access_role_composition_organization_id_composite_id_fkey FOREIGN KEY (organization_id, composite_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE;


--
-- Name: access_role_composition access_role_composition_organization_id_member_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role_composition
    ADD CONSTRAINT access_role_composition_organization_id_member_id_fkey FOREIGN KEY (organization_id, member_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE;


--
-- Name: access_role access_role_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role
    ADD CONSTRAINT access_role_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: access_role access_role_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role
    ADD CONSTRAINT access_role_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: access_role_permission access_role_permission_organization_id_role_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.access_role_permission
    ADD CONSTRAINT access_role_permission_organization_id_role_id_fkey FOREIGN KEY (organization_id, role_id) REFERENCES app.access_role(organization_id, id) ON DELETE CASCADE;


--
-- Name: app_user app_user_position_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.app_user
    ADD CONSTRAINT app_user_position_id_fkey FOREIGN KEY (position_id) REFERENCES app.access_position(id) ON DELETE SET NULL;


--
-- Name: audit_comment audit_comment_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_comment
    ADD CONSTRAINT audit_comment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: audit_comment audit_comment_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_comment
    ADD CONSTRAINT audit_comment_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: audit_proposal audit_proposal_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_proposal
    ADD CONSTRAINT audit_proposal_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: auth_session auth_session_organization_id_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.auth_session
    ADD CONSTRAINT auth_session_organization_id_user_id_fkey FOREIGN KEY (organization_id, user_id) REFERENCES app.organization_member(organization_id, user_id) ON DELETE RESTRICT;


--
-- Name: customer customer_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.customer
    ADD CONSTRAINT customer_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id) ON DELETE RESTRICT;


--
-- Name: development_event development_event_actor_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_event
    ADD CONSTRAINT development_event_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES app.app_user(id);


--
-- Name: development_event development_event_organization_id_project_id_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_event
    ADD CONSTRAINT development_event_organization_id_project_id_item_id_fkey FOREIGN KEY (organization_id, project_id, item_id) REFERENCES app.development_item(organization_id, project_id, id);


--
-- Name: development_field development_field_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_field
    ADD CONSTRAINT development_field_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: development_field development_field_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_field
    ADD CONSTRAINT development_field_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: development_file development_file_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_file
    ADD CONSTRAINT development_file_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: development_file development_file_organization_id_project_id_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_file
    ADD CONSTRAINT development_file_organization_id_project_id_item_id_fkey FOREIGN KEY (organization_id, project_id, item_id) REFERENCES app.development_item(organization_id, project_id, id);


--
-- Name: development_item development_item_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item
    ADD CONSTRAINT development_item_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: development_item_object development_item_object_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_object
    ADD CONSTRAINT development_item_object_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: development_item_object development_item_object_organization_id_project_id_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_object
    ADD CONSTRAINT development_item_object_organization_id_project_id_item_id_fkey FOREIGN KEY (organization_id, project_id, item_id) REFERENCES app.development_item(organization_id, project_id, id);


--
-- Name: development_item development_item_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item
    ADD CONSTRAINT development_item_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: development_item_phase development_item_phase_organization_id_project_id_assignee_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_phase
    ADD CONSTRAINT development_item_phase_organization_id_project_id_assignee_fkey FOREIGN KEY (organization_id, project_id, assignee_id) REFERENCES app.project_member(organization_id, project_id, user_id);


--
-- Name: development_item_phase development_item_phase_organization_id_project_id_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_phase
    ADD CONSTRAINT development_item_phase_organization_id_project_id_item_id_fkey FOREIGN KEY (organization_id, project_id, item_id) REFERENCES app.development_item(organization_id, project_id, id);


--
-- Name: development_item_phase development_item_phase_updated_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_phase
    ADD CONSTRAINT development_item_phase_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app.app_user(id);


--
-- Name: development_item development_item_sap_system_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item
    ADD CONSTRAINT development_item_sap_system_fkey FOREIGN KEY (organization_id, project_id, sap_system_id) REFERENCES app.project_sap_system(organization_id, project_id, id) ON DELETE SET NULL (sap_system_id);


--
-- Name: development_item_tag development_item_tag_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_tag
    ADD CONSTRAINT development_item_tag_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: development_item_tag development_item_tag_organization_id_project_id_item_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_tag
    ADD CONSTRAINT development_item_tag_organization_id_project_id_item_id_fkey FOREIGN KEY (organization_id, project_id, item_id) REFERENCES app.development_item(organization_id, project_id, id);


--
-- Name: development_item_tag development_item_tag_organization_id_project_id_tag_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item_tag
    ADD CONSTRAINT development_item_tag_organization_id_project_id_tag_id_fkey FOREIGN KEY (organization_id, project_id, tag_id) REFERENCES app.development_tag(organization_id, project_id, id) ON DELETE CASCADE;


--
-- Name: development_item development_item_updated_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_item
    ADD CONSTRAINT development_item_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app.app_user(id);


--
-- Name: development_phase_transition development_phase_transition_actor_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_phase_transition
    ADD CONSTRAINT development_phase_transition_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES app.app_user(id);


--
-- Name: development_phase_transition development_phase_transition_organization_id_project_id_it_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_phase_transition
    ADD CONSTRAINT development_phase_transition_organization_id_project_id_it_fkey FOREIGN KEY (organization_id, project_id, item_id) REFERENCES app.development_item(organization_id, project_id, id) ON DELETE CASCADE;


--
-- Name: development_tag development_tag_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_tag
    ADD CONSTRAINT development_tag_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: development_tag development_tag_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.development_tag
    ADD CONSTRAINT development_tag_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: llm_model fk_llm_latest; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model
    ADD CONSTRAINT fk_llm_latest FOREIGN KEY (organization_id, id, latest_version_id) REFERENCES app.llm_model_version(organization_id, model_id, id);


--
-- Name: list_view list_view_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.list_view
    ADD CONSTRAINT list_view_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: list_view list_view_owner_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.list_view
    ADD CONSTRAINT list_view_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES app.app_user(id);


--
-- Name: list_view list_view_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.list_view
    ADD CONSTRAINT list_view_project_id_fkey FOREIGN KEY (project_id) REFERENCES app.project(id);


--
-- Name: llm_credential llm_credential_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_credential
    ADD CONSTRAINT llm_credential_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: llm_credential llm_credential_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_credential
    ADD CONSTRAINT llm_credential_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: llm_default llm_default_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_default
    ADD CONSTRAINT llm_default_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: llm_default llm_default_organization_id_model_id_version_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_default
    ADD CONSTRAINT llm_default_organization_id_model_id_version_id_fkey FOREIGN KEY (organization_id, model_id, version_id) REFERENCES app.llm_model_version(organization_id, model_id, id);


--
-- Name: llm_model llm_model_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model
    ADD CONSTRAINT llm_model_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: llm_model_version llm_model_version_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model_version
    ADD CONSTRAINT llm_model_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: llm_model_version llm_model_version_organization_id_credential_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model_version
    ADD CONSTRAINT llm_model_version_organization_id_credential_id_fkey FOREIGN KEY (organization_id, credential_id) REFERENCES app.llm_credential(organization_id, id);


--
-- Name: llm_model_version llm_model_version_organization_id_model_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_model_version
    ADD CONSTRAINT llm_model_version_organization_id_model_id_fkey FOREIGN KEY (organization_id, model_id) REFERENCES app.llm_model(organization_id, id);


--
-- Name: llm_test_run llm_test_run_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_test_run
    ADD CONSTRAINT llm_test_run_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: llm_test_run llm_test_run_organization_id_model_id_version_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.llm_test_run
    ADD CONSTRAINT llm_test_run_organization_id_model_id_version_id_fkey FOREIGN KEY (organization_id, model_id, version_id) REFERENCES app.llm_model_version(organization_id, model_id, id);


--
-- Name: organization_member organization_member_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.organization_member
    ADD CONSTRAINT organization_member_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id) ON DELETE RESTRICT;


--
-- Name: organization_member organization_member_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.organization_member
    ADD CONSTRAINT organization_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.app_user(id) ON DELETE RESTRICT;


--
-- Name: project project_architect_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_architect_id_fkey FOREIGN KEY (architect_id) REFERENCES app.app_user(id);


--
-- Name: project project_basis_lead_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_basis_lead_id_fkey FOREIGN KEY (basis_lead_id) REFERENCES app.app_user(id);


--
-- Name: project_contact project_contact_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_contact
    ADD CONSTRAINT project_contact_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: project project_dev_lead_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_dev_lead_id_fkey FOREIGN KEY (dev_lead_id) REFERENCES app.app_user(id);


--
-- Name: project project_director_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_director_id_fkey FOREIGN KEY (director_id) REFERENCES app.app_user(id);


--
-- Name: project_health project_health_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_health
    ADD CONSTRAINT project_health_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: project_health project_health_reported_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_health
    ADD CONSTRAINT project_health_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES app.app_user(id);


--
-- Name: project project_manager_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES app.app_user(id);


--
-- Name: project_member project_member_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_member
    ADD CONSTRAINT project_member_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id) ON DELETE RESTRICT;


--
-- Name: project_member project_member_organization_id_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_member
    ADD CONSTRAINT project_member_organization_id_user_id_fkey FOREIGN KEY (organization_id, user_id) REFERENCES app.organization_member(organization_id, user_id) ON DELETE RESTRICT;


--
-- Name: project_milestone project_milestone_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_milestone
    ADD CONSTRAINT project_milestone_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: project_module_lead project_module_lead_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_module_lead
    ADD CONSTRAINT project_module_lead_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: project_module_lead project_module_lead_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_module_lead
    ADD CONSTRAINT project_module_lead_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.app_user(id);


--
-- Name: project project_organization_id_customer_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_organization_id_customer_id_fkey FOREIGN KEY (organization_id, customer_id) REFERENCES app.customer(organization_id, id) ON DELETE RESTRICT;


--
-- Name: project project_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project
    ADD CONSTRAINT project_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id) ON DELETE RESTRICT;


--
-- Name: project_phase project_phase_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_phase
    ADD CONSTRAINT project_phase_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: project_preference project_preference_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_preference
    ADD CONSTRAINT project_preference_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: project_preference project_preference_organization_id_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_preference
    ADD CONSTRAINT project_preference_organization_id_user_id_fkey FOREIGN KEY (organization_id, user_id) REFERENCES app.organization_member(organization_id, user_id);


--
-- Name: project_sap_system project_sap_system_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_sap_system
    ADD CONSTRAINT project_sap_system_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.app_user(id);


--
-- Name: project_sap_system project_sap_system_organization_id_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.project_sap_system
    ADD CONSTRAINT project_sap_system_organization_id_project_id_fkey FOREIGN KEY (organization_id, project_id) REFERENCES app.project(organization_id, id);


--
-- Name: sap_credential_policy sap_credential_policy_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_credential_policy
    ADD CONSTRAINT sap_credential_policy_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: sap_credential_policy sap_credential_policy_updated_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_credential_policy
    ADD CONSTRAINT sap_credential_policy_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app.app_user(id);


--
-- Name: sap_test_data_run sap_test_data_run_authorized_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_test_data_run
    ADD CONSTRAINT sap_test_data_run_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES app.app_user(id);


--
-- Name: sap_test_data_run sap_test_data_run_organization_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_test_data_run
    ADD CONSTRAINT sap_test_data_run_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organization(id);


--
-- Name: sap_test_data_run sap_test_data_run_project_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_test_data_run
    ADD CONSTRAINT sap_test_data_run_project_id_fkey FOREIGN KEY (project_id) REFERENCES app.project(id);


--
-- Name: sap_user_credential sap_user_credential_organization_id_project_id_system_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_user_credential
    ADD CONSTRAINT sap_user_credential_organization_id_project_id_system_id_fkey FOREIGN KEY (organization_id, project_id, system_id) REFERENCES app.project_sap_system(organization_id, project_id, id) ON DELETE CASCADE;


--
-- Name: sap_user_credential sap_user_credential_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.sap_user_credential
    ADD CONSTRAINT sap_user_credential_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.app_user(id);


--
-- Name: user_password user_password_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_password
    ADD CONSTRAINT user_password_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.app_user(id) ON DELETE RESTRICT;


--
-- Name: SCHEMA app; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA app TO sap_workbench_app;


--
-- Name: TABLE abap_dev_agent_attachment; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_dev_agent_attachment TO sap_workbench_app;


--
-- Name: TABLE abap_dev_agent_comment; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.abap_dev_agent_comment TO sap_workbench_app;


--
-- Name: TABLE abap_dev_agent_message; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_dev_agent_message TO sap_workbench_app;


--
-- Name: TABLE abap_dev_agent_session; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.abap_dev_agent_session TO sap_workbench_app;


--
-- Name: TABLE abap_dev_agent_tool_call; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_dev_agent_tool_call TO sap_workbench_app;


--
-- Name: TABLE abap_dev_agent_turn; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.abap_dev_agent_turn TO sap_workbench_app;


--
-- Name: TABLE abap_dev_agent_version; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_dev_agent_version TO sap_workbench_app;


--
-- Name: COLUMN abap_dev_agent_version.labels; Type: ACL; Schema: app; Owner: -
--

GRANT UPDATE(labels) ON TABLE app.abap_dev_agent_version TO sap_workbench_app;


--
-- Name: COLUMN abap_dev_agent_version.finalized_at; Type: ACL; Schema: app; Owner: -
--

GRANT UPDATE(finalized_at) ON TABLE app.abap_dev_agent_version TO sap_workbench_app;


--
-- Name: COLUMN abap_dev_agent_version.finalized_by; Type: ACL; Schema: app; Owner: -
--

GRANT UPDATE(finalized_by) ON TABLE app.abap_dev_agent_version TO sap_workbench_app;


--
-- Name: TABLE abap_fsd_agent_attachment; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_fsd_agent_attachment TO sap_workbench_app;


--
-- Name: TABLE abap_fsd_agent_comment; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.abap_fsd_agent_comment TO sap_workbench_app;


--
-- Name: TABLE abap_fsd_agent_document; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_fsd_agent_document TO sap_workbench_app;


--
-- Name: COLUMN abap_fsd_agent_document.labels; Type: ACL; Schema: app; Owner: -
--

GRANT UPDATE(labels) ON TABLE app.abap_fsd_agent_document TO sap_workbench_app;


--
-- Name: COLUMN abap_fsd_agent_document.finalized_at; Type: ACL; Schema: app; Owner: -
--

GRANT UPDATE(finalized_at) ON TABLE app.abap_fsd_agent_document TO sap_workbench_app;


--
-- Name: COLUMN abap_fsd_agent_document.finalized_by; Type: ACL; Schema: app; Owner: -
--

GRANT UPDATE(finalized_by) ON TABLE app.abap_fsd_agent_document TO sap_workbench_app;


--
-- Name: TABLE abap_fsd_agent_message; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_fsd_agent_message TO sap_workbench_app;


--
-- Name: TABLE abap_fsd_agent_session; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.abap_fsd_agent_session TO sap_workbench_app;


--
-- Name: TABLE abap_fsd_agent_tool_call; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.abap_fsd_agent_tool_call TO sap_workbench_app;


--
-- Name: TABLE abap_fsd_agent_turn; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.abap_fsd_agent_turn TO sap_workbench_app;


--
-- Name: TABLE access_assignment; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.access_assignment TO sap_workbench_app;


--
-- Name: TABLE access_position; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.access_position TO sap_workbench_app;


--
-- Name: TABLE access_position_role; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.access_position_role TO sap_workbench_app;


--
-- Name: TABLE access_project_role; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.access_project_role TO sap_workbench_app;


--
-- Name: TABLE access_role; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.access_role TO sap_workbench_app;


--
-- Name: TABLE access_role_composition; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.access_role_composition TO sap_workbench_app;


--
-- Name: TABLE access_role_permission; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.access_role_permission TO sap_workbench_app;


--
-- Name: TABLE app_user; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.app_user TO sap_workbench_app;


--
-- Name: TABLE audit_comment; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.audit_comment TO sap_workbench_app;


--
-- Name: COLUMN audit_comment.deleted_at; Type: ACL; Schema: app; Owner: -
--

GRANT UPDATE(deleted_at) ON TABLE app.audit_comment TO sap_workbench_app;


--
-- Name: TABLE audit_event; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.audit_event TO sap_workbench_app;


--
-- Name: TABLE audit_proposal; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.audit_proposal TO sap_workbench_app;


--
-- Name: TABLE auth_session; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.auth_session TO sap_workbench_app;


--
-- Name: TABLE customer; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.customer TO sap_workbench_app;


--
-- Name: TABLE development_event; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.development_event TO sap_workbench_app;


--
-- Name: TABLE development_field; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.development_field TO sap_workbench_app;


--
-- Name: TABLE development_file; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE app.development_file TO sap_workbench_app;


--
-- Name: TABLE development_item; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.development_item TO sap_workbench_app;


--
-- Name: TABLE development_item_object; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE app.development_item_object TO sap_workbench_app;


--
-- Name: TABLE development_item_phase; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.development_item_phase TO sap_workbench_app;


--
-- Name: TABLE development_item_tag; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE app.development_item_tag TO sap_workbench_app;


--
-- Name: TABLE development_phase_transition; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.development_phase_transition TO sap_workbench_app;


--
-- Name: TABLE development_tag; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.development_tag TO sap_workbench_app;


--
-- Name: TABLE list_view; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.list_view TO sap_workbench_app;


--
-- Name: TABLE llm_credential; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.llm_credential TO sap_workbench_app;


--
-- Name: TABLE llm_default; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.llm_default TO sap_workbench_app;


--
-- Name: TABLE llm_model; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.llm_model TO sap_workbench_app;


--
-- Name: TABLE llm_model_version; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.llm_model_version TO sap_workbench_app;


--
-- Name: TABLE llm_test_run; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.llm_test_run TO sap_workbench_app;


--
-- Name: TABLE login_throttle; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.login_throttle TO sap_workbench_app;


--
-- Name: TABLE organization; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.organization TO sap_workbench_app;


--
-- Name: TABLE organization_member; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.organization_member TO sap_workbench_app;


--
-- Name: TABLE project; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.project TO sap_workbench_app;


--
-- Name: TABLE project_contact; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.project_contact TO sap_workbench_app;


--
-- Name: TABLE project_health; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT ON TABLE app.project_health TO sap_workbench_app;


--
-- Name: TABLE project_member; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.project_member TO sap_workbench_app;


--
-- Name: TABLE project_milestone; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.project_milestone TO sap_workbench_app;


--
-- Name: TABLE project_module_lead; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.project_module_lead TO sap_workbench_app;


--
-- Name: TABLE project_phase; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.project_phase TO sap_workbench_app;


--
-- Name: TABLE project_preference; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.project_preference TO sap_workbench_app;


--
-- Name: TABLE project_sap_system; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.project_sap_system TO sap_workbench_app;


--
-- Name: TABLE sap_credential_policy; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.sap_credential_policy TO sap_workbench_app;


--
-- Name: TABLE sap_test_data_run; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.sap_test_data_run TO sap_workbench_app;


--
-- Name: TABLE sap_user_credential; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.sap_user_credential TO sap_workbench_app;


--
-- Name: TABLE user_password; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE app.user_password TO sap_workbench_app;


--
-- PostgreSQL database dump complete
--

-- Migration history: npm run db:migrate continues from here.
INSERT INTO public.pgmigrations (id, name, run_on) VALUES
  (1, '1790899200000_initial-schema', now()),
  (2, '1790985600000_organization-admin', now()),
  (3, '1790992800000_development-items', now()),
  (4, '1791000000000_sap-connections', now()),
  (5, '1791028800000_model-registry', now()),
  (6, '1791039000000_requirement-richtext', now()),
  (7, '1791046800000_fs-workspace-core', now()),
  (8, '1791046801000_fs-workspace-protocol-metadata', now()),
  (9, '1791046802000_fs-confirmation-intent', now()),
  (10, '1791046803000_fs-message-input', now()),
  (11, '1791046804000_fs-export-manifest', now()),
  (12, '1791046805000_fs-publication-reason', now()),
  (13, '1791046806000_fsd-agent', now()),
  (14, '1791072000000_pending-items', now()),
  (15, '1791158400000_item-workspace', now()),
  (16, '1791190800000_workbench-conversations', now()),
  (17, '1791222000000_assistant-test-reset', now()),
  (18, '1791222100000_reset-legacy-assistant-content', now()),
  (19, '1791222200000_reset-message-order', now()),
  (20, '1791240000000_fsd-phase-workflow', now()),
  (21, '1791250000000_remove-model-call-parameters', now()),
  (22, '1791290000000_gem-fsd-v2', now()),
  (23, '1791460000000_design-assistant-v1', now()),
  (24, '1791546400000_design-assistant-chat', now()),
  (25, '1791676800000_fsd-v1-insights-indexes', now()),
  (26, '1791720000000_remove-legacy-assistants', now()),
  (27, '1791730000000_abap-fsd-agent', now()),
  (28, '1791800000000_audit-analysis', now()),
  (29, '1791900000000_development-list-rebuild', now()),
  (30, '1792000000000_abap-dev-agent', now()),
  (31, '1792100000000_sap-test-data', now()),
  (32, '1792200000000_drop-sap-allowlist', now()),
  (33, '1792300000000_agent-tool-preview', now()),
  (34, '1792400000000_user-preference', now()),
  (35, '1792500000000_drop-user-preference', now()),
  (36, '1792600000000_access-control', now()),
  (37, '1792610000000_project-master-data', now()),
  (38, '1792620000000_project-sap-systems', now()),
  (39, '1792630000000_agent-session-archive', now()),
  (40, '1792640000000_development-overview-records', now()),
  (41, '1792650000000_development-overview-baseline', now()),
  (42, '1792660000000_project-member-sort-code', now()),
  (43, '1792670000000_list-view', now());
SELECT pg_catalog.setval('public.pgmigrations_id_seq', 43, true);

COMMIT;
