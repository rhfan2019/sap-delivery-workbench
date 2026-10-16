# abap-dev-agent 测试交接文档（2026-10-15）

用于开启新会话，**专注测试 ABAP 开发助手**（也覆盖与它共用底座的 FSD 设计助手的回归）。读完本文、[AGENTS.md](../../AGENTS.md) 和[目录与依赖契约](../architecture/repository-contract.md)即可接手。

## 1. 现状一句话

开发助手 `abap-dev-agent` 首版已按[方向决策](../architecture/2026-10-13-abap-dev-agent-direction-decision.md)与[实施计划](2026-10-14-abap-dev-agent-implementation.md)实现并上线到本地开发环境：开发项工作区“开发”阶段，输入 FSD / 资料 / 口头需求，产出**开发方案 + 一份继承 `YCL_FRH_REPORT` 的完整可执行程序**，支持批注修订、版本差异、上传或从 SAP 同步交回代码；首版只支持开发类型“报表”“功能”。2026-10-14 的端到端测试结论“有条件通过”（[测试记录](2026-10-14-abap-dev-agent-e2e-test.md)）。用户现在要**先确认功能好用**，token 优化暂缓。

## 2. 代码

全部在 `main`，已推送。按顺序：

| 提交                 | 内容                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `99efa93`            | 契约 1.7：新增 `agent-core`、`abap-dev-agent` 模块，提示词与框架副本命名规则，检查器与测试 |
| `aec89a7`            | 阶段 A：循环、事件缓冲、附件解析、SAP 只读工具从设计助手迁入 `agent-core`                  |
| `963ffa5`            | 阶段 B：开发助手后端（7 张表、框架加载、资料、工作区工具、静态校验）                       |
| `9c92173`            | 阶段 C：共用前端迁到 `features/agent-workbench`，开发阶段面板，开发清单“开发”按钮          |
| `15fc73f`            | 修复：未输出前断线自动重发；批注回复必须有实际改动                                         |
| `10735ba`            | 修复：没有 FSD 时先出方案或先提问（系统指令 + 会话事实）                                   |
| `0b5b21a`、`222e43a` | 测试记录与进度                                                                             |

工作区里未跟踪的 `docs/开发清单字段清单.xlsx` 是用户的文件，不要提交或删除。

## 3. 架构速览

| 部分         | 位置                                                                                                                                             | 要点                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公共运行层   | `apps/api/src/modules/agent-core/`                                                                                                               | `runAgentLoop`（每轮 30 步 / 60 次工具调用、繁忙与断线重试、重复调用拦截）、事件缓冲与 SSE、附件解析、SAP 只读工具（含程序内部用的 `readSource` 全量读源码）、`ask_user`                                                               |
| 开发助手后端 | `apps/api/src/modules/abap-dev-agent/`                                                                                                           | `loop.mjs` 组装上下文并保存版本；`context.mjs` 拼系统指令与会话事实；`framework.mjs` 加载框架（SAP 优先、内置副本兜底、只截取类定义）；`materials.mjs` 资料与版本依据；`artifacts.mjs` 读写、差异、批注失效；`routes.mjs` API          |
| 系统指令     | `abap-dev-agent/prompts/`                                                                                                                        | `system.md` 主指令；`report.md` 报表规范；`report-example.abap` 范例（YDEMO_FRH_0021）。**质量的主要杠杆**，改后重启 API 生效                                                                                                          |
| 框架副本     | `abap-dev-agent/frameworks/*.abap`                                                                                                               | `YCL_FRH_REPORT` 等 5 个类的完整源码；目标系统读不到时使用                                                                                                                                                                             |
| 工具         | `abap-dev-agent/tools/`                                                                                                                          | `workspace.mjs`：`list_materials`、`read_material`、`read_artifact`、`write_artifact`、`edit_artifact`、`import_code`、`sync_from_sap`、`check_code`、`reply_comment`、`ask_user`；`check.mjs`：只报确定问题的静态校验                 |
| 前端         | `apps/web/src/features/agent-workbench/`（共用）、`features/abap-dev-agent/`（`DevArtifactPanel.vue`、`CodeView.vue`、`ItemWorkspaceRoute.vue`） | 外壳按阶段配置（`agent-workbench/stage.ts`）；路由 `/projects/:projectId/development-items/:itemId/development`                                                                                                                        |
| 数据         | 迁移 `1792000000000_abap-dev-agent.sql`                                                                                                          | `app.abap_dev_agent_` 前缀：`session`、`turn`、`message`、`tool_call`、`attachment`、`version`（方案、代码、来源、依据 `basis`、修改声明 `changes`、比对 `comparison`、标签）、`comment`（`target` 为 plan/code，`status` 含 `stale`） |

环境变量：`ABAP_DEV_AGENT_THINKING=off`、`ABAP_DEV_AGENT_MAX_OUTPUT_TOKENS`、`ABAP_DEV_AGENT_FILES_DIR`，含义同设计助手。

## 4. 运行与观察

- 启动 / 停止：`npm start` / `npm stop`（数据库、API、前端 `http://127.0.0.1:5173`）。API 不热更新，改后端或提示词要重启。**重启会打断正在运行的轮次，重启前确认用户没有运行中的对话。**
- 检查：`npm run check:architecture`、`npm run check`（含类型检查与构建）、`npm run test:unit`、`npm run test:integration`（先 `npm run test:setup`，依赖测试库容器 `sap-fs-tests-dev-postgres-1`）。
- 浏览器登录：`.env` 的 `TEST_USER_NAME` / `TEST_USER_PASS`（本地管理员）。在内置浏览器页面里用 `fetch('/api/login', {method:'POST', …, body: JSON.stringify({loginName, password})})` 最可靠。不要把密码复述到聊天。会话会过期，401 时重新登录。
- 发消息与读结果：页面内 `fetch` 调用 `/api/projects/:projectId/development-items/:itemId/abap-dev-agent/sessions/...`。发消息后页面可能因服务重启或 Vite 刷新而中断脚本，发之前先确认页面稳定。
- 观察一轮运行：**开发助手尚未接入审计日志页**（实施计划第 9 节，首版只导出 `recentTurns`）。直接查库最快：在 scratchpad 写一个 Node 脚本，用 `createRequire('file:///D:/Workspace/sap-delivery-workbench/apps/api/package.json')('pg')` 和 `apps/api/src/platform/database.mjs` 的 `databaseConfig({ runtime: true })` 连库，以 `node --env-file=.env` 运行，查：
  - `app.abap_dev_agent_turn`（`status`、`stop_reason`、`usage`、`error`）
  - `app.abap_dev_agent_tool_call`（`name`、`status`、`result_summary`、`arguments->>'target'`）
  - `app.abap_dev_agent_message`（`payload ? 'questions'` 取出题；`role='assistant'` 取回复）
  - `app.abap_dev_agent_version`（`source`、`length(plan)`、`length(code)`、`comparison`）

  一轮 1～6 分钟，用 Monitor 的 until 循环等待 `status` 不再是 `running`。

- 目标 SAP：项目“虚拟测试项目”配置 SELF-S4H-2020（S4CORE 105 · SAP_BASIS 755，client 100）。框架类 `YCL_FRH_REPORT` 等在该系统中存在；范例程序 `YDEMO_FRH_0021` 也在。

## 5. 测试资产（项目“虚拟测试项目”，`701457cc-8594-4c8f-9a90-befe93f0067a`）

| 开发项                       | 类型 | 现状                                                                                                                                                                       |
| ---------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00021 采购订单执行清单（V1） | 报表 | 设计对话有 FSD 第 2 版（定稿，用户自己的会话，不要往里发消息）；开发对话 `d7b99ab1-…` 有 3 个版本（初稿、批注修订、真正改代码），程序名 ZMM_PO_EXEC_LIST，未在开发清单登记 |
| 00016 总账科目余额表         | 报表 | 无 FSD。开发对话 `cb106714-…`（修复前，直接写了代码）；`6e10b4c9-…`（修复后，停在 5 个业务问题，可继续回答测试后续流程）                                                   |
| 00011 未完成生产订单清单     | 报表 | 用户 2026-10-15 刚在设计助手完成 FSD 第 1 版（未定稿），还没有开发对话——**适合作为下一个有 FSD 场景的测试对象**                                                            |
| 00006 销售订单基本清单       | 报表 | 设计助手回归用的对话（有 FSD 第 2 版）                                                                                                                                     |

开发类型为“功能”的项（00002、00005、00009 等）还没有用开发助手测过。

## 6. 测试重点（建议顺序）

以“开发顾问是否好用”为标准，每个场景记下：模型名、耗时、工具调用、是否提问、代码行数、静态校验结果、人工核对的问题。

1. **有 FSD 的完整流程（00011）**：发“请根据设计助手的 FSD 写开发方案和代码”。看：是否读取 FSD、是否查 SAP 核实、方案与代码是否同轮写出、代码是否符合 `report.md` 与范例（SRI、CTE 计算下推、逐列字段目录、事件块）。
2. **无 FSD 的后续流程（00016 `6e10b4c9`）**：回答 5 个问题（可选推荐），看是否先出方案再写代码、口径是否按答复落实。
3. **批注修订**：对代码行和开发方案各加批注，让助手处理；看是否只改该改之处、是否回复批注、修改声明比对是否有“未声明修改”。程序会拒绝“没改却说改了”的回复。
4. **交回代码**：
   - 上传文件：把改过的代码存成 `.abap` 或 `.txt` 作为对话附件上传，说明“这是我改过的代码”，看是否先确认再 `import_code`，是否给出差异、之后的修改是否保留手工改动。
   - SAP 同步：需先在开发清单为该开发项登记程序对象（`R3TR PROG <名称>`），且 SAP 中有该程序（可用 `YDEMO_FRH_0021` 做实验）。读取的是 ADT 默认返回的版本，无法指定激活或未激活。
5. **资料变化**：在设计助手里改 FSD 出新版本后，回到开发对话，看是否标出“新增”资料、是否列出影响、与先前明确决定冲突时是否提问。
6. **功能类开发项**（可编辑 ALV、BAPI 写回）：首版规范对写回只有原则性描述、没有范例，预期质量弱于报表，重点看锁、提交回滚、逐行结果。
7. **不支持的情况**：接口 / 增强类开发项（开发清单里“开发”按钮仍提示即将开放；直接访问 URL 时助手应告知不支持）；变更类型“优化”时应告知只开发新对象。
8. **界面**：版本切换、差异（对比任意早期版本）、依据、导出代码与开发方案、复制代码、定稿标签、批注“原文已变”状态、只读用户（非开发阶段负责人）不能修改。
9. **设计助手回归**：前端共用组件迁移过，确认设计阶段的出题、写稿、批注、版本、导出仍正常。

生成的代码最终要粘贴到 SAP 做语法检查和运行，这一步需要用户操作；记录用户反馈的语法错误类型，作为系统指令与静态校验的改进输入。

## 7. 已知问题（详见测试记录第 3 节）

| 编号       | 状态     | 摘要                                                                                           |
| ---------- | -------- | ---------------------------------------------------------------------------------------------- |
| DEV-E2E-01 | 已修复   | 未输出前断线自动重发                                                                           |
| DEV-E2E-02 | 已修复   | 批注回复须有实际改动                                                                           |
| DEV-E2E-03 | 记录     | 模型自述不可信（编造“网络中断”），以版本差异为准                                               |
| DEV-E2E-04 | **暂缓** | 单轮 token 偏高（有 FSD 一轮约 19 万，无 FSD 一轮 50～105 万）；用户决定先测功能，后续集中优化 |
| DEV-E2E-05 | 记录     | SAP 同步无法指定激活版或未激活版                                                               |
| DEV-E2E-06 | 已处理   | 无 FSD 时先出方案或先提问（加强系统指令后验证通过）                                            |

另有一个已提出、用户尚未答复的界面改进：开发阶段空白页看不出助手已找到 FSD，建议显示“已找到设计助手的 FSD 第 N 版”并把建议按钮改为“根据 FSD 写开发方案和代码”。用户确认前不要改。

## 8. 记录方式

- 新发现的问题**追加到[测试记录](2026-10-14-abap-dev-agent-e2e-test.md)第 3 节**，编号从 DEV-E2E-07 开始；场景结果写进第 2 节新的小节；它是本轮问题的唯一权威清单。
- 测试中只观察和记录；遇到阻断先报告。用户明确要求修复时再改代码，修复后补单元或集成测试、跑全量检查。

## 9. 协作约定

- 全程用中文交流。
- 只在 `main` 上开发，不建分支。检查通过后自行提交并推送，提交信息末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 目录、依赖变更先读契约；提交前跑 `npm run check:architecture`；改规则先改契约与检查器。
- 用 Prettier 只格式化自己改过的文件，不要对整个目录运行，以免改到无关文件（曾发生过）。
- `.env`、`.runtime` 中的凭据与附件、数据库卷、用户备份受保护，不做批量清理；不在浏览器里输入用户的真实密码（本地测试账号除外）。
- 不往用户自己的对话里发测试消息，测试用新建对话。

## 10. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md 和 docs/plans/2026-10-15-abap-dev-agent-handover.md。我们在 main 上测试 ABAP 开发助手（abap-dev-agent）是否好用。先确认服务状态和当前默认模型，然后从交接文档第 6 节的测试重点开始，等我的具体指令。
