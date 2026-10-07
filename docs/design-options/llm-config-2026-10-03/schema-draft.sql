-- 大模型配置数据库设计稿 / PostgreSQL / 2026-10-03
-- 仅供评审，未执行；不是正式 migration。依赖现有 app.organization/project/app_user。
-- 不另建审计表，复用 app.audit_event。所有外键默认 RESTRICT，禁止级联删除历史。

-- 1. 凭据：密文或外部密钥引用二选一。轮换新增记录，旧版本仍引用原凭据。
CREATE TABLE app.llm_credential (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
 storage_type varchar(16) NOT NULL CHECK (storage_type IN ('encrypted','external')),
 secret_cipher text,
 encryption_key_id varchar(100),
 secret_ref text,
 status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at timestamptz,
 UNIQUE (organization_id,id),
 CHECK ((storage_type='encrypted' AND secret_cipher IS NOT NULL AND encryption_key_id IS NOT NULL AND secret_ref IS NULL)
     OR (storage_type='external' AND secret_ref IS NOT NULL AND secret_cipher IS NULL AND encryption_key_id IS NULL)),
 CHECK ((status='revoked')=(revoked_at IS NOT NULL))
);

-- 2. 配置主表：稳定身份与当前生效指针；存在新草稿不改变生效版本。
CREATE TABLE app.llm_config (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES app.organization(id),
 code varchar(64) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
 name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
 description varchar(500),
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','enabled','disabled')),
 active_version_id uuid,
 row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 updated_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,code),
 CHECK (status <> 'enabled' OR active_version_id IS NOT NULL)
);

-- 3. 每次保存新增不可变快照；不在已测试或已生效版本上原地修改。
CREATE TABLE app.llm_config_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 config_id uuid NOT NULL,
 version_no integer NOT NULL CHECK (version_no > 0),
 provider_code varchar(64) NOT NULL CHECK (length(btrim(provider_code)) > 0),
 api_protocol varchar(32) NOT NULL CHECK (api_protocol IN ('openai_responses','openai_chat','anthropic_messages','azure_openai')),
 base_url text NOT NULL CHECK (length(btrim(base_url)) > 0),
 model_id varchar(200) NOT NULL CHECK (length(btrim(model_id)) > 0),
 deployment_name varchar(200),
 api_version varchar(64),
 credential_id uuid,
 auth_mode varchar(16) NOT NULL DEFAULT 'api_key' CHECK (auth_mode IN ('api_key','none')),
 parameters jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parameters)='object'),
 required_capabilities jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(required_capabilities)='array'),
 data_policy jsonb NOT NULL DEFAULT '{"allowed_classes":[]}' CHECK (jsonb_typeof(data_policy)='object'),
 context_policy jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(context_policy)='object'),
 timeout_ms integer NOT NULL DEFAULT 60000 CHECK (timeout_ms BETWEEN 1000 AND 300000),
 max_concurrency integer NOT NULL DEFAULT 4 CHECK (max_concurrency BETWEEN 1 AND 100),
 max_retries integer NOT NULL DEFAULT 0 CHECK (max_retries BETWEEN 0 AND 3),
 change_note varchar(500),
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,config_id,id),
 UNIQUE (config_id,version_no),
 FOREIGN KEY (organization_id,config_id) REFERENCES app.llm_config(organization_id,id),
 FOREIGN KEY (organization_id,credential_id) REFERENCES app.llm_credential(organization_id,id),
 CHECK ((auth_mode='api_key')=(credential_id IS NOT NULL))
);
ALTER TABLE app.llm_config ADD CONSTRAINT fk_llm_active_version
 FOREIGN KEY (organization_id,id,active_version_id)
 REFERENCES app.llm_config_version(organization_id,config_id,id);

-- 4. 版本的任务绑定快照。project_id=NULL 表示组织默认；is_active 仅允许发布事务更新。
-- 其余字段不可变。用户在抽屉修改任务/范围也必须产生新的配置版本。
CREATE TABLE app.llm_task_binding (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 version_id uuid NOT NULL,
 project_id uuid,
 task_type varchar(32) NOT NULL CHECK (task_type IN ('fs_generate','fs_review','ts_generate','abap_generate','qa','document_parse')),
 is_active boolean NOT NULL DEFAULT false,
 FOREIGN KEY (organization_id,version_id) REFERENCES app.llm_config_version(organization_id,id),
 FOREIGN KEY (organization_id,project_id) REFERENCES app.project(organization_id,id)
);
CREATE UNIQUE INDEX ux_llm_binding_version_org ON app.llm_task_binding(version_id,task_type) WHERE project_id IS NULL;
CREATE UNIQUE INDEX ux_llm_binding_version_project ON app.llm_task_binding(version_id,project_id,task_type) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX ux_llm_binding_active_org ON app.llm_task_binding(organization_id,task_type) WHERE is_active AND project_id IS NULL;
CREATE UNIQUE INDEX ux_llm_binding_active_project ON app.llm_task_binding(organization_id,project_id,task_type) WHERE is_active AND project_id IS NOT NULL;
CREATE INDEX ix_llm_binding_version ON app.llm_task_binding(organization_id,version_id);
CREATE INDEX ix_llm_binding_project ON app.llm_task_binding(organization_id,project_id);

-- 5. 测试记录：必须精确对应版本；不存提示词、响应原文、请求头或密钥。
CREATE TABLE app.llm_test_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 version_id uuid NOT NULL,
 test_kind varchar(24) NOT NULL CHECK (test_kind IN ('connectivity','generation','capability')),
 status varchar(16) NOT NULL CHECK (status IN ('running','passed','failed','timeout','cancelled')),
 adapter_version varchar(64) NOT NULL,
 credential_fingerprint varchar(128),
 observed_capabilities jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(observed_capabilities)='object'),
 latency_ms integer CHECK (latency_ms >= 0),
 input_tokens integer CHECK (input_tokens >= 0),
 output_tokens integer CHECK (output_tokens >= 0),
 error_code varchar(64),
 safe_message varchar(500),
 started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at timestamptz,
 expires_at timestamptz,
 created_by uuid NOT NULL REFERENCES app.app_user(id),
 FOREIGN KEY (organization_id,version_id) REFERENCES app.llm_config_version(organization_id,id),
 CHECK ((status='running')=(finished_at IS NULL)),
 CHECK (finished_at IS NULL OR finished_at >= started_at),
 CHECK (status <> 'passed' OR (expires_at IS NOT NULL AND expires_at > finished_at))
);
CREATE INDEX ix_llm_config_list ON app.llm_config(organization_id,status,updated_at DESC,id);
CREATE INDEX ix_llm_version_config ON app.llm_config_version(organization_id,config_id,version_no DESC);
CREATE INDEX ix_llm_test_recent ON app.llm_test_run(organization_id,version_id,started_at DESC);

-- 应用层强制约束（DDL 不能替代发布服务）：
-- A. 所有读写从服务端会话获得 organization_id，检查组织角色和项目权限；禁止信任前端租户 ID。
-- B. config_version 与 binding 内容写入后不可修改，数据库运行角色权限/触发器在正式 migration 落地。
-- C. 保存事务锁 config 并核对 row_version；分配 version_no、插入版本和绑定，递增 row_version。
-- D. 发布事务按组织加锁并锁 config；确认 row_version、绑定权限、凭据有效性和适配器参数能力。
--    同版本连通/生成/所需能力测试均须通过且未过期，建议有效期 30 分钟；密钥或适配器变化使测试失效。
--    撤销本配置旧版本的活动绑定；若新任务/范围被其他配置占用，默认报冲突，不静默抢占。
--    激活新版本绑定、切换 active_version_id/status、更新审计记录与 row_version，在同一事务提交。
-- E. 停用事务使本配置全部绑定 is_active=false；保留 active_version_id 供追溯。
--    停用前展示影响范围；当项目绑定被撤销，页面须明确提示后续任务可能使用组织默认。
-- F. 运行时选项目活动绑定，再选组织默认，检查 config.status='enabled' 且 active_version_id=version_id；
--    授权/数据策略失败立即拒绝，不能借组织默认绕过；没有有效配置则返回 MODEL_NOT_CONFIGURED。
--    每次任务固定所解析 version_id，运行中的任务不因后续发布切换；已撤销凭据阻断后续外部请求。
-- G. 回退同样走验证/发布事务，先展示将恢复的历史任务绑定和参数；不可只改版本指针。
-- H. API 密钥用 AES-256-GCM 等认证加密，密钥在数据库外，AAD 绑定组织和凭据 ID；前端不读密文。
--    external 引用应固定外部密钥版本，拒绝可变 latest；轮换创建新 credential/version，重新验证。
-- I. base_url 由服务端校验 HTTPS、域名/IP 白名单、DNS 解析与重定向；本地服务单独授权。
--    parameters/context_policy/data_policy/required_capabilities 按适配器 schema 校验；禁止任意 headers/secret 字段。
--    temperature 仅对支持该参数的模型展示；空值表示不发送；输出 token 上限按已验证模型能力校验。
-- J. 复用 audit_event，记录 save/test/publish/disable/rollback/credential_rotate 和版本 ID，差异值必须脱敏。
-- K. 当前范围不建调用计费/预算/自动故障转移；测试 token 不冒充生产用量。后续用量表独立扩展。
