# 智能助手前端交互优化交接文档（2026-10-16）

用于开启新会话，**专注优化设计助手与开发助手的前端交互体验**。读完本文、[AGENTS.md](../../AGENTS.md) 和[目录与依赖契约](../architecture/repository-contract.md)（现行 1.12）即可接手。

## 1. 现状一句话

设计助手（`abap-fsd-agent`）与开发助手（`abap-dev-agent`）共用一套前端工作台 `features/agent-workbench`，功能已可用：对话、提问卡片、运行步骤、文档 / 方案与代码面板、批注、版本与差异、附件、SAP 系统选择。后端与模型能力基本稳定（模型比较与 token 优化暂缓），下一步重点是**交互体验**：信息是否清楚、等待时是否有反馈、出错时是否好懂、常用操作是否顺手。

## 2. 本轮（2026-10-15～16）与前端相关的变化

完整过程见 [FSD 附录 D 测试案例计划](2026-10-15-fsd-test-cases.md)。与前端有关的：

| 提交         | 变化                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `1969dec`    | 输入框模型选择器左侧新增 **SAP 系统选择**（`SapSystemSelect.vue`，DEV / QAS）。设计阶段默认 QAS，开发阶段默认 DEV（`stage.ts` 的 `sapEnvironment`），按助手和开发项记在 `localStorage`，随每条消息以 `sapEnvironment` 发送；后端记在轮次的 `model.sap` |
| `5c2ef8f`    | 时间线显示“建单结果”（此前作为同一轮第二条用户消息被隐藏）                                                                                                                                                                                             |
| `1a7213b` 起 | `TestDataCard.vue`（建单授权卡片）、`TestSystemLogin.vue`（QAS 个人登录，含“使用本机凭据文件登录”）、`useAgentSession` 的 `testData` / `authorize`。**设计助手已不再使用**（契约 1.12），保留给将来的测试助手 `abap-test-agent`                        |
| `f70c32e`    | FSD 2.4 输出字段表新增“默认显示”列、1.2 新增“单据范围”表（文档内容变化，`DocumentView` 照常渲染 Markdown 表格）                                                                                                                                        |
| `edfbd70`    | 智能体调用模型的首包时限放宽到 5 分钟；设计助手初稿分三次写入。**界面上意味着：一步可能长达数分钟没有任何输出**                                                                                                                                        |

## 3. 前端结构

| 位置                                                                                                   | 作用                                                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `features/abap-fsd-agent/ItemWorkspaceRoute.vue`、`features/abap-dev-agent/ItemWorkspaceRoute.vue`     | 两个阶段的入口，只提供 `StageConfig`（文案、产物面板、默认 SAP 系统）             |
| `agent-workbench/ItemWorkspaceView.vue`                                                                | 开发项工作区外壳：头部、右侧面板（对话列表 / 资料 / 产物）、对话区                |
| `agent-workbench/AgentWorkbench.vue`                                                                   | 对话区：时间线、运行步骤、提问卡片、授权卡片、附件、输入框                        |
| `agent-workbench/useAgentSession.ts`                                                                   | 一个对话的状态：加载、发送、SSE 跟随（`follow` / `apply`）、停止、提问与授权      |
| `agent-workbench/session-model.mjs`（+ `.d.mts`）                                                      | 纯函数：把 API 返回的消息、轮次、工具调用拼成时间线；工具名中文标签 `TOOL_LABELS` |
| `ConversationTimeline.vue`、`RunSteps.vue`、`DecisionCard.vue`、`ChatComposer.vue`、`ChatMarkdown.vue` | 时间线、执行进度、提问卡片、输入框、Markdown 渲染                                 |
| `DocumentView.vue` + `abap-fsd-agent/DocumentPanel.vue`                                                | FSD 文档面板（版本、差异、批注、导出）                                            |
| `abap-dev-agent/DevArtifactPanel.vue`、`CodeView.vue`                                                  | 开发方案与代码面板                                                                |
| `components/ai-elements/*`                                                                             | 第三方 AI 界面组件（Plan、ModelSelector、PromptInput 等），见其 `upstream.json`   |
| `packages/contracts/agent-core`（`types`、`sse`）                                                      | 前后端共用的消息、步骤、流事件类型                                                |

SSE 事件：`step`、`delta`（text / reasoning）、`tool.start`、`tool.end`（可带 `questions`、`testDataRequest`、`testDataRun`）、`document.draft` / `document.saved`、`artifact.draft` / `version.saved`、`comment.reply`、`turn.end`。

## 4. 本轮观察到的交互问题（候选，优先级待用户确认）

1. **长时间等待没有反馈**：一次写文档可能 1～5 分钟没有任何输出，界面只显示“正在分析（第 n 步）”，用户无法判断是在生成还是卡死。用户截图里因此误以为异常。可考虑显示已等待时长、当前在做什么（如“正在写第 3 章”）、预计较长的提示。
2. **运行步骤可读性差**：每一步都叫“查询表内容或配置”，看不出查的是哪张表；展开后是原始 JSON（`{"status":"success","result":{"columns":[...]...}}`）。可考虑标题带上表名 / 对象名，结果以小表格或摘要展示。
3. **同一错误重复三次**：失败的轮次在正文（“本轮出错：…。。已保存的进度不受影响…”，还多了一个句号）、红色“本轮未完成”框、底部黄色提示条各出现一次。
4. **对话切换不直观**：对话列表藏在右侧面板的“对话”页签；新对话没有标题时列表里不好辨认；地址里不含对话编号，刷新或分享无法定位到具体对话（靠 `localStorage` 记住上次的对话）。
5. **SAP 系统选择**：标签被截断（“QAS · SAP S/4 HANA 20…”）；未显示系统代码；只能选 DEV / QAS，未配置的显示“（未配置）”。以后项目配置默认 DEV / QAS 后，这里要跟着调整。
6. **模型选择器只是展示**：组织统一用默认模型，选择器只有一个选项，容易误以为能切换。
7. **API 重启后浏览器回到登录页**：已查明（2026-10-17），不是重启丢会话。会话存库，`npm stop` / `npm start` 不清理会话；实测重启后 Vite 重载页面，`/api/session` 仍为 200，集成测试 `auth.test.mjs` 已覆盖"新 API 进程沿用旧会话"。被退回登录页有两种原因：其一，会话空闲 30 分钟即失效（只有 API 请求会续期，属设计行为），改后端期间页面闲置超过 30 分钟，重启触发的重载就是失效后的第一次请求；其二，不同会话的内置浏览器、用户自己的 Chrome 各有一套 cookie，换一个浏览器就要重新登录。登录页显示"服务暂不可用"时，是 `/api/session` 请求失败（非 401），不是登录失效。
8. 已有但未使用的组件：`TestDataCard.vue`、`TestSystemLogin.vue`。设计阶段已不显示，不要删除（留给测试助手）。

## 5. 运行、登录与观察

- 启动 / 停止：`npm start` / `npm stop`（数据库、API、前端 `http://127.0.0.1:5173`）。启动器逐项确认数据库、API、前端页面与代理都可用后才提示成功；开机后首次启动较慢（可能一分钟左右）。**API 不热更新**，改后端要重启；**重启前确认没有运行中的轮次**（查 `app.abap_fsd_agent_turn` / `app.abap_dev_agent_turn` 的 `status='running'`）。前端改动由 Vite 热更新。
- 内置浏览器预览：`.claude/launch.json` 的 `dev` 配置连接已运行的 5173（不另起进程）；`.claude` 目录不入库（契约 1.11）。
- 登录工作台：页面内 `fetch('/api/login', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({loginName, password})})`，账号取 `.env` 的 `TEST_USER_NAME` / `TEST_USER_PASS`（本地管理员），不要把密码写进聊天。
- SAP：DEV 与 QAS 目前是同一套 SELF-S4H-2020（client 100），项目参数中已保存凭据，只读访问直接可用。
- 默认模型：Gemini 3.1 Pro Preview（ofox.ai）。一轮设计对话约 1～5 分钟。
- 观察一轮运行：查库最快，脚本做法见 [开发助手测试交接文档](2026-10-15-abap-dev-agent-handover.md) 第 4 节。

## 6. 测试资产（项目“虚拟测试项目” `701457cc-8594-4c8f-9a90-befe93f0067a`）

- **00006 销售订单基本清单**：本轮测试对话较多，可放心新建对话测试。内容最完整的是 Gemini 4 Argon 写的初稿（对话 `32dfff79`），按新标准修订过的是 `a971b01c`，含“建单结果”的是 `aa12dc8d`。
- **不要往用户自己的对话发消息**：00022（用户的设计对话）、00011 的开发对话 `eb13318b`、00021 的设计对话等。测试用新建对话。

## 7. 改前端的约束

- **只改需要改的地方**（用户多次强调）。两个助手共用 `agent-workbench`，改动要同时在设计、开发两个阶段确认。
- Prettier 只格式化自己改过的文件，不要对目录运行（本轮就发生过顺带改动无关的 `DocumentPanel.vue`）。
- 前端不得导入后端源码，跨包用 `@sap-delivery-workbench/contracts` 的公开入口；`features/abap-fsd-agent` 与 `features/abap-dev-agent` 不得互相导入，共用部分放 `agent-workbench`（契约 3.1）。
- 纯逻辑放 `session-model.mjs` / `presentation.mjs` 并在 `tests/unit/web` 补测试；组件改动在内置浏览器里实际看一遍（两个阶段、窄屏、深色模式视情况）。
- 提交前：`npm run check:architecture`、`npm run check`（类型检查与构建）、`npm run test:unit`；动到接口时再跑 `npm run test:setup` 与 `npm run test:integration`。
- 只在 `main` 上开发，检查通过后自行提交并推送，提交信息末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。全程中文交流。

## 8. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md 和 docs/plans/2026-10-16-agent-frontend-handover.md。我们在 main 上优化智能助手（设计助手、开发助手）的前端交互体验。先确认服务状态，打开内置浏览器看一下两个阶段的现状，然后从交接文档第 4 节的问题清单开始，等我的具体指令。
