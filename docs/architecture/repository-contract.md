# 仓库目录与依赖契约

版本：1.21。日期：2026-10-30。适用范围：本仓库的源码、资源、测试、脚本、文档和部署配置。

1.21 变更：依据[开发概览设计](../specs/development-overview.md)（用户 2026-10-30 确认），新增后端模块 `development-overview`（开发概览统计，见 3.6）与前端 feature `development-overview`。统计需要开发清单、变更历史、两个助手的定稿与轮次、项目里程碑，而助手模块经 item-workspace 依赖 delivery，统计放进 delivery 会形成循环，所以单独成模块，只经各模块的公开入口读取：delivery 的 `context.mjs`（新增只读的 `overview`）、abap-fsd-agent 与 abap-dev-agent 的 `public.mjs`（新增 `finalizedItems`、`lastTurns`、`itemComments`，开发助手另有 `itemCoverage`）、admin 的 `keyedMilestones`。前后端共用的统计口径放 `packages/contracts/delivery/overview.mjs`（浏览器可用）。新增依赖边登记见 module-dependencies.json。

1.20 变更：根目录登记 `.workbuddy`（WorkBuddy 助手在本机写入的记忆，与 `.claude` 同类，整体不入库）。此前它未登记，`npm start` 第一步的架构检查失败，API 与前端均未启动，浏览器打不开 `http://127.0.0.1:5173/home`。架构检查是提交前的门槛，不是本机启动的前提：启动器（`start.cmd` / `npm start`）遇到检查不通过只告警、继续启动；并在 PostgreSQL、API（含数据库连接）、Vue 页面与依赖预构建、前端到 API 的代理都确认可用后，才报告启动成功。

1.19 变更：用户 2026-10-18 要求本项目有独立的 pgAdmin 查看开发库与表关系图。根 `compose.yaml` 新增 `pgadmin` 服务（`tools` profile，不随 `npm start` 启动，只监听 127.0.0.1:5051），命令 `npm run db:admin` / `db:admin:stop`；本机开发用的 Docker 配置文件放 `infra/dev/`（首个文件 `pgadmin-servers.json`），与 `infra/production/` 并列。登录账号取 `.env` 的 `PGADMIN_DEFAULT_EMAIL`、`PGADMIN_DEFAULT_PASSWORD`，数据库密码在容器启动时写入容器内 pgpass，不入库。说明见 [查看开发数据库与表关系图](../guides/database-browsing.md)。

1.18 变更：依据[平台定位方向决策](2026-10-17-platform-positioning-decision.md)与[项目主数据、权限与设置菜单设计](../specs/project-access-admin.md)（用户 2026-10-17 确认）：

- **权限内核**：新增后端模块 `access`（见 3.5），负责权限点检查、角色、复合角色、职位与分配；表用 `app.access_` 前缀。所有模块的授权一律经 `access/public.mjs`，不再判断“是否企业管理员”或“是否项目成员”；`app.organization_member.access_level` 删除（原管理员迁移为超级管理员分配，原项目成员迁移为该项目的 `C_ARCHITECT`）。权限点目录、预置角色与职位是前后端共用的纯数据，放 `packages/contracts/access/catalog.mjs`（浏览器可用）。
- **项目主数据**：admin 模块新增项目字段与子表 `app.project_phase`、`app.project_milestone`、`app.project_module_lead`、`app.project_contact`、`app.project_health`。
- **项目 SAP 系统**：SAP 系统改为按项目登记（`app.project_sap_system`），个人凭据 `app.sap_user_credential`、保存策略 `app.sap_credential_policy`，均归 sap 模块；原 `app.sap_system`、`app.sap_system_grant`、`app.project_sap_config`、`app.user_project_sap_config` 连同数据删除（用户授权“不再使用的数据表请删除”），`app.sap_test_data_run.system_id` 的外键删除、历史值保留。开发项增加目标开发系统 `development_item.sap_system_id`。3.4 节同步修改。
- **设置区**：前端图标栏“后台管理”改为“设置”，菜单按个人、项目、企业、智能体、审计与运维分组并全量列出（未实现的页面打开统一的“规划中”页面）；页面地址统一为 `/settings/...`，原 `/workspace/admin`、`/workspace/organization`、`/workspace/organization-profile`、`/workspace/members`、`/workspace/models`、`/workspace/connections`、`/workspace/technical-verification`、`/workspace/audit…` 与旧个人设置 `/settings` 页删除，不保留跳转。前端新增 feature：`settings`（概览、个人资料与公共排版）、`access`（角色、职位、成员与权限）、`projects`（项目设置页）；规划中的页面沿用 `WorkspaceView` 的“规划中”页面。
- **新增检查**（第 9 节）：`apps`、`packages`、`scripts`、`tools`、`infra` 中不得再出现 `access_level`、`canManageOrganization` 与已删除的 SAP 表名；`apps/api` 中只有 `access` 模块可以引用 `app.access_` 表。
- **实施补充**（同日完成实施时登记）：项目主数据的选项是前后端共用的纯数据，放 `packages/contracts/projects/options.mjs`（浏览器可用，附 `.d.mts`）；`packages/contracts/access/catalog.mjs` 同样附 `.d.mts`。`app.project_member` 由 access 维护（成员身份是授权的一部分）。部署脚本（bootstrap、configure-organization）经 `@sap-delivery-workbench/api/access` 导出调用 `grantSuperAdmin`。各业务模块与智能体模块（含 item-workspace）都依赖 access，登记见 module-dependencies.json。接口错误响应在 `message` 之外可带机器可读的 `code` 与 `details`（如 `ACCESS_DENIED` 附缺少的权限点、`SAP_LOGIN_REQUIRED` 附系统）。前端设置区的公共排版（页面、卡片、字段、列表表格、抽屉、行尾 ⋯ 菜单、原生控件样式）归 `features/settings/`，`features/admin/` 只放企业资料、客户、项目一览与用户页面，`features/sap/` 放项目 SAP 系统、个人凭据、安全策略、系统一览与登录对话框。

1.17 变更：用户 2026-10-17 确认删除 1.14 的主题偏好：`GET/PUT /api/preferences` 与 `apps/api/src/platform/preferences.mjs` 删除，迁移 `1792500000000_drop-user-preference` 删除 `app.user_preference` 表及其数据（向下迁移只重建空表）。1.14 中关于该表与接口的规定废止。

1.16 变更：Plain 重写第 7 批完成，`assets/theme.css` 末尾的 1.x 过渡变量名全部删除，页面一律引用 DESIGN.md 第 9 节的令牌；检查器新增规则：`apps/web/src` 的样式中每个 `var(--…)` 必须是 theme.css 的令牌或前端代码自己声明的属性（Tailwind `--tw-`、reka-ui `--reka-` 运行时属性除外），旧变量名因此不能再被引用。开发项标签颜色（`--tag-*`，按名称存储）与模型抽屉宽度 `--layout-drawer` 保留为正式令牌。

1.15 变更：依据[重写计划](../plans/2026-10-17-plain-style-redesign.md)（用户 2026-10-17 确认），前端界面层参照 Plain 重写，规范为 [DESIGN.md 2.0](../specs/DESIGN.md)。只保留一套外观（深色跟随系统），取消 1.14 的主题换肤：`apps/web/src/assets/themes/` 与主题包在第 1 批删除，届时 1.13 的检查规则不再放宽到该目录，`assets/theme.css` 恢复为唯一允许写颜色、字体、字号、字重、间距、圆角取值的文件，并新增阴影与动效时长同样只能取自令牌；前端不再调用 `GET/PUT /api/preferences`，该接口与 `app.user_preference` 的删除另行经用户确认。前端新增依赖 `@tanstack/vue-table`（开发清单表格），全部迁移后删除 `vxe-table`、`vxe-pc-ui`。公共界面组件归 `apps/web/src/components/`；组件展示页只在开发环境可用。后端、契约包与前端数据逻辑层不在本次重写范围内。

1.14 变更：依据[主题系统实施计划](../plans/2026-10-16-theme-system.md)（用户 2026-10-16 确认），前端支持用户一键切换主题。主题包放 `apps/web/src/assets/themes/<主题>.css`，每个主题一个文件；它与 `assets/theme.css` 同为允许写颜色、字体、字号、字重、间距、圆角取值的文件（1.13 的检查规则同步放宽到该目录）。主题字体以 npm 字体包按需加载，不引用外网字体。用户的主题与明暗模式存 `app.user_preference`，归 platform（与账号、密码同层），接口为 `GET/PUT /api/preferences`。

1.13 变更：用户 2026-10-16 要求全站严格按设计规范取值。界面风格的唯一规范是 [docs/specs/DESIGN.md](../specs/DESIGN.md)，令牌以 CSS 变量定义在 `apps/web/src/assets/theme.css`（唯一允许写颜色、字体、字号、字重、间距、圆角取值的文件）。`apps/web/src` 下其余样式（`.css` 与 `.vue` 的样式块）只能引用令牌，模板不得使用 Tailwind 调色板颜色类；第三方内置组件 `components/ai-elements`、`components/ui` 除外（其颜色经 `elements.css` 映射到令牌）。改风格时改 DESIGN.md 与 theme.css，不逐页修改。新增检查规则见第 9 节。

1.12 变更：用户 2026-10-16 澄清各助手使用的 SAP 系统，并决定 FSD 阶段只写测试数据需求：设计助手默认连接 QAS（含业务数据，用于梳理逻辑），开发助手默认连接 DEV，测试助手（预留）使用 QAS；对话界面可按消息选择 DEV 或 QAS。设计助手不再查找或建立测试单据，测试数据的查找与建立工具保留在公共层，留给 abap-test-agent。见 3.4 节。

1.11 变更：根目录登记 `.claude`（Claude 桌面端预览配置 `launch.json`，本机工具配置，与 `.vscode` 同类，不入库）。

1.10 变更：用户 2026-10-16 要求本机测试时自动登录 QAS：非生产环境下，可用 `SAP_MCP_PROFILE_FILE` 指定的本机凭据文件登录测试系统，仅当文件中的地址与 client 与项目 QAS 配置一致；生产环境禁用。见 3.4 节“个人凭据”。

1.9 变更：用户 2026-10-16 决定取消建单白名单（维护工作量过大）：建单代码可调用任何 BAPI、函数模块和类，用户逐次授权与审阅代码是唯一的放行环节；黑名单留待确有需要时再设计，暂不实施。以新增迁移删除 `app.sap_system_allowlist`，后台“SAP 系统”页面不再提供白名单。语句级静态审查（禁止直接写库、动态调用等）保留。见 3.4 节。

1.8 变更：依据 [FSD 附录 D 测试案例计划](../plans/2026-10-15-fsd-test-cases.md)（用户 2026-10-15 确认阶段 2），智能体对 SAP 的访问由“只读”扩展为“只读 + 经用户逐次授权、在 QAS 创建测试数据”。创建能力归 sap 模块（白名单、会话级个人凭据、临时类执行与运行记录），agent-core 只提供查询测试系统与申请建单的工具定义和执行编排；PRD 一律拒绝。新增表 `app.sap_system_allowlist`、`app.sap_test_data_run` 归 sap。见 3.4 节；新增检查规则见第 9 节。

1.7 变更：依据 [ABAP 开发助手方向决策](2026-10-13-abap-dev-agent-direction-decision.md) 与[实施计划](../plans/2026-10-14-abap-dev-agent-implementation.md)（用户 2026-10-14 确认），新增两个后端模块：`agent-core`（智能体公共运行层）与 `abap-dev-agent`（开发助手）；预留 `abap-test-agent`；规定智能体提示词与运行资源的放置和命名；两个助手共用的前端工作台外壳归 `features/agent-workbench/`，共用的流事件协议归 `packages/contracts/agent-core/`。设计助手的循环、事件缓冲、附件解析、SAP 只读工具在实施计划阶段 A 迁入 `agent-core`，迁出后不保留转发。见 3.1 节；新增检查规则见第 9 节。

1.6 变更：依据[开发清单重构设计](../specs/development-list.md)（用户 2026-10-12 确认），delivery 模块的开发清单按新字段口径重建：删除 delivery 自有的手工 FS 台账（`fs_draft`、`fs_version` 表、`/fs` 接口与前端 FS 章节编辑器），替代 3.1 节“保留”的规定；现有开发项及其关联数据（含设计助手会话）按用户授权清除；新增共享契约 `packages/contracts/delivery`（字段目录与选项，前后端共用）；Excel 导入导出在后端完成，新增依赖 `exceljs`。见 3.3 节。

1.5 变更（勘误，不改规则与检查器）：删除第 3 节末尾已失效的“开发助手主提示词归 item-workspace/prompts”。按 1.3 与 3.1 节，item-workspace 中的开发助手后端及其提示词已清除，开发助手预留为 abap-dev-agent，实现时其系统指令归该模块的 `prompts/`。

1.4 变更：新增 audit 模块（平台审计与日志分析），承载后台“审计日志”页面的接口、助手运行评论和优化建议；助手运行数据仍归 abap-fsd-agent，audit 只通过 `abap-fsd-agent/public.mjs` 读取。优化建议由 Claude Code 按需分析后经维护脚本发布，平台不内置定时分析。见 3.2 节。

1.3 变更：依据 [FSD 设计助手方向决策](2026-10-11-fsd-assistant-direction-decision.md)，FSD 设计助手改为模型主导的智能体，在现有项目中完全重构，统一命名为 abap-fsd-agent，开发助手预留命名 abap-dev-agent。智能助手只保留一个版本：不设版本目录、版本化 API 路径或版本化表名。历史各代 FS/FSD 助手（design-assistant 的 LangGraph 链路、gem-fsd-v2、agent、旧 abap-fsd-agent 引擎即 agent-runtime、fs-workspace 功能规格工作区、开发助手后端、“FS助手测试”）及其 410 边界、契约、表与数据全部清除，不保留转发壳或停用边界；现行设计助手前端界面保留并迁入新 feature。此项为用户明确授权，替代 1.1、1.2 中关于 LangGraph 后端、`work/design/fsd/v1` 入口、agent-runtime 公开入口和“旧 unavailable 边界不变”的规定。新边界见 3.1 节；新增检查规则见第 9 节。

1.2 变更：design-assistant 可通过既有 agent-runtime/public.mjs 复用材料解析、模型文本流传输和只读历史投影；通过 item-workspace/public.mjs 获取工作稿基准及按原文档合同采用内容。不复用或恢复历史设计执行器。聊天轮次与用户可见流事件归 design-assistant，自有数据库迁移归 database/migrations，诊断事件不承载聊天正文。依赖方向及公开入口检查规则不变。

1.1 变更：授权新的 ABAP FSD LangGraph 后端归 design-assistant，旧 unavailable 边界不变；新入口为 work/design/fsd/v1。其运行资源归本模块，纯共享协议归 contracts/design-assistant。新增跨模块调用仅通过 item-workspace/public.mjs（工作区授权）、models/public.mjs（冻结模型配置及传输）、agent-runtime/public.mjs（材料解析）、sap/public.mjs（受控 SAP 连接）；依赖清单与架构检查同步登记，禁止 design-assistant 深层导入这些模块。

这是本项目选择并执行的工程约定，不宣称是所有 Web 应用的唯一标准。目标是让每个文件有唯一责任归属，让前后端、共享代码与工程工具之间的边界可检查。

## 1. 架构选择

采用 npm workspaces 管理的模块化单体：一个 Vue 浏览器应用、一个 Fastify 服务端应用，以及必要的共享契约包。保留 apps/web 和 apps/api 的通用命名，不增加微服务、框架或业务功能。

后端按业务模块组织；模块内部按需要设置 routes、service、repository 等文件，不为凑齐层次创建空目录。前端按业务 feature 组织；通用组件、页面路由和网络基础设施各自独立。

## 2. 顶层目录职责

| 目录               | 唯一职责                                                                         | 禁止放入                                           |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| apps/web           | Vue 页面、交互、前端资源和构建配置                                               | 数据库连接、服务端凭据、后端业务实现               |
| apps/api           | HTTP 服务、后台任务、业务模块及服务端配置                                        | Vue 组件、个人会话记录、临时验证产物               |
| packages/contracts | 多个消费者共享的数据结构、校验、协议和纯函数                                     | 数据库查询、权限决策、Agent 执行器、服务启动副作用 |
| database           | 已版本化迁移、显式初始化资料                                                     | 应用运行时连接配置、数据库备份和真实数据导出       |
| scripts            | 开发、构建、测试、数据库维护、导入等命令入口                                     | 被生产业务反向依赖的公共实现                       |
| tests              | 按测试层级分类的测试与固定样本                                                   | 产品运行必须读取的资源                             |
| infra              | Docker、Nginx、生产部署配置（`production/`）与本机开发用的 Docker 配置（`dev/`） | 业务逻辑                                           |
| tools              | 有明确用途、说明和维护边界的独立工程工具                                         | 产品运行时依赖、无入口的临时脚本                   |
| vendor             | 必需的第三方内置源码/分发包、许可与版本说明                                      | 自有业务代码                                       |
| docs               | 与代码版本对应的架构、规格、计划、运维与验收资料                                 | 产品运行时数据来源、个人助手记忆                   |
| .runtime           | 本机私有状态、附件、凭据、日志及隔离测试环境（忽略提交）                         | 应提交的业务源码                                   |

根目录只保留统一入口及工具要求的配置：README、AGENTS、package.json、单一锁文件、start.cmd、stop.cmd、compose.yaml、编辑器/格式/Git 配置及测试配置。本机工具配置目录 `.vscode`、`.claude`、`.workbuddy` 允许存在，其中 `.claude`、`.workbuddy` 整体不入库。不新增 frontend/backend、src、common 等与上述结构重叠的根目录。

## 3. 应用内部边界

```text
apps/
  web/
    src/
      features/<business>/    # 业务页面、状态、API 适配与专属组件
      components/            # 真正跨业务复用的界面组件
      views/                 # 登录、首页等应用级页面
      router/                # 页面路由与导航守卫
      services/              # HTTP、会话等浏览器基础设施
      lib/                   # 无业务归属的前端纯工具
      assets/                # 样式、图片等前端资源
      types/                 # 仅前端使用的类型
  api/
    src/
      app.mjs                # 组装应用，不放业务实现
      server.mjs             # 生产 HTTP 入口
      platform/              # 认证、密码、数据库与生产配置
      modules/<business>/    # 业务模块与其自有运行资源
```

后端现有模块：admin（组织/用户/客户/项目与项目主数据）、access（权限内核，见 3.5）、delivery（交付台账）、item-workspace（开发项工作区）、models（模型配置与调用）、sap（SAP 连接）、technical（技术验证）、abap-fsd-agent（FSD 设计助手，见 3.1）、abap-dev-agent（ABAP 开发助手，见 3.1）、agent-core（智能体公共运行层，见 3.1）、audit（平台审计与日志分析，见 3.2）、development-overview（开发概览统计，见 3.6）。各模块在第一次放入真实文件时创建，不创建空目录。

fs-workspace 中的 FS 是 Functional Specification，不是文件系统。除 3.1 授权的设计助手重构外，URL、数据库表名和历史协议字段不因内部目录改名而改变。

### 3.1 智能助手边界（agent-core / abap-fsd-agent / abap-dev-agent）

- **命名**：FSD 设计助手在后端模块、前端 feature、共享契约、提示词、API 路径和数据库表中统一使用 `abap-fsd-agent`（表名用 `abap_fsd_agent_` 前缀）；开发助手统一使用 `abap-dev-agent`（表名用 `abap_dev_agent_` 前缀）；测试助手预留 `abap-test-agent`，设计前不建目录。不再使用 design-assistant、fsd、fsd-agent、fs-workspace、agent-runtime 等同义名称。
- **职责**：abap-fsd-agent 是模型主导的 FSD 设计智能体，负责对话、FSD 文档及其版本、批注、模型调用编排、SAP 只读查询与文档校验。abap-dev-agent 是模型主导的开发智能体，负责对话、开发方案与代码及其版本与依据、批注、框架加载、代码交回（上传与 SAP 同步）与代码静态校验。业务方法论与交付标准写在系统指令中，不写成固定流程节点或阶段状态机。
- **公共运行层**：agent-core 承载各智能体共用、且与产物无关的能力：智能体循环（步数与工具调用上限、繁忙重试、重复调用拦截、取消）、进程内事件缓冲与续传、附件解析、SAP 只读工具（白名单、SELECT 限制、结果截断）、测试系统查询与测试数据申请（见 3.4）、历史消息投影。它不含任何智能体的提示词、产物、表或路由，通过参数接收工具、系统指令与持久化回调；不依赖任何智能体模块。判断标准：各智能体都用、并且与产物无关的才放这里，不为假想的智能体设计扩展点。
- **提示词与运行资源**：系统指令放在各智能体模块的 `prompts/`，不跨模块共享，业务分析方法在各助手中各写一份。主指令统一命名 `system.md`；按开发类型加载的部分以开发类型命名（如 `report.md`），该类型的完整范例命名为 `<类型>-example.abap`；模块名即命名空间，文件名不加 `fsd-`、`dev-` 等前缀；`prompts/` 下不建子目录。参考源码等运行资源不放进 `prompts/`：开发助手的框架类内置副本放 `abap-dev-agent/frameworks/`，每个类一个 `.abap` 文件。
- **单一版本**：上述各处不得出现 `v1`、`v2` 等版本层级。API 入口为 `/api/projects/:projectId/development-items/:itemId/abap-fsd-agent` 与 `/api/projects/:projectId/development-items/:itemId/abap-dev-agent`。
- **历史清除**：以下资产全部删除，不保留 410、转发或兼容壳：design-assistant 模块（含 `unavailable.mjs`）；agent-runtime 模块（旧 abap-fsd-agent 引擎，含 `/api/admin/abap-fsd-agent` 与开发助手挂载）；fs-workspace 模块及其前端、契约；item-workspace 中的开发助手后端；“FS助手测试”菜单、页面与诊断页；`packages/contracts` 下 design-assistant、agent-runtime、fs-workspace 及空的旧 abap-fsd-agent 目录；上述各代迁移所建的表与数据（含 `fsd_checkpoint` 模式）；仅服务这些代码的测试、工具、脚本、npm 命令和部署配置。删除前按第 8 节检查引用。
- **保留的前端**：现行设计助手界面（开发项工作区设计阶段及其使用的对话、附件、决策卡片等组件）保留，迁入 `apps/web/src/features/abap-fsd-agent/` 后改接新 API；只删除仅服务“FS助手测试”和已删除后端的部分。
- **数据库**：已执行的迁移文件不改写、不删除；以新增迁移删除旧表并创建新表。旧表数据不备份（用户已明确放弃）。delivery 模块自有的 FS 台账表（`fs_draft`、`fs_version`）不属于助手，由 1.6 / 3.3 节删除。
- **跨模块调用**：agent-core、abap-fsd-agent、abap-dev-agent 调用其他模块一律经对方的 `public.mjs`，依赖边登记见 module-dependencies.json；不得深层导入。abap-dev-agent 经 item-workspace 取得开发项、开发清单字段与开发项文件（不直接依赖 delivery），经 `abap-fsd-agent/public.mjs` 读取 FSD 版本。模型工具调用能力由 models 模块的公开接口提供。SAP 工具只向模型暴露预置的只读能力。
- **共享契约**：`packages/contracts/agent-core` 放各助手共用的流事件协议；`packages/contracts/abap-fsd-agent`、`packages/contracts/abap-dev-agent` 只放各自特有的前后端纯协议（如文档、版本、来源、依据与批注结构）；不放执行器、提示词或模型调用。
- **前端**：各助手共用的工作台外壳与组件（对话时间线、输入框、附件、提问卡片、运行步骤）放 `apps/web/src/features/agent-workbench/`；`features/abap-fsd-agent/`、`features/abap-dev-agent/` 只放各自的产物面板与配置，二者不得互相导入。
- **日志分析**：智能助手日志分析基于新表重建，不读取已删除的表。

### 3.2 平台审计与日志分析（audit）

- **职责**：设置区“审计日志”页面：助手运行日志（统计、筛选、单轮下钻）、操作审计（`app.audit_event`）、对助手运行的评论、优化建议的展示。需要 `audit:view`（评论需要 `audit:comment`）。
- **数据归属**：评论与优化建议表归 audit（`app.audit_` 前缀）。助手运行的轮次、消息、工具调用仍归 abap-fsd-agent，audit 只通过 `abap-fsd-agent/public.mjs` 读取，不直接查询其表。
- **优化建议**：由 Claude Code 在用户要求时，用 `scripts/maintenance/export-assistant-logs.mjs` 导出日志与评论、分析后，用 `scripts/maintenance/publish-proposal.mjs` 发布到页面。平台不调用模型生成建议，也不设定时任务。
- **跨模块调用**：audit → abap-fsd-agent（`public.mjs`）、audit → admin（授权写入上下文），登记见 module-dependencies.json。

### 3.3 开发清单（delivery）

- **职责**：项目开发清单：开发项（基本信息与四个阶段）、开发对象、标签、项目级自定义列、批量操作、Excel 导入导出、附件与变更历史。表结构以[开发清单重构设计](../specs/development-list.md)为准。
- **数据归属**：`app.development_item`、`app.development_item_phase`、`app.development_item_object`、`app.development_tag`、`app.development_item_tag`、`app.development_field`、`app.development_event`、`app.development_file`、`app.development_phase_transition`（阶段状态流水，开发概览二期起由保存开发项时写入）归 delivery。其他模块只读开发项，经 delivery 的 `context.mjs`（登记于 module-dependencies.json）取得。
- **阶段负责人**：助手与开发项的修改权限由 access 判断（`agent.fsd:run`、`agent.dev:run`、`delivery.item:edit` 等）；分配限定“仅本人负责”时，设计助手看 `fsd` 阶段负责人，开发助手看 `development` 阶段负责人，开发项修改看任一阶段负责人或创建人。
- **目标开发系统**：`development_item.sap_system_id` 引用项目 SAP 系统（开发用途），为空时取项目默认开发系统。
- **共享契约**：`packages/contracts/delivery` 只放字段目录、选项和纯函数（浏览器可用），不放校验副作用、数据库查询或权限决策。
- **不保留**：手工 FS 章节编辑（由设计助手替代）、开发项“阶段 / 验收条件 / 阻塞原因”等旧字段及其兼容接口。

### 3.4 项目 SAP 系统、个人凭据与测试数据（sap）

- **项目 SAP 系统**：每个项目登记自己的开发系统与测试系统（`app.project_sap_system`：名称、用途、SID、ADT 地址、Client、语言、默认、状态），不保存用户名和密码；不存在生产系统。设计助手默认使用项目默认测试系统，开发助手默认使用开发项的目标系统或项目默认开发系统，测试助手（预留）使用测试系统；用户可在对话界面为每条消息选择项目已启用的任一系统（1.12 的“DEV / QAS”改为具体系统）。设计助手的附录 D 只写测试场景和数据需求，不查找、不建立测试单据。
- **个人凭据**：SAP 用户和密码必须是用户本人的，经一次登录验证后保存：“本次登录有效”只存 API 进程内存（按登录会话与系统），“加密保存”存 `app.sap_user_credential`（AES-256-GCM，附加认证数据绑定用户、系统、地址、Client 与 SAP 用户，有效期与闲置期按 `app.sap_credential_policy`）。凭据只用于本人的请求，接口与日志不返回、不记录密码；登录被拒时立即作废，不自动重试。本机开发环境（`NODE_ENV` 不是 production）另可用 `SAP_MCP_PROFILE_FILE` 指定的本机凭据文件登录，仅当文件中的地址与 client 与所选项目系统一致。
- **边界**：智能体对 SAP 默认只读。唯一的写操作是为测试案例创建业务单据：只在项目登记的**测试系统**执行；需要 `sap.test_data:create`，每次执行前由用户在界面逐次授权，授权只对该次请求有效。
- **职责归属**：sap 模块负责项目 SAP 系统、个人凭据与保存策略、建单代码的静态审查与执行、运行记录。agent-core 负责模型工具定义（查询测试系统、申请建单）与在轮次中编排执行；各智能体只决定是否启用这些工具及如何写入自己的产物。
- **执行方式**：程序生成固定前缀的临时类（`$TMP`，实现 `IF_OO_ADT_CLASSRUN`），类定义由程序生成，模型只提供主方法正文；正文可以调用任何 BAPI、函数模块和类（不设白名单；黑名单暂不实施），但禁止直接数据库写、动态调用、`SUBMIT`、`CALL TRANSACTION`、文件与内核调用等。依次建对象、写源码、语法检查、激活、运行，运行后删除临时类。MCP 的写入类工具（`createObject`、`lock`、`unLock`、`setObjectSource`、`activateByName`、`runClass`、`deleteObject`）只允许在 `sap/test-data.mjs` 中出现。
- **数据归属**：`app.project_sap_system`、`app.sap_user_credential`、`app.sap_credential_policy`、`app.sap_test_data_run`（授权人、目标系统、类名与正文、调用的函数、输出、结果）归 sap；凭据的保存、作废、删除与建单同时写 `app.audit_event`。

### 3.5 权限内核（access）

- **职责**：权限点检查（企业级与项目级，含项目范围、模块范围、仅本人负责与有效期）、角色与复合角色、职位、企业级分配与项目内分配、权限报表，以及启动时同步预置角色与职位（`syncBuiltInRoles`）。设计见[项目主数据、权限与设置菜单设计](../specs/project-access-admin.md)第 2 节。
- **数据归属**：`app.access_role`、`app.access_role_permission`、`app.access_role_composition`、`app.access_position`、`app.access_position_role`、`app.access_assignment`、`app.access_project_role` 归 access；`app.app_user` 的 `position_id`、`person_type`、`skill_modules` 列由 access 维护。其他模块不得直接查询这些表。
- **公开入口**：`access/public.mjs`。其他模块用它取得企业级权限、项目权限与可见项目，或在不满足时抛出 403（附缺少的权限点）/ 404（范围外项目）。
- **共享契约**：`packages/contracts/access/catalog.mjs` 只放权限点目录、预置角色、预置职位与选项（纯数据与纯函数，浏览器可用），不放权限决策。
- **跨模块调用**：admin、delivery、sap、models、audit、technical、item-workspace、abap-fsd-agent、abap-dev-agent → access，登记见 module-dependencies.json；access 不导入其他业务模块。

### 3.6 开发概览统计（development-overview）

- **职责**：“开发管理 → 开发概览”的接口 `GET /api/projects/:projectId/development-overview` 与跨项目的 `GET /api/development-portfolio`（企业级 `delivery.portfolio:view`）：按[开发概览设计](../specs/development-overview.md)的口径汇总开发项、风险、里程碑、负载、预算与开发组视图。需要 `delivery.overview:view`，按分配的模块范围与“仅本人负责”过滤；他人负载与姓名需要 `delivery.overview.team:view`，预算需要 `project.commercial:view`。
- **数据归属**：本模块没有自己的表，只读。开发项与变更历史经 delivery 的 `context.mjs`（`overview`），助手的定稿与轮次经 abap-fsd-agent、abap-dev-agent 的 `public.mjs`，里程碑与自报健康度经 admin 的 `keyedMilestones`、`latestHealth`，可见项目与企业级权限经 access 的 `public.mjs`；不直接查询其他模块的表。
- **共享契约**：风险、完成、到期、计划缺口、里程碑越线、交接与下钻筛选等判定只写在 `packages/contracts/delivery/overview.mjs`，本模块与开发清单前端共用，保证概览数字与下钻后的清单条数一致。
- **跨模块调用**：development-overview → delivery、abap-fsd-agent、abap-dev-agent、admin、access，登记见 module-dependencies.json。

认证和连接配置属于 platform；只供一个业务使用的提示词、模板和资源放该业务模块内。禁止为单一消费者新增 packages/agents。

同一模块允许相对路径。模块间只依赖明确的公开入口；本轮先消除应用/包/工具之间的越界，现有业务模块间调用在依赖清单中显式登记，不能借重命名声称业务解耦已经完成。新增跨业务深层导入须先调整公开接口与契约。

## 4. 依赖方向与包接口

允许：web → contracts；api → contracts；api/modules → api/platform；scripts → api 的工具用公开 exports / contracts；tests → 被测应用、契约和工具；独立 tools → contracts，以及 API 显式导出的离线诊断接口。后者只消费后端能力，后端不得反向依赖工具。

禁止：web → api、scripts、Node 专用 contracts 入口；api → web、scripts、tests、docs、tools；contracts → 应用或工程目录；产品代码 → 测试 fixture / 文档 / 本地输出。共享包不得循环依赖。

apps/api、apps/web、packages/contracts 各自声明直接依赖。根 package.json 仅维护编排与工程工具；根锁文件统一锁定版本。vendor/abap-adt 为第三方独立分发包，保留其上游锁文件。

跨 workspace 的源码 import 必须使用 @sap-delivery-workbench/contracts 或 @sap-delivery-workbench/api 的显式 exports，禁止 ../../../../packages 等物理深层导入。相对文件 URL 可以用于模块自有资源和受管理的数据路径；跨包读取 Schema 使用导出的资源子路径和 import.meta.resolve。

contracts 区分 Node 校验入口与浏览器可用的纯函数/类型入口。前端不得导入读取文件系统的 Node 校验模块。types.ts 是生成类型，不手工修改；Schema/registry 是生成来源。契约版本 v1 是数据兼容性版本，不等于旧设计引擎版本。

## 5. 测试归属

统一保留根 tests，避免同时出现应用 tests 与根 tests 两套归属：

- tests/unit/api：不需要真实数据库的后端行为。
- tests/unit/web：前端模型、组件、Vite 加载行为。
- tests/unit/contracts：数据契约校验与生成一致性。
- tests/unit/tooling：目录检查器、配置与工程工具行为。
- tests/integration/api：需要真实 PostgreSQL 的 API / worker 行为。
- tests/integration/database：迁移、权限和表结构。
- tests/e2e：浏览器访问完整应用；夹具放 tests/fixtures。

测试按实际依赖分类，不以原文件夹名称判断层级。测试发现必须递归；每个测试文件只能属于一个默认测试分组，禁止移动后不再运行。外部 SAP/模型真实调用和浏览器 E2E 使用显式命令，不在默认单元测试中产生付费调用。

集成测试必须使用隔离测试库，不回退到主 .env。迁移已有测试时保留业务断言，不通过删除断言或跳过测试获得通过。

## 6. 工程脚本与文档

scripts/dev：本地联合启动、受管进程控制；scripts/database：迁移、配置、初始化；scripts/testing：测试发现、隔离环境和测试服务；scripts/maintenance：显式数据导入；scripts/vendor：第三方准备；scripts/checks：架构验证。按现有需要创建，不创建空目录。

生产服务入口归 apps/api/src；需要独立后台进程时，入口同样放在 apps/api/src。scripts 可以编排应用，应用不能导入 scripts/lib。平台数据库/生产配置应由 api 的公开工具接口复用；只用于导入的解析工具留 maintenance。

docs/architecture 放唯一架构契约与审计；docs/specs 放版本化设计规格；docs/plans 放实施计划；docs/guides 放现行说明；docs/archive 放历史报告。文档按内容归类，不按生成它的 AI 工具名称归类。测试需要的 JSON/Schema 示例迁入 tests/fixtures，不能继续依赖 docs 的布局。

历史说明不改写成现行事实；在入口标记历史状态。当前 README 必须能指出真实运行入口、目录、命令和已停用能力。个人工具记忆不是产品资料，归本机忽略区。

## 7. 本机资料与迁移安全

新生成的验证证据统一写 .runtime/artifacts；临时下载写 .runtime/cache。历史 artifacts、outputs、runs、artifacts_to_be_deleted 先登记后归入 .runtime/archive，不能根据名字永久删除。

.runtime 不是可整目录清空的缓存：它还包含附件、初始凭据和进程状态。数据库卷、.env、已有附件路径默认保持。涉及存储路径变更必须单独迁移并验证数据完整性。

本次误删恢复来源固定为用户指定的 D:\Workspace\sap-delivery-workbench - 副本 (2)。仅恢复当前依赖的契约和开发提示词；保留来源/目标/哈希清单，不覆盖当前已存在文件，不恢复旧设计执行器或规则包。

## 8. 新增、修改和删除流程

1. 确定文件属于应用、共享契约、工具、测试、文档还是本机数据；再选择所属业务。
2. 检查相同职责是否已有位置；优先扩展已有模块，不复制第二套实现。
3. 变更跨包接口时同步更新 exports、消费者和契约测试。
4. 移动/删除前检查 import、动态加载、文件 URL、命令字符串、Docker COPY、测试发现和文档链接。
5. 在同一变更中完成消费者迁移，不保留旧路径转发壳、重复资源或临时 alias。
6. 如需新增顶层目录或改变依赖方向，先修改本契约及检查规则，再实施。

## 9. 可执行验收

npm run check:architecture 必须检查：受控根目录、workspace 清单、跨应用违规依赖、应用反向导入 scripts、contracts 反向依赖、跨包物理路径、缺失本地导入、前端 Node 校验入口，以及测试文件是否被发现。检查器自身必须有违规反例测试。

1.18 新增检查：`apps`、`packages`、`scripts`、`tools`、`infra` 中不得出现 `access_level`、`canManageOrganization`、`app.sap_system`（整词）、`app.sap_system_grant`、`app.project_sap_config`、`app.user_project_sap_config`；`apps/api` 中除 `apps/api/src/modules/access/` 外不得引用 `app.access_` 表。

1.13 新增检查：`apps/web/src` 下除 `assets/theme.css` 与 `components/ai-elements`、`components/ui` 外，样式中不得出现颜色字面值（十六进制、`rgb()`/`hsl()` 等函数、颜色名称，含自定义属性的值）、字体族名称、`px`/`rem` 字号、数字或 `bold` 字重、`padding`/`margin`/`gap` 的 `px`/`rem` 值与 `border-radius` 的字面值；`.vue` 模板不得使用 Tailwind 调色板颜色类或在内联样式中写颜色；前端代码不得以字符串写十六进制颜色。取值一律引用 theme.css 的变量（允许 `calc()`、`color-mix()` 组合令牌，允许 `em` 相对字号）。

1.8 新增检查：`apps/api/` 下除 `apps/api/src/modules/sap/test-data.mjs` 外，不得以字符串形式引用 MCP 写入类工具名（`createObject`、`lock`、`unLock`、`setObjectSource`、`activateByName`、`runClass`、`deleteObject`），保证所有 SAP 写入都经过代码审查、用户授权与运行记录。

1.7 新增检查：版本目录禁令扩展到 agent-core、abap-dev-agent、agent-workbench 的后端模块、前端 feature 与共享契约；agent-core、abap-fsd-agent、abap-dev-agent 跨模块导入必须指向对方的 `public.mjs`（原只约束 abap-fsd-agent）；智能体模块 `prompts/` 下只允许 `.md` 与 `<类型>-example.abap` 文件且不得有子目录，`frameworks/` 下只允许 `.abap` 文件；前端 `features/abap-fsd-agent` 与 `features/abap-dev-agent` 不得互相导入。

1.3 新增检查（与历史助手清除在同一变更中启用，因为清除完成前现有代码必然违反）：abap-fsd-agent 的后端模块、前端 feature、共享契约与提示词目录中不得出现版本目录段（`/v<数字>/`）；`apps`、`packages`、`scripts`、`tools`、`infra` 中不得出现已清除的模块目录（design-assistant、agent-runtime、fs-workspace、fs-assistant-test），现行源码不得引用历史助手标识（`fsd_v1_`、`/work/design/fsd`、`gem-fsd-v2`、`work/design/agent`、`/api/admin/abap-fsd-agent`、`DESIGN_ASSISTANT_REMOVED`、`fsd_checkpoint`），已执行的历史迁移文件除外。前端可用契约清单随契约导出同步更新。

重构完成条件：架构检查通过；生成契约一致；类型检查与生产构建通过；单元与隔离集成测试通过；start.cmd 启动后 /home 与 /api/health 可访问；停用设计接口保持 410；Docker 构建路径与 npm workspace 一致；迁移清单可追溯。受外部条件影响未验证的项目必须明确标记，不得宣称已验证。

契约变更必须更新版本、原因和检查器。AGENTS.md 要求后续所有目录/依赖变更先读本文件。自动检查与代码评审共同执行本契约；文档本身不等于已经具备自动约束。
