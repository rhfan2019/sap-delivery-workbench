# 智能助手前端交互交接文档

> 状态：现行，持续更新。最后更新：2026-10-28（main `7f4f9c2`）。

用于开启新会话，**专注优化设计助手与开发助手的前端交互体验**。读完本文、[AGENTS.md](../../AGENTS.md)、[目录与依赖契约](../architecture/repository-contract.md)和[设计规范](../specs/DESIGN.md)即可接手。运行、登录与观察方法见[智能助手本机运行与观察](../guides/agent-operations.md)；未完成事项以[待办与问题清单](backlog.md)为准，本文只列编号。

## 1. 现状一句话

两个助手共用一套前端工作台 `features/agent-workbench`：对话、提问卡片、运行步骤、文档 / 方案与代码面板、批注、版本与差异、附件。2026-10-16～18 全站按 Plain 重写（[DESIGN.md](../specs/DESIGN.md) 2.0）；助手页按[起始页、输入框与成果访问设计](../specs/agent-workspace-start-and-composer.md)改版：起始页说明产出、输入框按消息选择 SAP 系统与模型、用 + / @ 引用开发项资料、只读用户在开发项抽屉里看成果。2026-10-16 登记的交互问题中，长等待反馈、步骤可读性、SAP 系统与模型选择已解决（核对记录见[已完成清单](../archive/backlog-done.md)）。

## 2. 下一步

按待办清单优先级：FEAT-002（对话流显示附件）、FEAT-003（提问卡片一次一题，含 E2E-06a）、E2E-02（FSD 逐行差异）、UI-002、UI-003、E2E-06d；E2E-06b 先复现。

## 3. 已知问题

待办清单中领域为“助手界面”的条目：FEAT-002、FEAT-003、E2E-02、E2E-06a、E2E-06b、E2E-06d、UI-002、UI-003、UI-005、UI-006。

## 4. 前端结构

| 位置                                                                                                   | 作用                                                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `features/abap-fsd-agent/ItemWorkspaceRoute.vue`、`features/abap-dev-agent/ItemWorkspaceRoute.vue`     | 两个阶段的入口，只提供 `StageConfig`（文案、产物面板、默认 SAP 系统）        |
| `agent-workbench/ItemWorkspaceView.vue`                                                                | 开发项工作区外壳：顶栏（含对话切换，地址带 `?session=`）、成果面板、对话区   |
| `agent-workbench/AgentWorkbench.vue`                                                                   | 对话区：起始页、时间线、运行步骤、提问卡片、附件、输入框                     |
| `agent-workbench/useAgentSession.ts`                                                                   | 一个对话的状态：加载、发送、SSE 跟随（`follow` / `apply`）、停止、提问       |
| `agent-workbench/session-model.mjs`、`presentation.mjs`（各附 `.d.mts`）                               | 纯函数：消息、轮次、工具调用拼成时间线；工具中文标签 `TOOL_LABELS`；等待提示 |
| `ConversationTimeline.vue`、`RunSteps.vue`、`DecisionCard.vue`、`ChatComposer.vue`、`ChatMarkdown.vue` | 时间线、执行进度、提问卡片、输入框、Markdown 渲染                            |
| `ContextPicker.vue`、`SapSystemSelect.vue`、`ModelPicker.vue`                                          | 下一条消息使用的 SAP 系统与模型                                              |
| `ReferencePicker.vue`、`AttachmentTray.vue`、`AttachmentPreview.vue`                                   | + / @ 引用开发项资料、上传附件与预览                                         |
| `DocumentView.vue`、`SelectionComment.vue` + `abap-fsd-agent/DocumentPanel.vue`                        | FSD 文档面板（版本、差异、划词批注、导出）                                   |
| `abap-dev-agent/DevArtifactPanel.vue`、`CodeView.vue`                                                  | 开发方案与代码面板                                                           |
| `ItemOutputs.vue`                                                                                      | 开发项抽屉里的成果（最新版本与定稿），只读用户可见                           |
| `components/ai-elements/*`                                                                             | 第三方 AI 界面组件，见其 `upstream.json`                                     |
| `packages/contracts/agent-core`（`types`、`sse`）                                                      | 前后端共用的消息、步骤、流事件类型                                           |

SSE 事件：`step`、`delta`（text / reasoning）、`tool.start`、`tool.end`（可带 `questions`；`testDataRequest` 留给测试助手）、`document.draft` / `document.saved`、`artifact.draft` / `version.saved`、`comment.reply`、`turn.end`。

`TestDataCard.vue`、`TestSystemLogin.vue` 目前不显示（设计助手不再建单），**不要删除**，留给将来的测试助手 `abap-test-agent`。

## 5. 测试资产（虚拟测试项目）

- **00006 销售订单基本清单**：测试对话较多，可放心新建对话测试。内容最完整的是对话 `32dfff79`，按新标准修订过的是 `a971b01c`。
- **不要往用户自己的对话发消息**：00022（用户的设计对话）、00011 的开发对话 `eb13318b`、00021 的设计对话等。

## 6. 本工作线的注意事项

- **只改需要改的地方**（用户多次强调）。两个助手共用 `agent-workbench`，改动要在设计、开发两个阶段都确认。
- 界面只用 `theme.css` 令牌，不新增颜色值（契约 1.13、1.16）。
- `features/abap-fsd-agent` 与 `features/abap-dev-agent` 不得互相导入，共用部分放 `agent-workbench`（契约 3.1）；前端不得导入后端源码。
- 纯逻辑放 `session-model.mjs` / `presentation.mjs` 并在 `tests/unit/web` 补测试；组件改动在内置浏览器里实际看一遍（两个阶段、窄屏、深色模式视情况）。
- 提交前：`npm run check:architecture`、`npm run check`、`npm run test:unit`；动到接口时再跑 `npm run test:setup` 与 `npm run test:integration`。

## 7. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md 和 docs/plans/2026-10-16-agent-frontend-handover.md。我们在 main 上优化智能助手（设计助手、开发助手）的前端交互体验。先确认服务状态，打开内置浏览器看一下两个阶段的现状，然后从交接文档第 2 节开始，等我的具体指令。
