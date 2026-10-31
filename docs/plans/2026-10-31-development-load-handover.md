# 开发排期交接文档

> 状态：现行，持续更新。最后更新：2026-10-31（main `待填`，负载表上线）。

## 1. 现状一句话

“开发管理 → 开发排期”的开发人员周排期与负载表已上线（FEAT-012）：按人按周的预计人天、计划、实际与累计差异，基准日期可选，数字下钻到开发清单、后退原样恢复。

## 2. 下一步

用户确认这一版只做负载表。后续按用户安排：开发人员任务甘特图（FEAT-013）、用 AI 排开发计划（FEAT-014）。开发概览页面的重新设计暂缓（UI-008）。

## 3. 已知问题

无。后续需求：FEAT-013、FEAT-014。

## 4. 架构速览

- 设计：[开发排期设计](../specs/development-load.md)，口径第 3 节，下钻与后退第 4 节，实现位置第 5 节。
- 口径：`packages/contracts/delivery/load.mjs`（周一、ISO 周号、基准日期选项、`loadRows` 分组、`loadWindow` 九周与累计差异），下钻筛选键在 `delivery/overview.mjs` 的 `matchesFilter`。
- 后端：`apps/api/src/modules/development-overview/load.mjs`（契约 3.6），人员与排序码经 access 的 `projectMembers`；排序码接口在 `access/members.mjs`。
- 前端：`apps/web/src/features/development-load/`；开发清单 `DeliveryView.vue` 读取 `?from=load`。
- 后退无感：`services/tabs.ts` 的 `Tab.back` 与 `AppLayout.vue` 按页面记住滚动位置（[工作台多标签页](../specs/workbench-tabs.md)第 4 节），对所有标签内跳转生效。
- 权限：`delivery.load:view`（`DL_LOAD`：C_PM、C_DEV_LEAD、C_DEV），不按范围过滤。

## 5. 测试资产

- 单元：`tests/unit/contracts/delivery-load.test.mjs`。
- 集成：`tests/integration/api/development-load.test.mjs`（权限、人员与顺序、口径、排序码、每个数字等于下钻条数）。
- 端到端：`tests/e2e/development-load-ui.test.mjs`（下钻条数；后退为同一页面实例、滚动不变、不再请求；`?week=`）。

## 6. 本工作线注意事项

- 口径只改 `load.mjs` 与 `overview.mjs` 的筛选键；改了跑单元、集成与端到端测试，集成测试逐格断言数字与下钻条数一致。
- 页面内不要在激活时重新加载数据，否则破坏“后退无感”；刷新只走页头的刷新按钮。
- 用 Playwright 测滚动恢复时，点击要用 `evaluate((b) => b.click())`：它自己的 `click()` 会先把按钮滚进可视区，改变滚动位置。
- 后端改动需重启 API；重启前按[运行指南](../guides/agent-operations.md)确认没有运行中的助手轮次。

## 7. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md（3.6）、docs/specs/development-load.md 和 docs/plans/2026-10-31-development-load-handover.md。我们在 main 上维护开发排期。先确认服务状态，在内置浏览器里看一下 /workspace/development-load 现状，等我的具体指令。
