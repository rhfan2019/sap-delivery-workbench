# SAP 智能交付工作台

Vue 3 + Fastify + PostgreSQL 的全栈 Web 应用，使用 npm workspaces 统一管理前端、后端和共享契约。

**修改项目之前，先读 [目录与依赖契约](docs/architecture/repository-contract.md)。** [AGENTS.md](AGENTS.md) 是自动化开发入口；[重构记录](docs/architecture/refactor-record.md) 说明目录变更和验证结果。

## 快速开始

需要 Node.js 24 LTS（最低 22.12）、npm 10+、运行中的 Docker Desktop/Linux containers。

Windows 双击 `start.cmd`，或在根目录执行 `npm start`。启动器检查目录/依赖、保留已有环境配置，启动数据库并执行迁移与幂等初始化，然后后台启动 API 和前端。

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
    src/modules/             业务模块及自有资源
packages/
  contracts/                 前后端共享的数据结构、校验和协议
    abap-fsd-agent/          FSD 设计助手的共享协议与类型
database/migrations/         版本化数据库变更
scripts/                     开发、数据库、测试、维护和检查命令
tests/
  unit/                      api、web、contracts、tooling 单元测试
  integration/               API 与真实数据库集成测试
  e2e/                       浏览器验收
  fixtures/                  测试样本
infra/production/            Docker 和 Nginx 部署
vendor/abap-adt/              内置第三方 SAP MCP 运行时
docs/                        架构、规格、计划、使用指南和历史报告
.runtime/                    本机数据、凭据、日志、附件和验证产物
```

目录按职责归属，不按某次聊天或生成工具归属。`packages/contracts` 是必需源码，不是缓存。FS 指 Functional Specification（功能规格）。后端模块清单和依赖方向见目录契约。

## 功能边界

保留登录与权限、企业/客户/项目管理、开发清单、模型配置和 SAP 连接。

开发清单按[重构设计](docs/specs/development-list.md)组织：基本信息与 FSD、开发、顾问测试、IT/用户测试四个阶段，开发对象（TADIR 主键）、标签、项目级自定义列、批量修改 / 复制 / 删除、Excel 导入导出；行内的“设计”进入 FSD 设计助手，开发、顾问测试、IT/用户测试 Agent 尚未开放。旧的手工 FS 台账已删除。

FSD 设计助手已按[方向决策](docs/architecture/2026-10-11-fsd-assistant-direction-decision.md)重构为模型主导的智能体 `abap-fsd-agent`（开发项工作区“设计”阶段），目前处于批量测试与优化阶段：进度见[重构实施计划](docs/plans/2026-10-11-abap-fsd-agent-refactor.md)，端到端测试结论与待处理问题见[测试记录](docs/plans/2026-10-12-abap-fsd-agent-e2e-test.md)，接手说明见[交接文档](docs/plans/2026-10-12-abap-fsd-agent-handover.md)。助手运行可在“后台管理 → 审计日志”复核。历史各代助手（LangGraph 版设计助手、FS 智能工作区、旧开发助手、FS助手测试）及其数据已删除；开发助手将以 `abap-dev-agent` 重建，在此之前开发清单中的“开发”按钮只提示即将开放。

## 开发与验证

所有命令从根目录运行：

| 命令                         | 用途                                  |
| ---------------------------- | ------------------------------------- |
| `npm ci`                     | 按锁文件安装全部 workspace 依赖       |
| `npm run setup:env`          | 创建本机环境配置，保留已有 .env       |
| `npm run db:up`              | 启动开发 PostgreSQL                   |
| `npm run db:migrate`         | 执行数据库迁移                        |
| `npm run db:provision`       | 配置受限运行账号                      |
| `npm run bootstrap`          | 幂等业务初始化                        |
| `npm run dev`                | 前台联合运行 API 与 Vite，Ctrl+C 停止 |
| `npm run check:architecture` | 校验目录、导入、包 exports 和测试归属 |
| `npm run check`              | 架构、类型与生产构建                  |
| `npm run test:unit`          | 无主数据库依赖的单元测试              |
| `npm run test:setup`         | 准备独立测试数据库，保留主数据库      |
| `npm test`                   | 全部单元和隔离集成测试                |
| `npm run test:integration`   | 仅隔离集成测试                        |
| `npm run test:e2e`           | 浏览器回归                            |

集成测试配置为 `.runtime/fs-tests.env`，数据库端口 55439，数据库名称必须满足 `sap_fs_test_*dev`。测试命令不会回退到主 `.env`。单元测试与集成测试不调用真实付费模型；实时 SAP 验证使用显式 `npm run verify:sap`。

后端和 contracts 各有独立 package.json/exports；跨 workspace 使用 `@sap-delivery-workbench/*` 包入口。只有一个根锁文件；vendor 的上游锁文件保留。

## 数据、配置与部署

`.env` 为服务端配置，不能放入 `VITE_*` 或提交版本库。`.env.example` 只提供变量名称与非敏感默认值。

`.runtime` 不是可以整目录删除的缓存：它还包含附件、初始凭据、测试环境和进程状态。新的验证证据放 `.runtime/artifacts`，旧根目录产物保存在 `.runtime/archive/pre-refactor`。

数据库迁移只新增后续版本，不改写已应用迁移。生产入口、Docker 多阶段构建与 Nginx 位于 `infra/production`，生产环境要求显式 TLS 和密钥配置；见该目录说明。不要把本地开发配置直接用作生产配置。

更多说明见 [文档索引](docs/README.md)。
