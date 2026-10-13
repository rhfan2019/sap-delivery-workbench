# abap-fsd-agent 交接文档（2026-10-12）

用于开启新会话。读完本文、[AGENTS.md](../../AGENTS.md) 和[目录与依赖契约](../architecture/repository-contract.md)即可接手。

## 1. 现状一句话

FSD 设计助手已按[方向决策](../architecture/2026-10-11-fsd-assistant-direction-decision.md)完全重构为“模型主导的智能体”（模块 `abap-fsd-agent`），旧的各代助手、表与数据已清除；2026-10-12 用当时的组织默认模型（Gemini 3.1 Pro Preview）在 DEV-0031 上完成端到端测试（T1～T11），结论“有条件通过”；用户评价“基本能满足要求”。下一阶段是**多模型批量测试 + 持续优化**。

## 2. 代码与分支

- 2026-10-12 已将分支 `abap-fsd-agent-refactor` 快进合并到 `main` 并删除其他分支，此后只在 `main` 上开发。合并前的提交顺序：
  - `a5729b2` 方向决策与重构计划
  - `33f1ff9` 阶段 A：清除所有旧 FS/FSD 助手
  - `0afcb26` 阶段 B：后端智能体
  - `e512199` 阶段 C：前端改接
  - `b7f5ecc` 审计日志页（运行复核、评论、优化建议）；去掉 `LLM_ALLOWED_HOSTS` 检查
  - `49d139f` 模型繁忙（502/503/504/529）给出明确提示，智能体自动重试 3 次（3/8/15 秒）
  - `ee07437`、`3400018` 用户提交：模型请求可走代理（`LLM_PROXY_URL`，`https-proxy-agent`）
- 未提交（2026-10-12 文档一致性整理）：新增 `docs/plans/2026-10-12-abap-fsd-agent-e2e-test.md`（测试脚本、结果、问题分析）与本文；修改契约（1.5 勘误）、方向决策（状态与第 9 节）、重构计划（状态与第 10 节）、`README.md`、`apps/api/README.md`、`docs/README.md`。
- 不要提交：其他会话的未跟踪文件（如 `docs/plans/2026-10-11-theme-switcher-design-md.md`、`docs/sap-delivery-workbench/`，若仍存在）。

## 3. 架构速览

| 部分       | 位置                                                                                                      | 要点                                                                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 智能体后端 | `apps/api/src/modules/abap-fsd-agent/`                                                                    | `loop.mjs` 每轮最多 30 步 / 60 次工具调用；`routes.mjs` 为 HTTP + SSE（`/api/projects/:projectId/development-items/:itemId/abap-fsd-agent`）；`events.mjs` 进程内事件缓冲、断线续传；`document.mjs` 章节拆分、局部替换、修改声明比对；`logs.mjs` 供审计读取 |
| 系统指令   | `abap-fsd-agent/prompts/system.md`                                                                        | 质量的主要杠杆；改后需重启 API 生效                                                                                                                                                                                                                         |
| 工具       | `abap-fsd-agent/tools/`                                                                                   | SAP 只读 13 个（`sap.mjs`，SQL 仅 SELECT，结果压缩）；工作区 `ask_user`、`read_document`、`write_document`、`edit_document`、`reply_comment`、`check_document`（`workspace.mjs`）；写入后自动校验（`check.mjs`，必需章节 + SAP 字段核对）                   |
| 模型       | `apps/api/src/modules/models/`                                                                            | `chat.mjs` 的 `resolveAgentModel` 读组织默认模型（用户会随时切换，测试前读配置，不要写死）；`transport.mjs` 含代理、错误分类                                                                                                                                |
| 前端       | `apps/web/src/features/abap-fsd-agent/`                                                                   | `useAgentSession.ts` 数据层；`DocumentPanel.vue` 版本 / 定稿 / 导出 / 划词批注                                                                                                                                                                              |
| 审计       | `apps/api/src/modules/audit/`、`apps/web/src/features/audit/`                                             | 仅企业管理员；页面 `/workspace/audit`；规格见 [docs/specs/audit.md](../specs/audit.md)                                                                                                                                                                      |
| 数据       | 迁移 `1791730000000_abap-fsd-agent.sql`（7 张 `abap_fsd_agent_*` 表）、`1791800000000_audit-analysis.sql` | 运行库账号对 `app.audit_event` 只能读 + 追加                                                                                                                                                                                                                |

环境变量：`ABAP_FSD_AGENT_THINKING=off`（关闭深度思考）、`ABAP_FSD_AGENT_MAX_OUTPUT_TOKENS`、`ABAP_FSD_AGENT_FILES_DIR`、`LLM_PROXY_URL`。

## 4. 运行与验证

- 启动 / 停止：`npm start` / `npm run stop`（数据库、API、前端 `http://127.0.0.1:5173`）。首次依赖预构建慢，可能报“前端未就绪”但随后可用。API 不热更新，改后端或提示词要重启。**重启会打断正在运行的轮次，重启前必须先征得用户同意。**
- 检查：`npm run check:architecture`、`npm run typecheck`、`npm run test:unit`、`npm run test:integration`。集成测试依赖测试库容器 `sap-fs-tests-dev-postgres-1`（端口 55439），停了就 `docker start` 它。
- 浏览器自动登录：`.env` 中 `TEST_USER_NAME` / `TEST_USER_PASS`（本地管理员）。在内置浏览器里用页面内 `fetch('/api/login', {loginName, password})` 最可靠，表单输入曾失败。不要把密码复述到聊天。
- 观察一轮运行：查 `app.abap_fsd_agent_turn` / `app.abap_fsd_agent_tool_call`（可用 Monitor 轮询），或调用 `/api/audit/runs/:turnId`（含对话、工具调用、文档比对）。
- 不能直连 ofox 等境外接口时，探测模型要走应用自己的传输层（`streamChat`），它会读取 `LLM_PROXY_URL`。

## 5. 审计与优化建议流程（用户手动触发）

1. 用户在审计日志的每轮详情页写评论。
2. 用户说“分析审计日志”时：`npm run audit:export -- --since <日期>`（输出 `.runtime/artifacts/assistant-logs/`）。
3. 结合导出材料与代码写建议方案（Markdown），`npm run audit:publish -- <文件> --title "<标题>" --since <日期> --source <导出的 JSON>` 发布到“优化建议”标签。
4. 平台不调用模型生成建议，没有定时任务。

## 6. 端到端测试结论（DEV-0031）

详见 [测试脚本与结果](2026-10-12-abap-fsd-agent-e2e-test.md)（第 8 节结论、第 9 节问题分析与修改方案）和 `.runtime/artifacts/abap-fsd-agent/e2e-2026-10-12/`（`record.md`、`fsd-v1/v2/v4.md`、`audit-export.md`）。会话 `3782fe07-3aa8-4df0-9301-6d3ed0eb813b`，每轮已写评论（前缀“【E2E”）。

- 模型 Gemini 3.1 Pro Preview：提问 79 秒、出稿 174 秒、批注修订 151 秒、小改 20～75 秒；10 轮平均 61.5 秒，共输入 1,247.7k / 输出 30.9k Token；工具失败 1 / 58。
- 好的方面：先查 SAP 再问且只问客户口径；非推荐答案准确落入文档；批注逐条处理并回复、未声明修改始终为 0；不做无谓修改；越界请求按指令拒绝；停止、续流、恢复、定稿、导出均正常。
- **有效范围**：没有国产模型限制（方向决策第 4 节，2026-10-13 勘误），本轮结论对 Gemini 3.1 Pro Preview 有效；其他模型的质量与耗时在批量测试和 DEV-0024 验收中分别评估。

## 7. 待办（按优先级）

**本轮问题**（唯一权威清单与分析见测试文档第 9 节，这里只列编号）

| 编号       | 问题                                                                             | 优先级 | 下一步                                                           |
| ---------- | -------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| E2E-01     | 系统指令承诺“封面、变更记录、SAP 核实记录由程序生成”，导出未实现                 | 高     | 用户在方案 A（导出时由程序生成，推荐）与方案 B（删除承诺）中选择 |
| E2E-02     | 没有版本差异对比视图（含“第 1 版显示全部章节为改动”）                            | 中     | 前端实现章节级逐行差异                                           |
| E2E-03     | `reply_comment` 被用于回复普通聊天                                               | 中     | 修改工具说明，可选无批注时不提供该工具                           |
| E2E-04     | 首稿偏薄、口径疑点未登记附录 A                                                   | 低     | 只记录；批量测试按模型统计后再定                                 |
| E2E-05     | 重复读表、串行查询                                                               | 低     | SAP 工具层缓存表结构；系统指令要求合并字典查询                   |
| E2E-06a～e | 界面：“（推荐）”重复、刷新后不滚动、消息不显示附件、附件不能下载、审计子页面包屑 | 低     | 见测试文档表格；06b 先复现确认                                   |

阶段 C 记录的界面待改进（执行步骤过长且失败步骤显示原始错误、较早轮次工具结果需压缩以降低输入 Token）见重构计划第 10 节。

**重构计划剩余**（[重构计划](2026-10-11-abap-fsd-agent-refactor.md) 第 6、7 节）

- 阶段 D：README、`docs/README.md` 的状态与入口、方向决策状态（“已实施”）已于 2026-10-12 同步；剩余：新增 `docs/guides/abap-fsd-agent.md`（启动、配置 SAP 与模型、代理、查日志）。
- DEV-0024 验收（样本 `docs/samples/DEV-0024 · 采购申请点检审批功能/`，对照 `02. FSD.md`）。
- 部署前确认：代理模式下模型请求跳过本地 DNS 与公网地址检查，是否符合预期。
- 待决定：阶段 A 未移入 `docs/archive/` 的旧助手计划（见重构计划第 10 节末条）是否补做移动。

**下一阶段：批量测试**

- 用户计划做大量测试，覆盖客户可能使用的多种常见模型（方向决策第 4 节），每轮记录模型名称。可以复用开发项“测试复制”接口（`POST .../development-items/:id/test-copy`）生成副本；每轮测试后在审计页写评论，定期“分析审计日志”产出优化建议。
- 测试前读取当前默认模型名并记录；测试中只观察和记录，遇到阻断先报告，不擅自改代码。

## 8. 协作约定

- 全程用中文交流。
- 目录、依赖变更先读契约；提交前跑 `npm run check:architecture`；改规则先改契约与检查器。
- `.env`、`.runtime` 中的凭据与附件、数据库卷、用户备份受保护，不做批量清理。
- 重启开发服务前先问；提交只在用户要求时做，提交信息末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不在浏览器里输入用户的真实密码（本地测试账号除外）。

## 9. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md 和 docs/plans/2026-10-12-abap-fsd-agent-handover.md。我们在 main 上继续 FSD 设计助手（abap-fsd-agent）的批量测试与优化。先确认服务状态和当前默认模型，然后等我的具体指令。
