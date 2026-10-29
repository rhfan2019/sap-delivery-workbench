# SAP 智能交付工作台

Vue 3 + Fastify + PostgreSQL 的全栈 Web 应用，使用 npm workspaces 统一管理前端、后端和共享契约。

**修改项目之前，先读 [目录与依赖契约](docs/architecture/repository-contract.md)。** [AGENTS.md](AGENTS.md) 是自动化开发入口；[重构记录](docs/architecture/refactor-record.md) 说明目录变更和验证结果。

## 快速开始

需要 Node.js 24 LTS（最低 22.12）、npm 10+、运行中的 Docker Desktop/Linux containers。

Windows 双击 `start.cmd`，或在根目录执行 `npm start`。启动器检查目录/依赖（架构检查不通过只告警，不阻止启动）、保留已有环境配置，启动数据库并执行迁移与幂等初始化，然后后台启动 API 和前端，逐项确认数据库、API、前端页面与代理都可用后才提示启动成功。开机后首次启动需要较长时间（可能一分钟左右）。

打开 http://127.0.0.1:5173/home 。前端端口为 5173，API 为 3001，开发数据库映射到 55432。前端同源代理 `/api`。

首次登录账号为 `admin`，随机临时密码保存在本机 `.runtime/initial-login.txt`，首次登录必须改密。不要提交或分享该文件。重复启动不会重置账号。

双击 `stop.cmd` 或运行 `npm stop` 停止受管组件，保留数据库卷和附件。启动日志为 `.runtime/web.log`。不要使用 `docker compose down -v` 修复启动问题。

## 工程地图

```text
apps/
  web/                       Vue 浏览器应用
    src/features/            按业务组织的页面、状态和专属组件
    src/components/          公共 UI
    src/router/              路由与导航
    src/services/            HTTP 和会话
  api/                       Fastify 服务端应用
    src/app.mjs              应用组装
    src/server.mjs           生产服务入口
    src/platform/            认证、密码、数据库和运行配置
    src/modules/             业务模块及自有资源（提示词、模板等只供本模块使用的资源也放这里）
      admin/                 企业资料、客户、账号、项目与项目主数据
      access/                权限内核：权限点检查、角色、复合角色、职位、企业级与项目内分配
      delivery/              开发清单：开发项、四个阶段、开发对象、标签、自定义列、Excel
      item-workspace/        开发项工作区的访问上下文
      agent-core/            智能体公共运行层：循环、事件推送、附件解析、SAP 只读工具
      abap-fsd-agent/        FSD 设计助手：文档工具、版本与批注；prompts/system.md 为系统指令
      abap-dev-agent/        ABAP 开发助手：开发方案与代码、框架加载、代码校验；prompts/ 与 frameworks/
      audit/                 后台审计日志与助手运行评论
      models/                模型配置与调用
      sap/                   项目 SAP 系统、个人 SAP 凭据与保存策略、测试数据
      technical/             技术验证
packages/
  contracts/                 前后端共享的数据结构、校验和协议
    abap-fsd-agent/          FSD 设计助手的共享协议与类型
    access/                  权限点目录、预置角色与职位（前后端共用）
    projects/                项目主数据的选项（类型、状态、SAP 产品、模块、里程碑等）
database/migrations/         版本化数据库变更
scripts/                     开发、数据库、测试、维护和检查命令
tests/
  unit/                      api、web、contracts、tooling 单元测试
  integration/               API 与真实数据库集成测试
  e2e/                       浏览器验收
  fixtures/                  测试样本
infra/production/            Docker 和 Nginx 部署
infra/dev/                   本机开发用的 Docker 配置（pgAdmin 服务器登记）
vendor/abap-adt/              内置第三方 SAP MCP 运行时
docs/                        架构、规格、计划、使用指南和历史报告
.runtime/                    本机数据、凭据、日志、附件和验证产物
```

目录按职责归属，不按某次聊天或生成工具归属。上图只到主要目录；每个目录的归属规则、模块职责与依赖方向以[目录与依赖契约](docs/architecture/repository-contract.md)第 2～4 节为准，模块之间的调用登记在 `docs/architecture/module-dependencies.json`。`packages/contracts` 是必需源码，不是缓存。FS 指 Functional Specification（功能规格）。后端模块清单和依赖方向见目录契约。

## 功能边界

平台定位为实施方内部的交付生产工具（[平台定位方向决策](docs/architecture/2026-10-17-platform-positioning-decision.md)）。保留登录、企业/客户/项目管理、开发清单、模型配置；权限、项目主数据、项目 SAP 系统与设置菜单按[项目主数据、权限与设置菜单设计](docs/specs/project-access-admin.md)实现：

- **权限**：基于角色的访问控制。权限点（`资源:动作`）→ 单一角色 → 复合角色，职位带出默认角色；企业级分配带项目范围，项目内分配带模块范围、“仅本人负责”与有效期。所有接口经 `access` 模块校验，被拒绝时返回缺少的权限点。
- **项目主数据**：基本信息与 SAP 系统形态、SAP Activate 阶段与里程碑、团队与干系人、规模与商务、每周健康度；开发清单页头显示开发冻结倒计时。
- **项目 SAP 系统**：每个项目登记自己的开发与测试系统（不含生产、不存账号）；每个人用本人的 SAP 用户登录，可“本次登录有效”或按企业策略加密保存。
- **设置**：图标栏“设置”按个人、项目、企业、智能体、审计与运维分组，全量列出菜单（未实现的标“规划中”），按权限显示。

开发清单按[重构设计](docs/specs/development-list.md)组织：基本信息与 FSD、开发、顾问测试、IT/用户测试四个阶段，开发对象（TADIR 主键）、标签、项目级自定义列、批量修改 / 复制 / 删除、Excel 导入导出；行内的“设计”进入 FSD 设计助手，“开发”进入 ABAP 开发助手（报表、功能类），顾问测试、IT/用户测试 Agent 尚未开放。旧的手工 FS 台账已删除。

FSD 设计助手已按[方向决策](docs/architecture/2026-10-11-fsd-assistant-direction-decision.md)重构为模型主导的智能体 `abap-fsd-agent`（开发项工作区“设计”阶段），目前处于批量测试与优化阶段：进度见[重构实施计划](docs/plans/2026-10-11-abap-fsd-agent-refactor.md)，端到端测试结论见[测试记录](docs/plans/2026-10-12-abap-fsd-agent-e2e-test.md)，待处理问题见[待办与问题清单](docs/plans/backlog.md)，接手说明见[交接文档](docs/plans/2026-10-12-abap-fsd-agent-handover.md)。助手运行可在“设置 → 审计日志”复核。历史各代助手（LangGraph 版设计助手、FS 智能工作区、旧开发助手、FS助手测试）及其数据已删除。

ABAP 开发助手 `abap-dev-agent`（开发项工作区“开发”阶段）首版已实现：按[方向决策](docs/architecture/2026-10-13-abap-dev-agent-direction-decision.md)，它与设计助手同构，输入可以是设计助手的 FSD、上传的资料，也可以只是自然语言需求，产出开发方案和一份继承 `YCL_FRH_REPORT` 的完整可执行程序，支持批注修订、版本差异、上传或从 SAP 同步交回代码；首版只做报表与功能类，开发清单中其他类型的“开发”按钮仍提示即将开放。后端在 `apps/api/src/modules/abap-dev-agent/`（系统指令在 `prompts/`，框架类内置副本在 `frameworks/`），两个助手共用的循环、事件、附件解析和 SAP 只读工具在 `agent-core`，共用的前端工作台在 `features/agent-workbench`。进度见[实施计划](docs/plans/2026-10-14-abap-dev-agent-implementation.md)，测试结论与问题见[端到端测试](docs/plans/2026-10-14-abap-dev-agent-e2e-test.md)。

## 开发与验证

所有命令从根目录运行：

| 命令                         | 用途                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm ci`                     | 按锁文件安装全部 workspace 依赖                                                                  |
| `npm run setup:env`          | 创建本机环境配置，保留已有 .env                                                                  |
| `npm run db:up`              | 启动开发 PostgreSQL                                                                              |
| `npm run db:admin`           | 启动本项目的 pgAdmin（127.0.0.1:5051），用法见[查看开发数据库](docs/guides/database-browsing.md) |
| `npm run db:admin:stop`      | 停止 pgAdmin                                                                                     |
| `npm run db:migrate`         | 执行数据库迁移                                                                                   |
| `npm run db:provision`       | 配置受限运行账号                                                                                 |
| `npm run bootstrap`          | 幂等业务初始化                                                                                   |
| `npm run dev`                | 前台联合运行 API 与 Vite，Ctrl+C 停止                                                            |
| `npm run check:architecture` | 校验目录、导入、包 exports 和测试归属                                                            |
| `npm run check`              | 架构、类型与生产构建                                                                             |
| `npm run test:unit`          | 无主数据库依赖的单元测试                                                                         |
| `npm run test:setup`         | 准备独立测试数据库，保留主数据库                                                                 |
| `npm test`                   | 全部单元和隔离集成测试                                                                           |
| `npm run test:integration`   | 仅隔离集成测试                                                                                   |
| `npm run test:e2e`           | 浏览器回归                                                                                       |

集成测试配置为 `.runtime/fs-tests.env`，数据库端口 55439，数据库名称必须满足 `sap_fs_test_*dev`。测试命令不会回退到主 `.env`。单元测试与集成测试不调用真实付费模型；实时 SAP 验证使用显式 `npm run verify:sap`。

后端和 contracts 各有独立 package.json/exports；跨 workspace 使用 `@sap-delivery-workbench/*` 包入口。只有一个根锁文件；vendor 的上游锁文件保留。

## 数据、配置与部署

`.env` 为服务端配置，不能放入 `VITE_*` 或提交版本库。`.env.example` 只提供变量名称与非敏感默认值。

`.runtime` 不是可以整目录删除的缓存：它还包含附件、初始凭据、测试环境和进程状态。新的验证证据放 `.runtime/artifacts`，旧根目录产物保存在 `.runtime/archive/pre-refactor`。

数据库迁移只新增后续版本，不改写已应用迁移。生产入口、Docker 多阶段构建与 Nginx 位于 `infra/production`，生产环境要求显式 TLS 和密钥配置；见该目录说明。不要把本地开发配置直接用作生产配置。

更多说明见 [文档索引](docs/README.md)。
