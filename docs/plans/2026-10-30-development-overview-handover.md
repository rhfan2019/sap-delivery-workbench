# 开发概览交接文档

> 状态：现行，持续更新。最后更新：2026-10-30（设计已确认，尚未实施）。

## 1. 现状一句话

开发概览的指标字典与口径已经用户确认，一期实施计划已写好，代码尚未开始；菜单仍显示“规划中”。

## 2. 下一步

按[一期实施计划](2026-10-30-development-overview-implementation.md)第 2 节从第 1 步（共享判定）开始。

## 3. 已知问题

FEAT-009。

## 4. 架构速览

- 设计：[开发概览设计](../specs/development-overview.md)，口径见第 3 节，指标见第 4 节，已确认的决定见第 11 节。
- 数据来源：开发清单各表（[开发清单重构设计](../specs/development-list.md)）、`development_event`、设计/开发助手的版本与批注、项目里程碑与健康度。
- 计划中的落点：共享判定 `packages/contracts/delivery/overview.mjs`；接口 `apps/api/src/modules/delivery/overview.mjs`；页面 `apps/web/src/features/development-overview/`。

## 5. 测试资产

尚无。计划新增 `tests/integration/api/delivery-overview.test.mjs` 与共享判定的单元测试。

## 6. 本工作线注意事项

- 口径只写一份（共享判定），概览数字与开发清单下钻条数必须一致，有测试断言。
- 风险口径包含手工“已延误”，取代了开发清单规格第 8 节 Q3 的旧约定，开发清单“计划逾期”页签随一期一起改。
- 不做个人排名、手工进度汇总、缺陷/传输统计、客户视图（设计第 9 节）。
- 权限：每个接口经 `access` 按权限点校验，并写 403/404 集成测试。

## 7. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md、docs/specs/development-overview.md、docs/plans/2026-10-30-development-overview-implementation.md 和 docs/plans/2026-10-30-development-overview-handover.md。我们在 main 上实施开发概览一期。先确认服务状态，然后从实施计划第 2 节第 1 步开始。
