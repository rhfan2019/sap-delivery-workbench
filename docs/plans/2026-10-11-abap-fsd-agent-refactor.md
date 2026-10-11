# abap-fsd-agent 重构实施计划

> 2026-10-11。状态：已确认（第 9 节五项均按建议执行）。准备阶段、阶段 A 已完成；下一步阶段 B。依据：[方向决策](../architecture/2026-10-11-fsd-assistant-direction-decision.md)、[目录与依赖契约 1.3](../architecture/repository-contract.md) 第 3.1 节、[系统指令草稿](../specs/fsd-assistant-system-prompt.md)。计划确认前不改代码。

## 1. 目标与完成标准

在现有项目中清除历史各代 FS/FSD 助手，新建模型主导的 `abap-fsd-agent`，保留并改接现行设计助手前端。

完成标准：

1. 第 3 节清单中的代码、契约、表与数据、测试、工具、脚本、部署配置全部删除，没有 410、转发或兼容壳。
2. 新模块按第 4 节实现，前端按第 5 节改接。
3. `npm run check`（含架构检查与 1.3 新增规则）、`npm run test:unit`、`npm run test:integration` 通过；`start.cmd` 启动后 `/home` 与 `/api/health` 可访问。
4. 用组织默认模型跑通 DEV-0024 一次完整流程（第 7 节）。

## 2. 准备

1. 放弃另一会话未提交的日志分析改动：`insights-*` 五个文件、`apps/web/src/features/assistant-insights/`、迁移 `1791676800000_fsd-v1-insights-indexes.sql`、`docs/specs/assistant-insights.md`、三个 insights 测试，以及它对 `app.mjs`、`policy.mjs`、`navigation.ts`、`router/index.ts` 的修改。执行前确认该会话已停止。
2. 在当前分支提交本轮文档（方向决策、契约 1.3、AGENTS.md、系统指令草稿、本计划）。
3. 从该提交新建分支 `abap-fsd-agent-refactor`。阶段 A～D 都在此分支完成，验收通过后再合并；中间状态允许界面不可用，但每次提交必须通过 `npm run check` 与单元测试。

## 3. 阶段 A：清除（一次变更，同时启用 1.3 新增检查规则）

### 3.1 后端

| 删除                                      | 说明                                                                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/design-assistant/`  | 整个模块（LangGraph 链路、worker、检查点、遥测、探针、模拟、`unavailable.mjs`、`prompts/v1/`）。系统指令改用草稿，在阶段 B 放入新模块                                                                                             |
| `apps/api/src/modules/agent-runtime/`     | 整个模块（旧 abap-fsd-agent 引擎、开发助手挂载、`/api/admin/abap-fsd-agent`）。仍有价值的两项先迁出，见下表                                                                                                                       |
| `apps/api/src/modules/fs-workspace/`      | 整个模块                                                                                                                                                                                                                          |
| item-workspace 中的开发助手与旧工作稿后端 | `agent.mjs`、`conversations.mjs`、`development-context.mjs`、`development-prompts.mjs`、`clear-sandbox.mjs`、`prompts/system.md` 及工作稿版本、采用、会话、legacy 路由；保留开发项工作区访问上下文（`createWorkContext`），见 9.1 |
| `apps/api/src/app.mjs`、`worker.mjs`      | 移除上述模块的注册、`/fsd/v1` 与 `/fs-workspace` 特殊处理、fs-worker 与 design worker；worker 入口在阶段 B 改为新模块的运行入口或删除                                                                                             |

迁出后再删除的两项：

| 能力             | 原位置                                | 去向                                                     |
| ---------------- | ------------------------------------- | -------------------------------------------------------- |
| 附件解析         | `agent-runtime/attachment-parser.mjs` | `abap-fsd-agent/attachments/`（唯一消费者）              |
| 模型文本流式传输 | `agent-runtime/model-stream.mjs`      | 合并进 models 模块，与工具调用一起作为公开接口（阶段 B） |

### 3.2 前端

| 处理 | 对象                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迁移 | `features/item-workspace/` 的 `ItemWorkspaceRoute.vue`、`ItemWorkspaceView.vue`、`workspace.css`，以及 `features/fs-assistant-test/` 中被它们引用的组件 → `features/abap-fsd-agent/`；`features/assistant-ui/` 若只被这些组件使用，一并迁入 |
| 删除 | `FsAssistantTestView.vue`、`RunDiagnosticsView.vue`、`RunTargetPanel.vue`（旧运行目标面板）、`FsdWorkbench.vue`（未被引用）、`StructuredEditor.vue` 与 `editor-schema.*`（绑定旧 FSD Schema，阶段 C 由 Markdown 文档区替代）                |
| 删除 | `features/fs-workspace/` 整个目录；路由 `workspace/fs-assistant-test`、`workspace/assistant-runs/:runId`、`.../fs/:page?`；菜单“FS助手测试”                                                                                                 |
| 修改 | `features/delivery/FsEntry.vue` 中指向 FS 工作区的链接改指设计助手页面；路由暂时只开放 `design` 阶段，`development` 阶段入口隐藏                                                                                                            |

`WorkflowPanel.vue`（阶段、方案确认、正式版）与新形态冲突，阶段 C 中删除或改为版本面板；`SpecificationPanel.vue`、`DecisionCard.vue`、`RunSteps.vue`、`ConversationTimeline.vue`、`ChatComposer.vue`、附件组件保留并改接。

### 3.3 共享契约

删除 `packages/contracts/` 下的 `design-assistant/`、`agent-runtime/`、`fs-workspace/`、`item-workspace/`（随旧工作稿删除）和空的 `abap-fsd-agent/`，同步 `package.json` exports 与检查器的前端可用契约清单。保留组件仍需要的纯函数（如 SSE 解析）迁入新的 `packages/contracts/abap-fsd-agent/`。

### 3.4 数据库

新增迁移 `<时间戳>_abap-fsd-agent.sql`：

- 删除表：`fsd_v1_*`（10 张）、`gem_fsd_v2_run`、`fsd_agent_session`、`fsd_agent_run`、`fsd_agent_revision`、`fsd_agent_attachment`、`fsd_agent_workflow_event`、fs-workspace 的 25 张 `fs_*` 表（`fs_template_version`～`fs_publication`、`fs_project_command_receipt`）、`item_work_version`；删除模式 `fsd_checkpoint`。
- 保留：delivery 的 `fs_draft`、`fs_version`、`development_*` 及其他非助手表。
- 创建新表（第 4.4 节）。
- 删除前核对外键与其他模块的引用；已执行的迁移文件不动。

### 3.5 测试、工具、脚本、部署、文档

| 类别     | 删除                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 测试     | `tests/{unit,integration,e2e}` 下 design-assistant、fs-workspace、fsd-batch 相关目录与文件；`design-assistant-cleanup.test.mjs`、`fsd-workflow-controls.test.mjs`；`tests/fixtures/design-assistant/`（ISC001 样例另行保留为验收参考，见 9.4）、`tests/fixtures/fs-workspace/`                                                 |
| 工具     | `tools/fsd-batch/`、`tools/contract-audit/`                                                                                                                                                                                                                                                                                    |
| 脚本     | `scripts/contracts/generate-fs.mjs`、`scripts/maintenance/import-legacy-fs.mjs`、`scripts/testing/evaluate-fsd.mjs`；`run-tests.mjs`、`delivery-ui-sandbox.mjs` 中的相关引用                                                                                                                                                   |
| npm 命令 | `check:fs-contracts`、`test:elements:integration`、`fsd:*`、`test:fsd:*`、`eval:fsd`；`check` 去掉 `check:fs-contracts`                                                                                                                                                                                                        |
| 依赖     | `@langchain/langgraph`、`@langchain/langgraph-checkpoint-postgres`；OpenTelemetry 依赖在确认无其他使用者后删除                                                                                                                                                                                                                 |
| 部署     | `infra/fsd-observability.compose.yaml`、`fsd-collector.yaml`、`fsd-probe.example.json`、`fsd-target.example.json`；核对 `infra/production` 无相关引用                                                                                                                                                                          |
| 文档     | 现行文档中描述旧助手的 guides/specs/plans（`guides/abap-fsd-backend.md`、`specs/abap-fsd-implementation.md`、`specs/2026-10-03-fs-intelligent-workspace/`、`plans/2026-10-08-abap-fsd-backend.md`、`plans/2026-10-09-langgraph-chat-adapter.md` 等）移入 `docs/archive/` 并在入口标注历史状态；更新 README 与 `docs/README.md` |

### 3.6 检查器

在 `scripts/checks/architecture.mjs` 中实现契约第 9 节 1.3 新增规则（版本目录段、已清除模块目录、历史助手标识），并在 `tests/unit/tooling` 中补违规反例测试；更新 `module-dependencies.json`（删除 agent-runtime、fs-workspace、design-assistant 相关边，新增 `abap-fsd-agent->item-workspace|models|sap`）。

阶段 A 验收：`npm run check`、`npm run test:unit`、`npm run test:integration` 通过；全仓搜索历史标识只剩已执行迁移文件与 `docs/archive`。

## 4. 阶段 B：后端 `abap-fsd-agent`

### 4.1 模块结构

```text
apps/api/src/modules/abap-fsd-agent/
  routes.mjs          # HTTP 与 SSE 入口
  service.mjs         # 会话、轮次、取消
  loop.mjs            # 智能体循环：调用模型 → 执行工具 → 回填结果 → 直到停止
  tools/
    sap.mjs           # MCP 只读工具白名单与调用
    document.mjs      # read/write/edit_document、reply_comment
    ask-user.mjs      # 出题与收题
    check.mjs         # check_document：章节、表格、引用、SAP 对象名核对
  document.mjs        # 文档版本、差异计算、修改声明比对
  repository.mjs      # 表访问
  attachments/        # 附件解析（自 agent-runtime 迁入）
  prompts/system.md   # 系统指令（草稿定稿后迁入，删除 docs/specs 草稿）
```

### 4.2 智能体循环

- 每轮：拼装上下文（系统指令 + 目标系统信息 + 对话历史 + 当前文档摘要或全文 + 未解决批注）→ 流式调用模型（带工具定义）→ 执行工具调用 → 结果回填 → 模型不再调用工具时本轮结束。
- 写入文档后自动运行 `check_document`，结果作为下一步的工具结果交给模型。
- 停止条件：模型结束；用户取消；每轮工具调用上限（初值 40）；连续无新 token 的空闲超时（初值 120 秒）；每轮 token 上限。达到上限时结束本轮并告诉用户，不报错中断。
- 重复调用检测：同一工具同一参数连续出现时，回填提示而不再执行。
- 单进程内执行，同一会话同一时刻只允许一个轮次（数据库行锁）；不做租约、检查点重放、提交台账、操作预留。服务重启时未完成的轮次标记为中断，用户重发即可。

### 4.3 工具

| 工具                                                 | 实现要点                                                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| SAP 原生工具（约 13 个，见契约与系统指令第四部分）   | 通过 `sap/public.mjs` 的 `connectMcp` 连接；白名单外的工具不进入工具列表，服务端再按名称拒绝；`runQuery` 只允许 SELECT 并限制行数；结果截断到固定长度 |
| `read_document` / `write_document` / `edit_document` | `edit_document` 为原文→新文替换，原文必须唯一匹配；每次调用必须带理由，批注相关时带批注编号；每轮结束生成一个版本                                     |
| `check_document`                                     | 确定性检查：章节齐全、表头、章节引用存在、附录齐全；提取表名、字段名，按需调用 `ddicElement` 核实存在性                                               |
| `ask_user`                                           | 校验每批 ≤5 题、每题字段齐全；写入题目后结束本轮，用户答复作为下一条消息                                                                              |
| `reply_comment`                                      | 写入批注回复                                                                                                                                          |

修改声明比对：每轮结束时计算版本差异，与本轮 `edit_document`/`write_document` 的声明对照，生成“未声明修改”“声明未落实”列表，随轮次结果返回前端。

### 4.4 数据表（前缀 `abap_fsd_agent_`）

| 表           | 内容                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `session`    | 开发项下的会话：项目、开发项、目标 SAP 系统、模型、创建人                 |
| `message`    | 对话消息：用户消息、助手回复、题目与答复，按顺序                          |
| `turn`       | 轮次：状态（运行中、完成、中断、取消）、起止时间、token 用量              |
| `tool_call`  | 每次工具调用：名称、参数、结果摘要、耗时、错误                            |
| `document`   | 文档版本：版本号、Markdown 全文、修改声明、差异比对结果、标签（如“定稿”） |
| `comment`    | 批注：锚定的原文与位置、内容、状态（未解决/已解决）、回复                 |
| `attachment` | 附件元数据与解析文本（文件仍存 `.runtime` 附件目录）                      |

### 4.5 模型接口（models 模块）

在 models 模块新增公开的流式工具调用接口（OpenAI 兼容 chat completions + tools），供 abap-fsd-agent 使用；合并原 agent-runtime 的文本流式传输；支持按调用关闭深度思考。不改变模型配置管理的现有接口。

### 4.6 API（`/api/projects/:projectId/development-items/:itemId/abap-fsd-agent`）

| 方法与路径                                    | 用途                                 |
| --------------------------------------------- | ------------------------------------ |
| `GET /sessions`、`POST /sessions`             | 会话列表与新建                       |
| `GET /sessions/:id`                           | 会话详情：消息、当前文档、未解决批注 |
| `POST /sessions/:id/messages`                 | 发送消息或答复题目，启动一轮         |
| `GET /sessions/:id/events`                    | SSE：模型输出、工具步骤、文档更新    |
| `POST /sessions/:id/cancel`                   | 取消当前轮次                         |
| `GET/POST /sessions/:id/comments`             | 批注列表、新建、标记解决             |
| `GET /sessions/:id/documents`                 | 版本列表；`/:version` 取全文与差异   |
| `POST /sessions/:id/documents/:version/label` | 打标签（如定稿）                     |
| `POST /sessions/:id/attachments`              | 上传附件                             |
| `GET /sessions/:id/export`                    | 导出 Markdown（Word 导出见 9.3）     |

阶段 B 验收：单元测试覆盖循环停止条件、工具白名单、`edit_document` 匹配规则、修改声明比对、`check_document`；集成测试用模拟模型跑通“提问 → 答复 → 出稿 → 批注修订”。

## 5. 阶段 C：前端改接

1. 数据层：`useAssistantRun.ts`、`chatStream.mjs` 改接第 4.6 节 API 与 SSE 事件。
2. 对话区：`ConversationTimeline`、`ChatComposer`、附件组件保留；`RunSteps` 显示 SAP 查询等工具步骤；`DecisionCard` 显示 `ask_user` 题目并提交答复。
3. 文档区：以 Markdown 渲染替换结构化编辑器；支持选中原文添加批注、批注列表与回复、标记解决；版本列表、版本差异与“未声明修改”提示；打“定稿”标签；导出 Markdown。
4. 删除或改造 `WorkflowPanel`（阶段与确认门不再存在）。
5. 开发项工作区页面保留现有布局与交互；`development` 阶段入口隐藏。

阶段 C 验收：类型检查与构建通过；前端单元测试覆盖批注锚定、SSE 事件处理；浏览器中完成一次对话、提问、出稿、批注修订。

## 6. 阶段 D：收尾

- 系统指令定稿迁入 `abap-fsd-agent/prompts/system.md`，删除 `docs/specs/fsd-assistant-system-prompt.md`。
- 更新 README（运行入口、命令）、`docs/README.md`、新增 `docs/guides/abap-fsd-agent.md`（启动、配置 SAP 与模型、查日志）。
- 方向决策与契约中的状态更新为“已实施”。

## 7. 验收：DEV-0024

- 输入：`docs/samples/DEV-0024 · 采购申请点检审批功能/01. 需求.md`；目标系统 `bestsap-s4h-100`；组织默认模型。
- 用户扮演客户回答问题；出稿后提 3 条修改意见（以批注方式）。
- 对照 `02. FSD.md` 记录：端到端是否完成、出稿耗时（对标 GEM 5～10 分钟）、提问数量与必要性、章节与业务逻辑完整性（审批代码判定、数量改 0 标记删除、部分失败处理、刷新等）、修订是否只改该改之处、未声明修改数量。表名、字段错误只记录不计分。
- 结果写入 `.runtime/artifacts/abap-fsd-agent/acceptance/` 与一份验收记录文档。

## 8. 风险

| 风险                                       | 应对                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| 清除范围大，误删仍在使用的能力             | 阶段 A 逐项做引用检查（import、动态加载、路由、命令、Docker、文档）   |
| 保留的前端组件与旧数据结构耦合深           | 阶段 C 先改数据层，再逐个组件改接；耦合过深的组件按新数据结构重写内部 |
| 默认模型的工具调用在深度思考下不稳定或很慢 | 模型接口支持关闭思考；验收时记录两种设置的表现                        |
| MCP 工具名称或参数与系统指令描述不符       | 阶段 B 用真实连接逐个验证白名单工具，修正系统指令                     |

## 9. 已确认事项

用户于 2026-10-11 确认以下五项均按建议执行。

1. **文档与版本归属**：建议 FSD 文档、版本、批注全部由 abap-fsd-agent 自有表管理；item-workspace 只保留开发项工作区访问上下文，旧工作稿表 `item_work_version` 与 item-workspace 契约删除。另一种做法是继续用 item-workspace 工作稿存放文档，但它的结构是为旧助手设计的。
2. **开发阶段入口**：abap-dev-agent 实现前隐藏开发阶段入口。
3. **Word 导出**：第一版只导出 Markdown，Word 导出在验收后单独实现。
4. **ISC001 与 DEV-0024 样例**：`tests/fixtures/design-assistant/fsd-report/isc001.*` 随旧测试删除；`docs/samples/` 下的 DEV-0024 保留作为验收题与参考答案。
5. **delivery 的 FS 台账**（`fs_draft`、`fs_version`、`FsEditor`）不属于助手，保留不动。

## 10. 执行记录

### 阶段 A（2026-10-11）

- 按第 3 节完成清除；检查器启用契约 1.3 规则并补反例测试。`npm run check`、单元测试 55 项、隔离集成测试 33 项通过；新迁移已在隔离测试库执行，主库未迁移。
- 与计划的偏差：
  - 新表不在阶段 A 的迁移中创建，改由阶段 B 单独新增迁移；阶段 A 迁移 `1791720000000_remove-legacy-assistants.sql` 只做删除。
  - `apps/api/src/worker.mjs` 已无任务，直接删除；契约第 3、6 节同步修改。
  - item-workspace 只保留 `context.mjs`（`createWorkContext`，阶段由调用方显式传入），其路由与工作稿接口全部删除。
  - 模型流式传输迁入 `models/stream.mjs` 并由 `models/public.mjs` 导出；附件解析迁入 `abap-fsd-agent/attachments/`。前端仍需的 SSE 解析与类型迁入 `packages/contracts/abap-fsd-agent/`。
  - 原先由已删除依赖间接提供的 `@types/node` 显式加入 web 的 devDependencies；`docx`、`@playwright/test`、LangGraph、OpenTelemetry、`json-schema-to-typescript` 删除。
  - 通用测试夹具从 `tests/fixtures/fs-workspace/` 重建为 `tests/fixtures/api.mjs`、`database.mjs`（去掉 FS 工作区初始化）。
- 事故与修复：准备阶段删除的未提交迁移 `1791676800000_fsd-v1-insights-indexes.sql` 实际已在主库与测试库执行，导致迁移顺序校验失败。已按两个库中的索引定义重建该文件（7 个索引），未修改任何库的迁移记录。
- 待办：主库尚未执行 `npm run db:migrate`，执行后旧助手数据将被删除，由用户决定执行时机。界面在阶段 C 改接前不可用。
