# SAP 开发者导读

写给有 SAP 二次开发、Fiori 经验，第一次接触 Web 全栈项目的人。用熟悉的 SAP 概念对照本仓库，帮助快速建立整体印象。目录归属的唯一规范仍是[目录与依赖契约](../architecture/repository-contract.md)，本页只做导读，与契约冲突时以契约为准。

## 1. 一句话结构

前端（Vue）→ 后端（Node.js）→ 数据库（PostgreSQL）。前后端各按业务模块分包，模块名一一对应：

```text
apps/web/src/features/<模块>/    前端：页面与交互
apps/api/src/modules/<模块>/     后端：接口、业务逻辑、读写表
packages/contracts/<模块>/       前后端共用的数据结构
database/migrations/             所有表结构变更
```

其余目录都是辅助：脚本、测试、部署、第三方组件和文档。

## 2. 与 SAP 的对照

| 本项目                                      | SAP / Fiori 对应物                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web/`（Vue 前端）                     | Fiori 应用的 `webapp/`                                                        |
| `apps/web/src/router/index.ts`              | `manifest.json` 的 routing：URL 对应哪个页面                                  |
| `apps/web/src/features/<模块>/*.vue`        | View + Controller（Vue 把模板、逻辑、样式写在一个文件里）                     |
| `apps/web/src/services/session.ts` 的 `api` | ODataModel：前端统一通过它调用后端 `/api/...`                                 |
| `apps/web/src/assets/theme.css`             | 主题（Theme Designer）：颜色、字号等只能在这里定义                            |
| `apps/api/src/app.mjs`                      | 服务注册（`/IWFND/MAINT_SERVICE`）：把各模块的接口挂上来                      |
| `apps/api/src/modules/<模块>/routes.mjs`    | SEGW / RAP 服务定义：对外有哪些接口                                           |
| `apps/api/src/modules/<模块>/*.mjs`         | DPC_EXT 及其调用的业务类                                                      |
| `apps/api/src/modules/<模块>/store.mjs`     | 读写表的 Open SQL 部分                                                        |
| `apps/api/src/platform/`                    | 基础层：登录认证、密码、数据库连接                                            |
| `packages/contracts/`                       | SE11 结构 / 数据元素 / 域值：前后端共用的字段和校验                           |
| `database/migrations/*.sql`                 | SE11 建表 + 传输请求：按时间戳顺序导入，已导入的不能改                        |
| `tests/`                                    | ABAP Unit 与测试脚本                                                          |
| `scripts/`                                  | SE38 工具报表：启动、迁移、测试、架构检查                                     |
| `infra/production/`                         | Basis 层：Docker 与 Nginx 部署                                                |
| `infra/dev/`                                | 本机开发用的 Docker 配置（pgAdmin，见[查看开发数据库](database-browsing.md)） |
| `vendor/`、`node_modules/`                  | 第三方组件与依赖，不读不改                                                    |
| `.runtime/`                                 | 本机运行数据：日志、附件、凭据，**不能删**                                    |
| `package.json` 的 `scripts`                 | 常用事务码清单：`npm start`、`npm test` 等                                    |

## 3. 业务模块

| 模块                 | 做什么                                  | 前端                                                         | 后端                           |
| -------------------- | --------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| delivery             | 开发清单：开发项、四个阶段、标签、Excel | `features/delivery`                                          | `modules/delivery`             |
| admin                | 组织、用户、项目管理                    | `features/admin`、`features/projects`、`features/settings`   | `modules/admin`                |
| development-overview | 开发概览与开发排期（只读统计）          | `features/development-overview`、`features/development-load` | `modules/development-overview` |
| access               | 权限点、角色、职位与分配                | `features/access`                                            | `modules/access`               |
| sap                  | SAP 系统连接与 MCP                      | `features/sap`                                               | `modules/sap`                  |
| models               | 大模型配置与调用                        | `features/models`                                            | `modules/models`               |
| audit                | 审计日志与助手运行评论                  | `features/audit`                                             | `modules/audit`                |
| abap-fsd-agent       | FSD 设计助手                            | `features/abap-fsd-agent`                                    | `modules/abap-fsd-agent`       |
| abap-dev-agent       | ABAP 开发助手                           | `features/abap-dev-agent`                                    | `modules/abap-dev-agent`       |
| agent-core           | 两个助手共用的智能体运行层              | `features/agent-workbench`                                   | `modules/agent-core`           |

可以把每个模块当作一个开发包：一次只看当前关心的那一个。助手的系统指令（提示词）放在各自模块的 `prompts/` 下。

## 4. 走通一条链路：开发清单

相当于在 Fiori 里从界面一路调试到表，走完一条，其他模块是同样的套路。

1. 页面：[DeliveryView.vue](../../apps/web/src/features/delivery/DeliveryView.vue)
2. 前端数据处理：[model.ts](../../apps/web/src/features/delivery/model.ts)
3. 字段目录（前后端共用）：[fields.mjs](../../packages/contracts/delivery/fields.mjs)
4. 接口清单：[routes.mjs](../../apps/api/src/modules/delivery/routes.mjs)
5. 业务逻辑与校验：[items.mjs](../../apps/api/src/modules/delivery/items.mjs)、[validation.mjs](../../apps/api/src/modules/delivery/validation.mjs)
6. 读写表：[store.mjs](../../apps/api/src/modules/delivery/store.mjs)
7. 表定义：[1791900000000_development-list-rebuild.sql](../../database/migrations/1791900000000_development-list-rebuild.sql)
8. 功能设计：[开发清单重构设计](../specs/development-list.md)

## 5. 两种反查方法

- **从界面找代码**：看浏览器地址栏的 URL，在 [router/index.ts](../../apps/web/src/router/index.ts) 里找到对应的 `.vue` 文件，相当于从 Launchpad tile 找到对应 app。
- **从接口找代码**：按 F12 打开开发者工具 → Network，看页面调用了哪个 `/api/...`，在 `apps/api/src/modules` 里全局搜这个路径，就能找到对应的 `routes.mjs`。这和在 Fiori 里用 `/IWFND/ERROR_LOG` 加断点追 OData 调用是一个思路。

## 6. 文档怎么读

`docs/` 下大部分是过程记录，相当于历史传输请求的说明，不必通读。按以下顺序读：

1. [根目录 README](../../README.md)：启动方法、端口、常用命令
2. [平台定位方向决策](../architecture/2026-10-17-platform-positioning-decision.md)：这个产品是做什么的
3. [docs/specs/](../specs/)：各模块现行功能设计，相当于 FS / TS
4. [文档索引](../README.md)：需要查其他文档时再看

| 文件夹                                                       | 怎么对待                       |
| ------------------------------------------------------------ | ------------------------------ |
| `docs/specs/`                                                | 现行设计，要看                 |
| `docs/guides/`                                               | 操作说明，需要时看             |
| `docs/architecture/`                                         | 架构契约与方向决策，改结构时查 |
| `docs/plans/`                                                | 实施过程记录，需要追溯时查     |
| `docs/archive/`、`docs/design-options/`、`docs/screenshots/` | 历史档案与设计参考，可以忽略   |

## 7. 在 VS Code 中隐藏无关目录

资源管理器里隐藏目录只影响显示，不删除文件，随时可以恢复。

1. 按 `Ctrl + ,` 打开设置，顶部选 **工作区** 页签（只对本项目生效）。
2. 搜索 `files.exclude`，点 **添加模式**，逐条添加：`**/node_modules`、`vendor`、`.runtime`、`docs/archive`。

也可以直接在 `.vscode/settings.json` 里加入：

```json
"files.exclude": {
  "**/node_modules": true,
  "vendor": true,
  ".runtime": true,
  "docs/archive": true
}
```

注意：`.vscode/settings.json` 和 `sap-delivery-workbench.code-workspace` 都已纳入版本库，写在这里会对所有协作者生效。只想自己隐藏时，改用设置里的 **用户** 页签（对本机所有项目生效）。被隐藏的目录默认也不会出现在全局搜索结果里；需要搜索时，在搜索面板关闭「使用排除设置」即可。
