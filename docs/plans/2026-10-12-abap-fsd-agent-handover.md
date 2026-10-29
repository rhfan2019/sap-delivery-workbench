# 设计助手（abap-fsd-agent）交接文档

> 状态：现行，持续更新。最后更新：2026-10-28（main `7f4f9c2`）。

用于开启新会话。读完本文、[AGENTS.md](../../AGENTS.md) 和[目录与依赖契约](../architecture/repository-contract.md)即可接手。运行、登录与观察方法见[智能助手本机运行与观察](../guides/agent-operations.md)；未完成事项以[待办与问题清单](backlog.md)为准，本文只列编号。

## 1. 现状一句话

FSD 设计助手已按[方向决策](../architecture/2026-10-11-fsd-assistant-direction-decision.md)完全重构为“模型主导的智能体”，旧的各代助手、表与数据已清除。2026-10-12 在 DEV-0031 上端到端测试“有条件通过”，用户评价“基本能满足要求”。2026-10-14 起与开发助手共用后端 `agent-core` 和前端 `agent-workbench`；2026-10-15 起默认连接 QAS，不再建测试单据（契约 1.12，见 [FSD 附录 D 测试案例计划](2026-10-15-fsd-test-cases.md)）。下一阶段是**多模型批量测试与持续优化**。

## 2. 下一步

- **待用户决定**：E2E-01（导出承诺：方案 A 程序生成 / 方案 B 删除承诺）、TECH-001（代理模式跳过地址检查）。
- **待处理**：E2E-03、E2E-05、E2E-02（界面）、TEST-001（DEV-0024 验收）、DOC-001。
- **批量测试**：用户计划覆盖客户可能使用的多种常见模型（方向决策第 4 节）。可用开发项“测试复制”接口（`POST .../development-items/:id/test-copy`）生成副本；测试前读取并记录当前模型名；每轮测试后在审计页写评论，定期“分析审计日志”产出优化建议（流程见运行指南第 6 节）。

## 3. 已知问题

待办清单中属于本工作线的：E2E-01～05、E2E-06a/b/d、TEST-001、DOC-001、TECH-001。与开发助手共用的界面问题：FEAT-002、FEAT-003、UI-002、UI-003。

## 4. 架构速览

| 部分       | 位置                                                                                                             | 要点                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公共运行层 | `apps/api/src/modules/agent-core/`                                                                               | 循环（每轮最多 30 步 / 60 次工具调用）、事件缓冲与续传、附件解析、SAP 只读工具、`ask_user`；较早轮次的工具结果截断（`history.mjs`）                                                                            |
| 智能体后端 | `apps/api/src/modules/abap-fsd-agent/`                                                                           | `loop.mjs` 组装上下文并调用公共循环；`routes.mjs` 为 HTTP + SSE（`/api/projects/:projectId/development-items/:itemId/abap-fsd-agent`）；`document.mjs` 章节拆分、局部替换、修改声明比对；`logs.mjs` 供审计读取 |
| 系统指令   | `abap-fsd-agent/prompts/system.md`                                                                               | 质量的主要杠杆；改后需重启 API 生效                                                                                                                                                                            |
| 工具       | `abap-fsd-agent/tools/`                                                                                          | 工作区 `ask_user`、`read_document`、`write_document`、`edit_document`、`reply_comment`、`check_document`（`workspace.mjs`）；写入后自动校验（`check.mjs`，必需章节 + SAP 字段核对）                            |
| 模型       | `apps/api/src/modules/models/`                                                                                   | 按消息选择组织内的模型；`transport.mjs` 含代理、错误分类；繁忙（502/503/504/529）自动重试                                                                                                                      |
| 前端       | `apps/web/src/features/abap-fsd-agent/`（入口与 `DocumentPanel.vue`）、`features/agent-workbench/`（共用工作台） | `DocumentPanel.vue` 版本 / 定稿 / 导出 / 划词批注；共用部分见[前端交互交接文档](2026-10-16-agent-frontend-handover.md)                                                                                         |
| 权限       | `packages/contracts/access/catalog.mjs`                                                                          | `agent.fsd:run` 才能进入助手对话；只读用户在开发项抽屉里查看成果                                                                                                                                               |
| 审计       | `apps/api/src/modules/audit/`、`apps/web/src/features/audit/`                                                    | 页面 `/settings/audit`；规格见 [docs/specs/audit.md](../specs/audit.md)                                                                                                                                        |
| 数据       | 迁移 `1791730000000_abap-fsd-agent.sql`（`app.abap_fsd_agent_*` 表）、`1791800000000_audit-analysis.sql`         | 运行库账号对 `app.audit_event` 只能读 + 追加                                                                                                                                                                   |

## 5. 测试资产与结论

- **DEV-0031 端到端测试**：[测试脚本与结果](2026-10-12-abap-fsd-agent-e2e-test.md)（第 8 节结论、第 9 节问题分析），材料在 `.runtime/artifacts/abap-fsd-agent/e2e-2026-10-12/`；会话 `3782fe07-3aa8-4df0-9301-6d3ed0eb813b`，每轮评论前缀“【E2E”。当时模型 Gemini 3.1 Pro Preview：10 轮平均 61.5 秒，工具失败 1 / 58；批注逐条处理、未声明修改始终为 0。结论只对该模型有效，其他模型在批量测试中评估。
- **回归用**：虚拟测试项目 00006 销售订单基本清单的设计对话（有 FSD 第 2 版），可放心新建对话测试。
- **不要动**：用户自己的设计对话（00022、00021 等）。

## 6. 本工作线的注意事项

- 测试中只观察和记录；遇到阻断先报告，用户明确要求时再改代码。
- 改系统指令或工具说明后，用同一开发项的新对话回归，比对改动前后的审计记录。

## 7. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md 和 docs/plans/2026-10-12-abap-fsd-agent-handover.md。我们在 main 上继续 FSD 设计助手（abap-fsd-agent）的批量测试与优化。先确认服务状态和当前模型，然后等我的具体指令。
