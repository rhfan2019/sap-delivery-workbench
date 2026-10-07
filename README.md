# SAP 智能交付工作台

ABAP FSD 助手维护入口：[主提示词](packages/agents/abap-fsd-agent/v1/主提示词.md) · [提示词工程完整方案与手工维护指南](packages/agents/abap-fsd-agent/v1/提示词工程完整方案.md)。模型指令全部由 Markdown 加载；FSD 阶段确认与回退由服务端持久化管理。

面向 SAP 实施团队的交付平台，按企业、客户和项目组织工作，逐步贯通 **FS → 开发 → 测试 → 验收**，并在开发后整理正式 TS。

当前已实现 **真实登录与会话、企业/客户/项目和成员管理、开发清单、开发项概览、手工 FS 编辑与版本管理、个人默认项目**，以及后台管理的 **技术验证（临时）** SAP 表结构查询。PostgreSQL 17 当前包含 20 张业务表。平台面向 PC 使用；开发概览驾驶舱、开发/TS、测试、Issue 和历史完整页签暂未实现，已实现 SAP 系统归属、临时授权、项目三环境默认及个人覆盖；AI 自动生成流程尚未接入。

开发管理入口为 **开发概览 / 开发清单**。项目档案仍统一在“企业与客户”维护；右上角切换当前项目，可“设为默认”。开发清单支持新建、搜索筛选、分页、CSV 导出和单字段编辑；单击行打开右侧详情，拖动分隔条调整宽度，双击分隔条复位。双击字段、点击铅笔或按 Enter/F2 进入编辑，点击保存或取消。切换开发项、页签、项目或页面时保护未保存输入。

概览包含责任人、计划日期、需求范围、验收条件、阻塞、备注、附件和最近活动。FS 支持九章手工编写、保存草稿、保存只读版本、章节并排对比和提交开发基线。提交要求有效业务/开发负责人、FS 编号、业务规则、验收条件及初版测试案例，且无阻塞；后续修改草稿不会改写已提交版本。FS 写权限限业务负责人（未分配时为创建人）或项目内企业管理员；普通项目成员可维护台账。归档项目只读。

本批不实现批量编辑、多人实时协作及任何 AI 功能。接口保留行版本与局部字段更新，为后续协作扩展提供基础。筛选及分页目前在已授权项目数据加载后由前端处理，未实现服务端分页。FS 当前显式保存，不自动保存；版本对比为章节并排展示，尚非逐字差异。附件存于本机私有 `.runtime/delivery-files`，单文件 5 MiB，备份需同时包含数据库和该目录。

## 目录

- [技术栈与环境](#技术栈与环境)
- [快速开始](#快速开始)
- [工程结构](#工程结构)
- [环境配置](#环境配置)
- [常用命令](#常用命令)
- [数据库约定](#数据库约定)
- [查看数据库](#查看数据库)
- [开发与验证规范](#开发与验证规范)
- [文档与路线](#文档与路线)
- [常见问题](#常见问题)
- [安全与使用范围](#安全与使用范围)

## 技术栈与环境

| 部分       | 当前选择                                                      |
| ---------- | ------------------------------------------------------------- |
| 前端       | Vue 3、TypeScript、Vite；单文件组件及 Composition API         |
| 工程管理   | npm workspaces；根目录统一 package-lock.json                  |
| 数据库     | PostgreSQL 17；业务 schema 为 app                             |
| 数据库迁移 | node-pg-migrate；SQL 文件入版本管理                           |
| 验证       | Node.js 内置测试运行器 + 真实 PostgreSQL；vue-tsc；Vite build |
| 格式       | Prettier、EditorConfig、Git 行尾规范                          |
| 后端       | Node.js、Fastify、pg、Argon2id；服务端 Cookie 会话            |

先安装：

- Node.js **24 LTS（推荐）**，工具链最低 Node.js 22.12；npm 10 或更高。根目录 `.nvmrc` 指定 24。
- Docker Desktop（Windows）或 Docker Engine，支持 Linux 容器及 Compose v2 的 `--wait` 参数。
- 初次安装需要访问 npm registry；没有本地 PostgreSQL 镜像时需要访问容器镜像仓库。

本机项目目录为 `D:\\Workspace\\sap-delivery-workbench`。仓库内脚本使用相对路径，复制到其他目录后无需修改脚本。

## 快速开始

### Windows 一键启动和关闭（推荐）

先启动 Docker Desktop，双击根目录 **start.cmd**，或执行：

```powershell
.\start.cmd
# 等价：npm start
```

脚本自动补装缺失依赖、生成或保留 .env、启动 PostgreSQL、执行迁移、运行账号配置及幂等业务初始化，再在后台启动 API 与 Vue。打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/) 使用；关闭终端不会关闭后台服务。重复启动复用已有服务；端口占用时不终止其他项目。手工启动的 npm run dev 需先在原终端按 Ctrl+C。

首次初始化创建 `admin` 账号，随机临时密码保存在本机 `.runtime/initial-login.txt`，首次登录必须改密；改密后所有旧会话失效，并重新登录。该文件属于本机私有交接资料，不提交仓库、不发给他人。重复初始化不会重置密码。初始账号是当前企业的管理员，可维护企业、客户、用户与成员；不会初始化虚构客户或项目。默认企业名称为 Inspire。

关闭时双击 **stop.cmd**，或执行：

```powershell
.\stop.cmd
# 等价：npm stop
```

只停止本项目受控的 Vue、API 和 Compose 服务，保留数据库及数据卷，不关闭 Docker Desktop 或其他项目。重复关闭可以安全执行。

启动器使用已有的 Node.js，无需修改 PowerShell 执行策略。后台前端日志为 .runtime/web.log；.runtime 下的进程控制信息仅在本机使用，不提交仓库。关闭只管理本启动器创建的前端，手工启动的 npm run dev 需在原终端关闭。启动失败可能留下数据库，可执行 stop.cmd 关闭。

### 手工启动

下面命令在项目根目录执行。Windows 推荐 PowerShell 7；每一步成功后再执行下一步。

```powershell
cd D:\Workspace\sap-delivery-workbench
npm ci
npm run setup:env
npm run db:up
npm run db:migrate
npm run db:provision
npm run bootstrap
npm run db:test
npm run dev
```

- `setup:env` 从 `.env.example` 生成随机开发密码；已有 `.env` 时不会覆盖。不要直接用空密码模板启动数据库。
- `db:up` 启动独立开发容器，并等待健康检查通过。
- `db:migrate` 应用待执行迁移；再次运行没有新迁移时不修改表。
- `db:provision` 建立受限的应用数据库账号，不会创建工作台业务用户。
- 前端开发地址：[http://127.0.0.1:5173](http://127.0.0.1:5173)。按 Ctrl+C 停止前端。
- `bootstrap` 初始化首个企业与业务账号，将默认企业 ID 写入服务端 .env。数据库用户名不能用于登录工作台。

确认数据库状态：

```powershell
npm run db:status
```

预期数据库名为 `sap_delivery_workbench_dev`，`businessTableCount` 为 `20`。数据库元数据表 `public.pgmigrations` 不计入业务表。

### 停止与再次启动

```powershell
npm run db:stop
npm run db:up
```

停止容器不会删除数据。也可使用 `docker compose down` 删除本项目容器和网络，保留命名数据卷。不要为了修复启动问题执行 `docker compose down -v`：该参数会删除数据库数据卷。

## 工程结构

```text
sap-delivery-workbench/
├─ apps/
│  ├─ web/                     # Vue 3 应用（可运行）
│  │  ├─ public/               # 无需构建处理的静态文件
│  │  ├─ src/
│  │  │  ├─ assets/            # 全局样式与构建资源
│  │  │  ├─ components/        # 跨业务复用组件
│  │  │  ├─ features/          # 按业务功能组织模块
│  │  │  ├─ views/             # 路由级页面
│  │  │  ├─ router/            # Vue Router 与登录导航守卫
│  │  │  ├─ stores/            # 状态管理预留
│  │  │  ├─ services/          # HTTP 客户端与公共请求逻辑
│  │  │  ├─ types/             # 前端内部类型
│  │  │  ├─ App.vue
│  │  │  └─ main.ts
│  │  ├─ index.html
│  │  ├─ tsconfig.json
│  │  └─ vite.config.ts
│  └─ api/                     # Fastify 认证与项目查询服务
│     ├─ src/
│     └─ tests/
├─ packages/
│  └─ contracts/               # 前后端契约预留
├─ database/
│  ├─ migrations/              # 不可随意改写的版本化 SQL
│  └─ seeds/                   # 显式初始化数据预留，当前为空
├─ scripts/
│  └─ lib/                     # 本地数据库工具共用配置
├─ tests/
│  ├─ database/                # 真实数据库集成测试
│  └─ e2e/                     # 端到端测试预留
├─ infra/                      # 后续部署配置预留
├─ docs/                       # 正式文档位置导航
├─ .env.example               # 无真实密码的环境模板
├─ compose.yaml               # 本地开发 PostgreSQL
├─ package.json               # workspace 与统一命令入口
├─ package-lock.json          # 提交并使用 npm ci 复现依赖
└─ README.md
```

空目录通过 `.gitkeep` 保留，不表示对应功能已经实现。已安装 Vue Router，使用 Vue ref 管理最小会话状态；未引入 Pinia。菜单定义位于 `apps/web/src/features/navigation.ts`，样式位于 `apps/web/src/assets/main.css`。

`apps/api` 由根目录启动脚本加载，API 监听 `127.0.0.1:3001`，Vite 在 `127.0.0.1:5173` 同源代理 `/api`。`npm run dev` 同时启动两者；`npm start` 在后台管理两者。根目录管理后端依赖，`packages/contracts` 预留正式接口契约。

## 环境配置

根目录 `.env` 只供 Docker 和本地数据库工具读取。它已被 `.gitignore` 排除，不可提交。

| 变量              | 默认/规则                  | 用途                          |
| ----------------- | -------------------------- | ----------------------------- |
| POSTGRES_HOST     | 127.0.0.1                  | 开发数据库地址                |
| POSTGRES_PORT     | 55432                      | 宿主机端口，容器内部仍是 5432 |
| POSTGRES_DB       | sap_delivery_workbench_dev | 开发数据库名称                |
| POSTGRES_USER     | postgres                   | 本地初始化与迁移身份          |
| POSTGRES_PASSWORD | setup:env 随机生成         | 初始化/迁移密码               |
| APP_DB_USER       | sap_workbench_app          | 固定受限运行身份              |
| APP_DB_PASSWORD   | setup:env 独立随机生成     | 运行身份密码                  |

数据库只绑定回环地址，避免自动暴露到局域网。Compose 固定 PostgreSQL 17.11 的镜像摘要以便复现；后续补丁升级需评审并更新摘要。本机 5432 已被其他项目使用，因此选择 55432。端口冲突时在启动前修改 `.env` 的 `POSTGRES_PORT`。

开发工具默认仅接受回环主机以及以 `_dev` 结尾的数据库。显式 NODE_ENV=production 时允许生产数据库，并强制指定 TLS 策略。根目录 Compose 仍仅供开发；生产使用 infra/production/compose.yaml。

前端不能直连数据库。后续由 `apps/api` 使用应用运行身份访问数据库，并通过 API 向 Vue 提供数据。**不得将密码写入任何 `VITE_*` 变量**，因为此类变量可被打包进浏览器代码。

### 在数据库客户端连接

| 配置            | 值                                 |
| --------------- | ---------------------------------- |
| 主机 / 端口     | 127.0.0.1 / 55432                  |
| 数据库          | sap_delivery_workbench_dev         |
| 业务 schema     | app                                |
| 运行用户名      | sap_workbench_app                  |
| 密码            | 在本机 .env 查看 APP_DB_PASSWORD   |
| 管理/迁移用户名 | postgres，密码见 POSTGRES_PASSWORD |

运行账号允许必要业务读写和追加审计，不允许 DDL、改写审计或读取迁移元数据。后端已实施有效组织/账号/成员校验以及项目成员范围过滤；完整角色、按钮和业务授权尚未实现。

## 常用命令

| 命令                                                    | 说明                               |
| ------------------------------------------------------- | ---------------------------------- |
| npm ci                                                  | 按锁文件安装依赖                   |
| npm run setup:env                                       | 初始化本地配置；保留已存在文件     |
| npm run db:up                                           | 启动数据库并等待健康               |
| npm run db:stop                                         | 停止数据库、保留数据               |
| npm run db:migrate                                      | 执行所有待应用的向前迁移           |
| npm run db:provision                                    | 配置应用运行账号及 M0 权限         |
| npm run db:status                                       | 查看数据库版本、表和迁移清单       |
| npm run db:test                                         | 运行数据库约束与运行身份权限测试   |
| npm run dev                                             | 启动 Vue 开发服务器                |
| npm run typecheck                                       | Vue/TypeScript 类型检查            |
| npm run build                                           | 类型检查并构建前端到 apps/web/dist |
| npm run format                                          | 格式化源码和文档                   |
| npm run format:check                                    | 只检查格式                         |
| npm run check                                           | 格式、类型与生产构建检查           |
| npm run preview --workspace @sap-delivery-workbench/web | 本机预览已构建前端，默认端口 4173  |

当前没有 ESLint 配置，不把格式检查称为代码静态分析。数据库测试需数据库已启动、迁移及运行账号配置已完成。

## 数据库约定

本节说明设计与迁移；查看数据的具体操作见下节“查看数据库”。

### 当前业务表

| 分组           | 表                                                    |
| -------------- | ----------------------------------------------------- |
| 企业与成员     | organization、organization_member                     |
| 客户与项目     | customer、project、project_member                     |
| 登录与认证数据 | app_user、user_password、auth_session、login_throttle |
| 审计           | audit_event                                           |
| 开发管理       | development_item、development_event、development_file |
| FS 草稿与版本  | fs_draft、fs_version                                  |
| 个人项目偏好   | project_preference                                    |

采用明确业务名称，不统一添加 `base_` 或 `tbl_`。组织所属业务关联使用复合外键，防止引用其他组织的数据；日期、状态、编码和会话摘要由约束进一步校验。

### 迁移维护

- `database/migrations/1790899200000_initial-schema.sql` 来源于已批准执行的数据库设计。
- node-pg-migrate 通过 `public.pgmigrations` 记录应用历史，并使用迁移锁和事务；应用运行身份不拥有迁移权限。
- 已应用的 SQL 不再直接编辑。新变更创建新的时间戳迁移文件，以递增文件顺序执行。
- SQL 使用 `-- Up Migration` 与 `-- Down Migration` 分区；事务由迁移工具管理，不嵌套写 BEGIN/COMMIT。
- 本次初始迁移明确拒绝自动向下删除表。需要恢复时使用已验证备份或编写前向修复迁移。
- 新表的运行身份授权需随变更显式设计；不自动给未来所有表开放权限。
- 迁移元数据不提供 SQL 内容校验和保护。应通过代码评审及版本控制保证已执行迁移不被改写。
- 受控 bootstrap 初始化企业与首个账号，不创建示例客户/项目。数据库测试使用事务回滚；认证 HTTP 测试创建独立测试记录并在 finally 中精确清理。

Docker 的 POSTGRES_PASSWORD 只在**空数据卷首次初始化**时设置数据库密码。已有数据卷后修改 .env 不会自动修改数据库密码；应先用有效管理连接执行受控轮换，再同步本地配置。运行账号密码可由 `db:provision` 根据本地配置重新设置。

## 查看数据库

先启动项目。当前默认组织为 **Inspire**，已有初始化管理员；客户、项目表在尚未创建业务数据时为空，属于正常情况。

### 使用 pgAdmin 查看本平台数据库

本平台没有捆绑或启动 pgAdmin。Windows 已安装 pgAdmin 4 时，从开始菜单打开 **pgAdmin 4**，使用其打开的窗口或浏览器页面。未安装时可从 [pgAdmin 官方下载页](https://www.pgadmin.org/download/) 安装桌面版。

本机已存在的 `http://127.0.0.1:5050` 属于其他项目的 pgAdmin 容器，不是本平台组件。本平台启动、关闭脚本不会管理它。若自行使用该容器，应使用该 pgAdmin 实例自己的登录账号。

pgAdmin 网页登录凭据或桌面主密码用于进入客户端、保护保存的连接；它们与下面的 PostgreSQL 数据库账号密码不同，也与平台 `admin` 登录密码不同。

1. 在左侧 **Servers** 上右键，选择 **Register → Server**。
2. **General → Name** 填写 `SAP 智能交付平台（本地）`，此名称仅用于客户端识别。
3. 切到 **Connection**，填写：

| 配置                 | Windows 桌面 pgAdmin             | Docker 容器中的 pgAdmin                  |
| -------------------- | -------------------------------- | ---------------------------------------- |
| Host name/address    | `127.0.0.1`                      | `host.docker.internal`（Docker Desktop） |
| Port                 | `55432`                          | `55432`                                  |
| Maintenance database | `sap_delivery_workbench_dev`     | 同左                                     |
| Username             | `sap_workbench_app`              | 同左                                     |
| Password             | 本地 `.env` 的 `APP_DB_PASSWORD` | 同左                                     |

如果修改过配置，以 `.env` 的 `POSTGRES_PORT`、`POSTGRES_DB`、`APP_DB_USER` 为准。Docker 内的 `127.0.0.1` 指向 pgAdmin 容器自身，不能用它连接宿主机转发的数据库端口。

4. 点击 **Save**，展开 **Servers → 已注册服务器 → Databases → sap_delivery_workbench_dev → Schemas → app → Tables**，可见 20 张业务表。
5. 查看结构：展开表下的 **Columns**；或右键表选 **Properties → Columns / Constraints**，查看字段、主键和约束。
6. 查看记录：右键 `organization` 或 `customer` 等业务表，选择 **View/Edit Data → First 100 Rows**。`organization` 中的 Inspire 是当前组织空间，`customer` 是服务对象，二者不是同一概念。
7. 执行查询：选中数据库，打开 **Tools → Query Tool**，例如 `SELECT id, code, name, status FROM app.organization;`。

运行账号不能读取 `audit_event` 审计历史；管理查看时另建 `postgres` 连接，密码来自 `.env` 的 `POSTGRES_PASSWORD`。文档不保存真实密码。DBeaver 可使用相同数据库连接参数。

### 后台管理入口

**技术验证（临时）**：管理员输入 SAP 表名，通过服务端 abap-adt MCP 返回字段定义 JSON。本机需配置 `SAP_MCP_ENTRY`（受审构建的 `dist/index.js` 绝对路径）和 `SAP_MCP_PROFILE_FILE`（私有 JSON 连接文件），或由服务端环境注入 `SAP_URL`、`SAP_USER`、`SAP_PASSWORD` 等参数。不得放入 `VITE_*`。当前连接不随项目切换，仅用于只读元数据验证。`npm run verify:sap` 可采集真实握手、工具目录和 T000 查询证据，默认保存到 `.runtime/sap-mcp-evidence`；普通 `npm test` 不访问 SAP。详见 [ABAP-ADT MCP 技术验证与云端部署说明](<D:/第二大脑/10-Projects/00. SAP智能交付平台/docs/11. ABAP-ADT MCP技术验证与云端部署说明.md>)。

以企业管理员登录后，进入 **后台管理 → 企业与客户 / 用户与成员**。

- 企业与客户：企业资料、客户新增/编辑/停用、关联项目创建/编辑/归档。归档项目只读。
- 用户与成员：账号新增/编辑/停用/重置临时密码、企业成员管理、项目成员添加/移出。
- 企业成员停用会撤销本企业会话并移出项目；重新启用后需要重新分配项目。账号停用与成员停用分别管理。
- 新账号及重置密码均生成一次性显示的临时密码，下次登录强制改密。禁止当前管理员停用或降级自己。
- 普通成员不能访问管理 API。当前固定两类企业身份（管理员/普通成员）；自定义角色、SSO 和邮件邀请属于后续范围。

现有数据库升级企业名称及首位管理员使用受控命令 `node --env-file=.env scripts/configure-organization.mjs Inspire admin`；该命令不会重置密码，不在每次启动时自动覆盖企业名称。

### 命令行：无需安装本机 psql

在项目根目录执行：

```powershell
docker compose exec postgres psql -U postgres -d sap_delivery_workbench_dev
```

进入后逐条输入：

```text
\conninfo
\dt app.*
\d app.project
SELECT id, code, name, status FROM app.project LIMIT 20;
\q
```

依次为查看连接、列出业务表、查看项目表结构、查询项目和退出。这里只演示只读操作。

不进入交互终端也可查看：

```powershell
npm run db:status
docker compose exec -T postgres psql -U postgres -d sap_delivery_workbench_dev -c "SELECT table_name FROM information_schema.tables WHERE table_schema='app' ORDER BY table_name;"
```

查看字段的 SQL（可在图形客户端或 psql 执行）：

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'app' AND table_name = 'project'
ORDER BY ordinal_position;
```

## 开发与验证规范

1. 安装依赖使用根目录 npm workspace 和锁文件，不在子目录另建一份锁文件。
2. TypeScript 开启 strict；Vue 页面与领域数据分离，组件不得包含数据库凭据。
3. 新增数据库行为时，补充真实约束/事务测试；避免只检测 SQL 文本。
4. 修改业务表时同时检查组织范围、外键、索引、归档/删除策略和迁移兼容性。
5. 时间保存为 timestamptz；开发数据库会话使用 UTC，界面按用户时区显示。
6. 提交前至少执行：

```powershell
npm run check
npm run db:test
npm run db:status
```

数据库测试仅在指定开发库运行，不得向生产或其他项目数据库运行。`npm test` 验证真实 HTTP/数据库认证与项目隔离、Vite 开发入口；`npm run db:test` 验证表约束和运行身份。浏览器交互已人工验证；尚未建立独立自动化浏览器回归套件。

建议后续代码评审记录：变更目的、影响范围、数据库迁移、测试结果和回退/恢复方式。当前没有配置远程仓库或 CI 服务，不显示虚假的构建徽章，也未自动提交或推送代码。

## 文档与路线

正式中文文档按项目约定维护在：

`D:\\第二大脑\\10-Projects\\00. SAP智能交付平台\\docs`

- [需求设计](<D:/第二大脑/10-Projects/00. SAP智能交付平台/docs/01. 需求设计v0.2.md>)
- [数据库设计](<D:/第二大脑/10-Projects/00. SAP智能交付平台/docs/02. 数据库设计v0.1.md>)
- [基础工程实施记录](<D:/第二大脑/10-Projects/00. SAP智能交付平台/docs/03. 基础工程实施记录.md>)
- [开发清单与 FS 首批实施记录](<D:/第二大脑/10-Projects/00. SAP智能交付平台/docs/10. 开发清单与FS首批实施记录.md>)

这些是本机绝对路径；其他开发者需取得文档副本或使用团队文档位置。数据库运行及迁移不依赖这些外部文档路径，所需 SQL 已进入本项目。

后续按可验收功能逐步建设：

1. 已完成后端认证、首个企业及账号初始化、真实登录/退出/改密与菜单布局。
2. 已实现企业、客户、项目和成员管理；完整角色权限后续专题实现。
3. 已实现开发清单、概览及手工 FS 草稿/版本；继续完善 FS，再建设后续页签。
4. 代码基线、真实 SAP/MCP 连接与开发检查。
5. 测试案例、执行证据、缺陷修复及验收闭环。
6. 公共知识、代码资产和模型配置治理。

## 常见问题

**Docker 无法连接：** 启动 Docker Desktop，确认 Linux 容器引擎可用，再运行 `docker version` 和 `npm run db:up`。

**端口被占用：** 检查 55432 是否空闲；在 .env 修改端口后重新运行 `db:up`。前端 5173 使用严格端口模式，占用时会明确报错，不会静默换端口。

**提示缺少 .env 或密码：** 运行 `npm run setup:env`。如果文件已存在但内容不完整，应手工补齐；脚本不会覆盖已有配置。

**修改 .env 后数据库认证失败：** 已有数据卷不会自动更新数据库密码，按上面的密码轮换说明处理，不要删卷碰运气。

**运行账号看不到审计历史：** 这是当前最小权限设计；运行账号只允许写入 audit_event，不允许查询、修改或删除历史审计。

**前端可以打开但不能登录：** 请从根目录使用 npm start 或 npm run dev，同时启动 API 与 Vue；不要仅运行 web workspace。使用 127.0.0.1 地址，来源校验不接受其他域名。确认已执行 bootstrap、数据库已启动；重复失败会触发 15 分钟限流。

**重启后表消失：** 确认使用相同 Compose 项目名、数据库名及命名数据卷，检查是否曾执行带 -v 的删除命令。不要对空库直接覆盖恢复已有业务数据。

## 安全与使用范围

- .env、备份、会话令牌、客户资料和真实 SAP/模型凭据不进入代码仓库。
- PostgreSQL 管理账号仅用于开发初始化/迁移，后端运行使用独立受限账号。
- 本项目尚未实施完整身份授权、生产加固和 SAP 集成，不能据此对外承诺生产可用。
- 目前未授予开源许可证，package.json 标记为 private / UNLICENSED；正式授权范围由项目所有者决定。

## 认证与接口

- `npm run bootstrap`：幂等初始化；已有账号不重置密码，无有效本地成员时明确报错。
- `npm test`：认证/项目隔离集成测试及开发入口测试。
- `GET /api/session`：当前用户、企业与强制改密状态。
- `POST /api/login`：账号密码登录；`POST /api/logout`：撤销当前会话。
- `POST /api/password`：验证旧密码后修改，并撤销该账号所有会话。
- `GET /api/projects`、`GET /api/projects/:id`：仅返回有效成员有权访问的项目。

会话空闲 30 分钟、最长 8 小时；随机令牌仅在 HttpOnly Cookie 中，数据库保存 SHA-256 摘要。密码使用 Argon2id（64 MiB、3 次、并行度 1），新密码 12–128 字符。账号/来源 IP 分别限制每 15 分钟最多 10/60 次认证尝试（成功也计数），限流数据原子写入 PostgreSQL。改密前拒绝项目 API。所有修改请求必须与 APP_ORIGIN 精确同源；本地默认 http://127.0.0.1:5173。当前代理共享回环 IP 限流，生产部署须设计可信反向代理与真实客户端 IP 策略。

DEFAULT_ORGANIZATION_ID 由 bootstrap 写入 .env，仅服务端读取。生产 HTTPS 来源启用 Secure 与 __Host- Cookie，当前本地 HTTP 仅使用专用本地 Cookie。生产使用独立容器入口与 HTTPS 代理配置，云端仍需部署验收。

- [SAP 连接设计](<D:/第二大脑/10-Projects/00. SAP智能交付平台/docs/12. SAP连接设计.md>)：系统归属、临时授权、三环境参数、个人覆盖、凭据保护与验证证据。

## 腾讯云生产部署

生产架构采用 **Nginx HTTPS 静态 Web → Fastify API → PostgreSQL**，API 和数据库没有宿主机公开端口。前端采用 Vite 构建产物，不运行开发服务器。容器在 Linux 内安装锁定依赖；附件通过 `DELIVERY_FILES_DIR` 持久化至独立目录。生产配置、密钥、TLS、首次迁移/provision/bootstrap、健康检查、备份恢复和升级回滚命令见 [生产运行手册](infra/production/README.md)。

生产入口为 `scripts/serve.mjs`；API 的 `/api/health/live` 检查进程，`/api/health/ready` 检查数据库连接。数据库生产连接由 `NODE_ENV=production` 显式启用，远程数据库使用 `POSTGRES_SSL_MODE=verify-full` 验证证书；仅 Compose 内部 postgres 服务允许显式禁用 TLS。`APP_ORIGIN` 必须是 HTTPS origin，API 仅信任指定 Nginx 代理地址。

生产模板包含 SAP 与模型独立 64 位十六进制凭据主密钥，`LLM_ALLOWED_HOSTS` 是精确域名白名单。密钥必须与数据库、附件一致备份；备份脚本停写以保证一致性，恢复脚本拒绝覆盖已有数据。配置与日志不可包含用户密码、令牌或模型/SAP明文凭据。

**本次仅补齐可审查的部署条件，未实际发布或验证腾讯云。** 云端 HTTPS、VPC/VPN、证书续期、备份恢复演练、监控告警和真实 SAP/模型连接仍是上线验收项；单 CVM 方案不提供高可用。

## 大模型配置（第三套列表与抽屉，2026-10-03）

组织管理员从「后台管理 → 大模型配置」进入。新增模型后保存、测试，再点击星形设为组织默认。当前默认模型编辑后保存为新版本；旧默认版本继续生效，测试新版本后须显式点击「应用已验证修改」。默认模型禁止删除，其他模型逻辑删除并保留版本历史。测试通过只表示该版本最近一次文本调用成功，不是实时在线保证；设置默认要求最近测试在 30 分钟有效期内。

本轮只建立模型注册表和默认解析入口，不实施 FS、TS、代码生成的操作分配页面，也不启用这些 AI 业务。数据库迁移新增 llm_model、llm_model_version、llm_credential、llm_test_run、llm_default；凭据以独立 AES-GCM 密钥加密，版本不可原位覆盖。

本地 `.env` 中配置 `LLM_CREDENTIAL_KEY`（独立随机 64 位十六进制，不可随意替换）和 `LLM_ALLOWED_HOSTS`（逗号分隔的服务商精确域名）。例如允许 `api.example.com` 时，接入地址填 `https://api.example.com/v1`，不含 `/chat/completions` 等操作路径。域名仅为语法示例，不是可用服务。空白名单会阻止连接测试；更改环境后重启 Web/API。运行账号不返回密钥明文。

当前适配 OpenAI Chat、OpenAI Responses、Anthropic Messages 文本探测，只允许白名单内公网 HTTPS 地址，禁止跳转和内网目标。私有网关/内网模型暂未开放；OpenAI 兼容服务仍需验证其参数兼容性，尤其推理模型和输出 Token 参数。没有填入用户真实密钥或执行真实服务商调用。

`npm test` 运行全部应用测试（含模型、SAP、部署配置和 UI 渲染），`npm run db:test` 运行数据库测试，`npm run check` 执行格式、类型及生产构建检查。只在本地开发库执行测试。交付记录见正式文档「11. 大模型配置与待实施事项交付记录.md」，视觉证据见工程 `design-qa.md`。


### FSD 运行时间预算

FSD 流式调用及整轮执行不设置总时长截止；首个数据及连续无数据等待各最多 120 秒，持续推理可继续，用户可手动停止。数据库保存事务最多 15 秒、失败终态写入最多 5 秒。详见 [FSD 测试问题修复记录](docs/fsd-issue-fixes-2026-10-06.md)。
