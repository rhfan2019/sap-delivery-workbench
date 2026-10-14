# abap-dev-agent 实施计划

> 2026-10-14。状态：已确认（第 9 节三项按建议执行）。阶段 0 已完成（契约 1.7、依赖清单、检查器及其测试）；下一步阶段 A。依据：[ABAP 开发助手方向决策](../architecture/2026-10-13-abap-dev-agent-direction-decision.md)（已确认，下称“决策”）、[目录与依赖契约](../architecture/repository-contract.md)、系统指令草稿 [`docs/specs/abap-dev-agent/`](../specs/abap-dev-agent/)。计划确认前不改代码。

## 1. 目标与完成标准

在现有项目中新建开发助手 `abap-dev-agent`，并把两个助手共用的智能体循环抽为 `agent-core`。首版只做开发清单中开发类型为“报表”“功能”的可执行程序（决策第 1、3 节）。

完成标准：

1. 契约与检查规则先于代码修订（阶段 0），之后每次提交 `npm run check` 通过。
2. `agent-core` 抽取后设计助手行为不变：其单元、集成测试全部通过，DEV-0031 回归一轮对话（阶段 A）。
3. 开发助手后端、前端按阶段 B、C 实现；`npm run test:unit`、`npm run test:integration` 通过；`start.cmd` 启动后可从开发清单进入“开发”阶段。
4. 决策第 10 节的验证场景跑通（阶段 D），记录模型名称、耗时、静态校验误报数。

## 2. 约定

- 直接在 `main` 上开发，不建分支；每个阶段可拆成多次提交，每次提交都通过 `npm run check` 并推送。
- 阶段顺序固定：0 → A → B → C → D。A 必须单独提交并回归通过后才开始 B（决策风险表最后一项）。
- 不建空目录；新目录在第一次放入真实文件的提交中出现。
- 草稿 `docs/specs/abap-dev-agent/` 在阶段 B 迁入模块后删除，同设计助手的做法。

## 3. 阶段 0：契约与检查规则

修订[目录与依赖契约](../architecture/repository-contract.md)，新增 1.7 变更：

| 项           | 内容                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新模块       | `agent-core`：智能体公共运行层（循环、限额、繁忙重试、取消、事件缓冲、附件解析、SAP 只读工具封装）。不含任何智能体的提示词、产物或表，不注册路由。`abap-dev-agent`：开发助手，职责与数据见决策第 6、8、9 节                                                |
| 智能助手边界 | 3.1 节扩展为三个名称：`abap-fsd-agent`、`abap-dev-agent` 实现，`abap-test-agent` 预留（不建目录）。单一版本、表前缀、API 路径规则同样适用于开发助手                                                                                                        |
| 提示词规则   | 决策 9 节三条：提示词放本模块 `prompts/`、不跨模块共享；主指令 `system.md`，按开发类型加载的部分以类型命名（`report.md`、`report-example.abap`）；参考源码等运行资源不放 `prompts/`，框架副本放 `abap-dev-agent/frameworks/`                               |
| 共享契约     | 两个助手相同的流事件协议移到 `packages/contracts/agent-core/`；`packages/contracts/abap-dev-agent/` 只放开发助手特有的类型（版本、来源、依据、批注锚定）                                                                                                   |
| 模块依赖     | 新增：`abap-fsd-agent->agent-core`、`abap-dev-agent->agent-core`、`abap-dev-agent->item-workspace`、`abap-dev-agent->models`、`abap-dev-agent->abap-fsd-agent`、`agent-core->sap`、`agent-core->models`。`abap-fsd-agent->sap` 在阶段 A 后若不再使用则删除 |
| 公开入口     | `agent-core/public.mjs`；`abap-dev-agent/public.mjs`；`abap-fsd-agent/public.mjs` 增加读取 FSD 版本的函数供开发助手使用                                                                                                                                    |

同一提交修改：

- `docs/architecture/module-dependencies.json` 登记上述依赖边。
- `scripts/checks/architecture.mjs`：`agentRoots` 增加 `abap-dev-agent` 与 `agent-core` 的后端、前端、契约路径（禁止版本目录）；“必须经公开入口”的规则从只针对 `abap-fsd-agent` 推广到三个模块；`browserContracts` 登记新的浏览器可用契约。
- 检查规则自身的单元测试（`tests/unit/tooling`）增加对应用例。

## 4. 阶段 A：抽取 agent-core

### 4.1 迁移内容

| 能力                     | 现位置                                                      | 去向                                  |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------- |
| 智能体循环               | `abap-fsd-agent/loop.mjs` 的 `runTurn` 主体                 | `agent-core/loop.mjs`                 |
| 限额、繁忙重试、重复检测 | 同上（`LIMITS`、`withBusyRetry`、`seen`）                   | 同上，限额可由调用方覆盖              |
| 进程内事件缓冲与续传     | `abap-fsd-agent/events.mjs`                                 | `agent-core/events.mjs`               |
| 附件解析                 | `abap-fsd-agent/attachments/`                               | `agent-core/attachments/`             |
| SAP 只读工具             | `abap-fsd-agent/tools/sap.mjs`（白名单、SELECT 限制、截断） | `agent-core/sap-tools.mjs`            |
| 历史消息投影             | `abap-fsd-agent/context.mjs` 的 `historyMessages`           | `agent-core/history.mjs`              |
| 流事件协议               | `packages/contracts/abap-fsd-agent/sse.*`                   | `packages/contracts/agent-core/sse.*` |

留在 `abap-fsd-agent`：系统指令与会话事实、文档工具与校验、文档版本与批注、仓储与表、路由、审计查询（`logs.mjs`）。

### 4.2 接口

`agent-core` 的 `runTurn` 不认识任何产物，通过参数接收：

- `messages`（系统指令、会话事实、历史）、`tools` 与 `handlers`（工作区工具由智能体提供）；
- `persist`：`appendMessage`、`recordToolCall`、`finishTurn` 三个回调（表归各智能体）；
- `onFinally`：本轮结束时由智能体保存产物（设计助手保存文档版本，开发助手保存方案与代码版本）；
- `shouldStop`：工具执行后是否结束本轮（如 `ask_user` 已出题）；
- `emit`、`signal`、`model`、`limits`、`deps`（测试注入）。

工具参数日志脱敏（如不记录整份文档或代码正文）由智能体通过回调决定。

### 4.3 验证

1. `tests/unit/api/abap-fsd-agent/` 全部通过；循环相关用例迁到 `tests/unit/api/agent-core/`。
2. `tests/integration/api/abap-fsd-agent.test.mjs` 通过。
3. 浏览器用 DEV-0031 回归一轮对话：提问、写稿、批注修订各一次，审计日志页可见运行记录。
4. 单独提交并推送，再开始阶段 B。

## 5. 阶段 B：abap-dev-agent 后端

### 5.1 目录

```text
apps/api/src/modules/abap-dev-agent/
  routes.mjs          HTTP 与 SSE；挂在 /api/projects/:projectId/development-items/:itemId/abap-dev-agent
  repository.mjs      会话、轮次、消息、工具调用、附件、版本、版本依据、批注
  context.mjs         拼装系统指令（system.md + report.md + report-example.abap）、框架接口、会话事实
  framework.mjs       加载框架源码（SAP 优先，内置副本兜底）并截取类定义
  artifacts.mjs       方案分章、代码按行读取、唯一原文替换、版本差异、修改声明比对、批注重新锚定
  materials.mjs       资料清单：开发清单信息、FSD 版本、开发项文件、对话附件；相对当前版本依据的变化
  tools/workspace.mjs 工作区工具（决策第 6 节）
  tools/check.mjs     静态校验（决策第 7 节）
  public.mjs          供 audit 等读取运行记录（首版只导出会话与轮次查询）
  prompts/            system.md、report.md、report-example.abap（由草稿迁入）
  frameworks/         ycl_frh_report.abap 等五个类的内置副本（由草稿迁入）
```

### 5.2 数据（新增迁移，表前缀 `abap_dev_agent_`）

| 表           | 内容                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session`    | 会话（开发项、标题、创建人）                                                                                                                      |
| `turn`       | 轮次（状态、停止原因、模型、用量、错误）                                                                                                          |
| `message`    | 消息（含工具调用与结果）                                                                                                                          |
| `tool_call`  | 工具调用记录（名称、参数摘要、状态、耗时）                                                                                                        |
| `attachment` | 对话附件（文件、解析文本）                                                                                                                        |
| `version`    | 版本：序号、开发方案、代码、来源（助手生成 / 开发顾问上传 / SAP 同步）、来源对象名或附件、SAP 版本状态（激活 / 未激活）、标签、修改声明与比对结果 |
| `basis`      | 版本依据：资料类型（FSD 版本 / 开发项文件 / 对话附件 / 框架类）、资料标识、版本或内容摘要                                                         |
| `comment`    | 批注：所属产物（方案 / 代码）、锚定原文、锚定版本、辅助行号、状态（未解决 / 已解决 / 原文已变）、回复                                             |

前五张表与设计助手同构但各自独立（表归各智能体，决策第 6 节）。启动时由本模块的仓储把遗留的 `running` 轮次标为中断，与设计助手相同。

### 5.3 跨模块读取

| 需要                                             | 途径                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 访问控制、开发项、负责人                         | `item-workspace/public.mjs` 的 `createWorkContext(..., 'development')`（已支持开发阶段）        |
| 开发类型、变更类型、开发对象、事务码、开发项文件 | 扩展 `item-workspace` 的工作上下文，经其既有的 `delivery` 依赖读取，开发助手不直接依赖 delivery |
| 设计助手的 FSD 版本                              | `abap-fsd-agent/public.mjs` 新增“按开发项列出 FSD 版本”“读取某版 FSD”                           |
| 模型配置与调用                                   | `models/public.mjs`                                                                             |
| SAP 只读工具、源码读取                           | `agent-core`                                                                                    |

### 5.4 框架加载（决策第 4 节）

1. 每个会话首次运行时，对五个框架类逐个用 `getObjectSource` 读取；读不到（没有目标系统、对象不存在）的用内置副本。
2. 截取类定义：`YCL_FRH_REPORT` 保留 PUBLIC 与 PROTECTED 部分，其余类保留 PUBLIC 部分；去掉实现与签名注释框。截取规则写成纯函数并用五个副本做单元测试。
3. 截取结果与来源（SAP / 内置副本、内容摘要）缓存在会话上，作为“框架接口”一节放在系统指令之后；来源写入每个版本的依据。
4. 有目标系统但缺少框架对象时，在会话事实中告诉模型，由模型在开发方案手工步骤中写明部署框架。

### 5.5 工作区工具（决策第 6 节）

| 工具                                      | 要点                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `list_materials` / `read_material`        | 资料按类型列出，标出相对当前版本依据的新增与变化；FSD 按章节读                                                    |
| `read_artifact`                           | `target: plan` 按章节、`target: code` 按行范围（单次上限 400 行）                                                 |
| `write_artifact` / `edit_artifact`        | 整体写入与续写；唯一原文替换，必须附理由，可关联批注；写入后自动运行静态校验并把结果附在工具结果中                |
| `import_code`                             | 只接受对话附件，保存为“开发顾问上传”版本，返回与上一版本的差异                                                    |
| `sync_from_sap`                           | 取开发清单中的程序对象（多个时由参数指定）；先读未激活版，读不到再读激活版；含 `INCLUDE` 时不展开并提示；返回差异 |
| `check_code`、`reply_comment`、`ask_user` | 同设计助手                                                                                                        |

`import_code`、`sync_from_sap` 产生的版本在调用时立即保存，不等本轮结束，避免本轮后续失败时丢失开发顾问的代码。

### 5.6 静态校验（决策第 7 节，只报确定的问题）

- 表与字段：`FROM` / `JOIN` 后的表名、源码中明确的 `表-字段`；复用设计助手的 DDIC 核对与缓存；没有目标系统时跳过。
- 文本：代码中的 `TEXT-xxx` 与 `'…'(xxx)` 与开发方案 3.2 节一致；同一编号对应不同文字。
- 完整性：`CLASS`/`METHOD`/`FORM`/`IF`/`LOOP`/`TRY`/`CASE` 等块配对；省略号占位；代码写入时开发方案为空。
- 编码规范：`FOR ALL ENTRIES`、`SELECT *`、`AT NEW`、ABAP Doc、`INTO` 前置的旧式 SQL、`INITIALIZATION` 中多余语句、`TYPES` 带作用域前缀、`SELECT-OPTIONS` 缺影子范围表、`check_authority` 的 `iv_auth_field` 为 `ACTVT`。
- 校验器只做文本层面的识别（去掉注释与字符串字面量后匹配），不尝试解析 ABAP 语法。每条规则配正例与反例单元测试，以 `report-example.abap` 必须零告警为基准。

### 5.7 SAP 行为验证（编码前用真实连接确认）

1. `getObjectSource` 能否读取未激活版，参数与返回如何区分激活状态。
2. 读取 PROG 完整源码的长度上限与分页方式。
3. 目标系统中是否有 `CL_AUTH_OBJECTS_TO_SQL`（框架权限检查依赖）。
4. 范例的 SQL 细节：`CASE ... THEN 0` 的类型兼容性、没有计划行时的空值（决策 12 节第 2 项）。结果回写范例与决策。

### 5.8 测试

- 单元：框架截取、方案分章与代码按行读取、唯一原文替换、版本差异、批注重新锚定、静态校验规则、资料变化判断、工具参数校验。
- 集成：会话创建、发送消息（模拟模型）、写入方案与代码并生成版本、上传附件并 `import_code`、批注与回复、标签、导出、权限（只有开发阶段负责人或项目管理员可写）。
- 单元与集成测试不调用真实付费模型（沿用现有约定）。

## 6. 阶段 C：前端

| 项           | 内容                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路由         | `:stage(design)` 扩展为 `:stage(design\|development)`                                                                                                                                                                 |
| 工作台外壳   | `ItemWorkspaceView` 按阶段取配置（API 前缀、标题、空状态文字、产物面板）；对话时间线、输入框、附件、提问卡片、运行步骤共用。共用组件从 `features/abap-fsd-agent/` 移出的方式在阶段 0 的契约中确定（见第 9 节第 1 项） |
| 产物面板     | 开发阶段为两个页签：开发方案（复用 Markdown 文档面板）、代码（shiki 高亮 abap、行号、选中行加批注、复制整份、导出 `.abap`）                                                                                           |
| 版本         | 版本列表显示来源（助手生成 / 开发顾问上传 / SAP 同步）、激活状态、标签；任意两版差异；版本依据清单                                                                                                                    |
| 批注         | 未解决 / 已解决 / 原文已变三种状态；“原文已变”的批注可由开发顾问关闭或重新指定位置                                                                                                                                    |
| 开发清单入口 | “开发”按钮对开发类型为报表、功能的开发项开放；接口、增强仍提示即将开放                                                                                                                                                |

验证：`npm run check`（含类型检查与生产构建）；浏览器走一遍新建会话、发送消息、查看方案与代码、加批注、切换版本、复制与导出。

## 7. 阶段 D：端到端验证

按决策第 10 节执行，使用组织默认模型，记录模型名称：

1. **功能（主场景）**：DEV-0024 的 `02. FSD.md` 作为上传资料，跑完“澄清 → 方案 → 代码 → 批注修订 → 重新上传修改过的 FSD → 冲突提问 → 修改”；再在 SAP 中手工改一处，分别用上传文件和 SAP 同步交回，确认手工修改不被冲掉、未解决批注正确迁移。
2. **只读报表**：选一个开发类型为“报表”的开发项（可用 YDEMO_FRH_0021 的需求描述），检查方案与代码同一轮写出的路径，以及生成代码与范例风格的一致性。
3. **无 FSD**：只给一段口头需求，检查是否先问业务问题、先出方案停下。
4. **无目标系统**：断开 SAP，检查框架改用内置副本、依据记录正确、DDIC 核对跳过。
5. 生成的代码由开发顾问粘贴到 SAP 做语法检查与运行，记录错误类型，作为系统指令与静态校验的改进输入。

结论写入新的测试记录 `docs/plans/` 下，问题按编号登记，同设计助手的端到端测试文档。

## 8. 文档同步

- 每阶段完成后更新本计划状态。
- 阶段 B 完成：删除 `docs/specs/abap-dev-agent/` 草稿，决策 5.1 节的路径改为模块路径。
- 阶段 C 完成：更新根目录 README“功能边界”和“工程地图”、`docs/README.md` 索引。
- 阶段 D 完成：编写交接文档，同设计助手的交接文档。

## 9. 已确认事项

用户于 2026-10-14 确认按建议执行，已写入契约 1.7：

1. **共用前端组件**移到 `features/agent-workbench/`（在阶段 C 迁移）；`features/abap-fsd-agent` 与 `features/abap-dev-agent` 不得互相导入。
2. **审计日志接入开发助手**：首版只导出会话与轮次查询，审计页面接入放在阶段 D 之后。
3. **SAP 只读工具**在阶段 A 一并迁入 `agent-core`。

## 10. 进度

| 阶段 | 状态   | 说明                                                                                                                                                                                           |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 已完成 | 契约 1.7；`module-dependencies.json` 新增 7 条依赖边；检查器：公开入口规则推广到三个智能体模块、版本目录禁令扩展、提示词与框架副本命名规则、两个助手前端 feature 互不导入；新增 3 组检查器测试 |
| A    | 未开始 |                                                                                                                                                                                                |
| B    | 未开始 |                                                                                                                                                                                                |
| C    | 未开始 |                                                                                                                                                                                                |
| D    | 未开始 |                                                                                                                                                                                                |
