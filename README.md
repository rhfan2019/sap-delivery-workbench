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
    src/worker.mjs           独立后台任务入口
    src/platform/            认证、密码、数据库和运行配置
    src/modules/             业务模块及自有资源
packages/
  contracts/                 前后端共享的数据结构、校验和协议
    fs-workspace/            功能规格工作区契约
    agent-runtime/           助手传输、历史文档协议与纯格式化
    item-workspace/          开发项文档契约
database/migrations/         版本化数据库变更
scripts/                     开发、数据库、测试、维护和检查命令
tests/
  unit/                      api、web、contracts、tooling 单元测试
  integration/               API 与真实数据库集成测试
  e2e/                       浏览器验收
  fixtures/                  测试样本
infra/production/            Docker 和 Nginx 部署
vendor/abap-adt/              内置第三方 SAP MCP 运行时
tools/                       独立工程辅助工具
docs/                        架构、规格、计划、使用指南和历史报告
.runtime/                    本机数据、凭据、日志、附件和验证产物
```

目录按职责归属，不按某次聊天或生成工具归属。`packages/contracts` 是必需源码，不是缓存。FS 指 Functional Specification（功能规格）。后端模块清单和依赖方向见目录契约。

## 功能边界

保留登录与权限、企业/客户/项目管理、交付清单、设计与开发工作稿、独立 FS 工作区、开发助手、模型配置和 SAP 连接。

旧设计助手和 Gem FSD v2 的设计生成接口已停用，返回 `410 DESIGN_ASSISTANT_REMOVED`。历史数据和读取能力保留；目录重构不恢复旧设计引擎。开发助手主提示词在 `apps/api/src/modules/item-workspace/prompts/system.md`。

新的版本化 FSD 后端使用 `work/design/fsd/v1`。原 AgentWorkbench 通过其 `/chat` 协议接入 LangGraph，保留页面模板、样式、多轮对话与实时文本流；断线按持久事件游标续传。原页面的多轮、流式刷新恢复、停止、附件、澄清及两次确认已有隔离浏览器验收，旧设计入口仍返回 410。启动、迁移、检查点、Trace 与实际验收边界见 [ABAP FSD 运行指南](docs/guides/abap-fsd-backend.md)和[实施说明](docs/specs/abap-fsd-implementation.md)。真实 SAP 与业务 PoC 尚未验收。

## 开发与验证

所有命令从根目录运行：

| 命令                         | 用途                                   |
| ---------------------------- | -------------------------------------- |
| `npm ci`                     | 按锁文件安装全部 workspace 依赖        |
| `npm run setup:env`          | 创建本机环境配置，保留已有 .env        |
| `npm run db:up`              | 启动开发 PostgreSQL                    |
| `npm run db:migrate`         | 执行数据库迁移                         |
| `npm run db:provision`       | 配置受限运行账号                       |
| `npm run bootstrap`          | 幂等业务初始化                         |
| `npm run dev`                | 前台联合运行 API 与 Vite，Ctrl+C 停止  |
| `npm run check:architecture` | 校验目录、导入、包 exports 和测试归属  |
| `npm run check`              | 架构、生成契约、类型与生产构建         |
| `npm run test:unit`          | 无主数据库依赖的单元测试               |
| `npm run test:setup`         | 准备独立测试数据库，保留主数据库       |
| `npm test`                   | 全部单元和隔离集成测试                 |
| `npm run test:integration`   | 仅隔离集成测试                         |
| `npm run test:fs -- --unit`  | 仅 FS 范围单元测试                     |
| `npm run test:e2e`           | 全部浏览器回归（Node + Playwright）    |
| `npm run test:playwright`    | Playwright 的完整工作区和组件验收      |
| `npm run generate:fs`        | 从 Schema 重新生成共享 TypeScript 类型 |

集成测试配置为 `.runtime/fs-tests.env`，数据库端口 55439，数据库名称必须满足 `sap_fs_test_*dev`。测试命令不会回退到主 `.env`。单元测试与集成测试不调用真实付费模型；实时 SAP 验证使用显式 `npm run verify:sap`。

后端和 contracts 各有独立 package.json/exports；跨 workspace 使用 `@sap-delivery-workbench/*` 包入口。只有一个根锁文件；vendor 的上游锁文件保留。

## 数据、配置与部署

`.env` 为服务端配置，不能放入 `VITE_*` 或提交版本库。`.env.example` 只提供变量名称与非敏感默认值。

`.runtime` 不是可以整目录删除的缓存：它还包含附件、初始凭据、测试环境和进程状态。新的验证证据放 `.runtime/artifacts`，旧根目录产物保存在 `.runtime/archive/pre-refactor`。

数据库迁移只新增后续版本，不改写已应用迁移。生产入口、Docker 多阶段构建与 Nginx 位于 `infra/production`，生产环境要求显式 TLS 和密钥配置；见该目录说明。不要把本地开发配置直接用作生产配置。

更多说明见 [文档索引](docs/README.md)。
