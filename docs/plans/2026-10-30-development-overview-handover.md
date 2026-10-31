# 开发概览交接文档

> 状态：现行，持续更新。最后更新：2026-10-30（main `992ab1e`，一至三期完成）。

## 1. 现状一句话

开发概览一至三期全部上线：六个视角（项目、开发组、我的、顾问、测试、项目组合）、趋势与预测、周报草稿；设计中的 24 个指标与第 5 节亮点都已实现。

## 2. 下一步

工作线已完成，没有计划中的下一步；新需求另行登记待办。

## 3. 已知问题

无（FEAT-009、FEAT-010、FEAT-011、TEST-002 均已完成）。

## 4. 架构速览

- 设计：[开发概览设计](../specs/development-overview.md)，口径第 3 节，指标第 4 节，接口第 7 节，已确认的决定第 11 节；一期执行记录见[一期实施计划](2026-10-30-development-overview-implementation.md)第 4 节。
- 补记数据：计划基线 `development_item_phase.baseline_end`（三期）；`app.development_phase_transition`（阶段状态流水）、`development_item_phase.actual_start`、FSD 文档与代码版本的 `finalized_at` / `finalized_by`，见设计第 10.1 节。
- 共享判定：`packages/contracts/delivery/overview.mjs`（风险、两档完成、到期、计划缺口、里程碑越线、交接、下钻筛选 `matchesFilter`），后端统计与开发清单前端共用。
- 后端：独立模块 `apps/api/src/modules/development-overview/`（`routes.mjs` 统计、接口与项目组合，`views.mjs` 二期视图，`trends.mjs` 三期趋势、预测、周报、漂移与信号；契约 3.6），只经 delivery `context.mjs` 的 `overview`、两个助手的 `public.mjs`（`finalizedItems`、`lastTurns`、`itemComments`、`itemCoverage`）、admin 的 `keyedMilestones`、`latestHealth`，access 的可见项目读取。
- 前端：`apps/web/src/features/development-overview/`（页面、里程碑时间轴，项目 / 开发组 / 我的 / 顾问 / 测试五个视角组件，`model.ts` 的类型与下钻链接）；开发清单 `DeliveryView.vue` 读取 `?from=overview` 的筛选。
- 权限点：`delivery.overview:view`（`PRJ_VIEW`，受模块范围与“仅本人负责”限制）、`delivery.overview.team:view`（`DL_TEAM`：C_PM、C_DEV_LEAD）、`delivery.portfolio:view`（`PF_VIEW`：C_DELIVERY_DIRECTOR、C_PMO，三期才有页面）。

## 5. 测试资产

- 单元：`tests/unit/contracts/delivery-overview.test.mjs`（共享判定边界）。
- 集成：`tests/integration/api/development-overview.test.mjs`（401/403/404、`own_only`、隐藏商务与他人姓名、卡片数字 = 清单按同一筛选过滤的条数；二期的状态流水、实际开始、定稿时间与各视图）。
- 端到端：`tests/e2e/development-overview-ui.test.mjs`（卡片下钻到清单，条数一致、覆盖保存的筛选、可清除）。

## 6. 本工作线注意事项

- 口径只改 `packages/contracts/delivery/overview.mjs` 一处；改了要同时跑单元与集成测试，集成测试断言概览数字与下钻条数一致。
- 新指标若加卡片，必须同时给出下钻 `filter`，并加进集成测试的一致性循环；表达不了的集合用 `ids`。
- 风险口径包含手工“已延误”，开发清单的“风险”页签与之相同。
- 不做个人排名、手工进度汇总、缺陷/传输统计、客户视图（设计第 9 节）。
- 后端改动需重启 API；重启前按[运行指南](../guides/agent-operations.md)确认没有运行中的助手轮次。

## 7. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md（3.6）、docs/specs/development-overview.md 和 docs/plans/2026-10-30-development-overview-handover.md。我们在 main 上维护开发概览。先确认服务状态，在内置浏览器里看一下 /workspace/development-overview 现状，等我的具体指令。
