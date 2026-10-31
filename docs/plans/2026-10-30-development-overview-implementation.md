# 开发概览一期实施计划

> 状态：待实施。依据[开发概览设计](../specs/development-overview.md)（2026-10-30 用户确认）第 10 节“一期”。只用现有数据，不做数据库迁移。交接见[开发概览交接文档](2026-10-30-development-overview-handover.md)。

## 1. 范围

- 交付：项目视角（项目经理）与开发组视角（开发组长）首屏；其余视角在页头可见但显示“二期开放”，不做空壳数据。
- 指标：M01–M08、M10、M11、M13、M15、M17、M20（M10 的等待天数暂用定稿版本的创建时间，标“估算”）。
- 不含：D1–D5 补记数据、M12/M22 等依赖流水或快照的指标、组合视图（权限点一期先登记，页面在三期）。

## 2. 步骤

每步完成后运行相关测试与 `npm run check:architecture`，单独提交。

| 步  | 内容                                                                                                                                                                                                                                                                            | 涉及位置                                                                                                                    | 验证                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | **共享判定**：风险（两个子来源）、开发完成、交付完成、计划缺口、开发完成待测、冻结越线等纯函数，输入一项开发项（含 4 个阶段）与里程碑，输出布尔或原因码；同时给出等价的 SQL 片段说明。开发清单 `model.ts` 的 `overdue()` 改为调用共享判定，“计划逾期”页签改名“风险”并含“已延误” | `packages/contracts/delivery/overview.mjs`（+ `.d.mts`、`package.json` exports）、`apps/web/src/features/delivery/model.ts` | 单元测试覆盖每个判定的边界（今天到期、已取消、全部取消、无计划日期） |
| 2   | **权限点**：登记 `delivery.overview:view`（加入 `PRJ_VIEW` 与 `SCOPED_PERMISSIONS`）、`delivery.overview.team:view`（新单一角色挂到 C_PM、C_DEV_LEAD）、`delivery.portfolio:view`（挂 C_DELIVERY_DIRECTOR、C_PMO）；启动同步预置角色                                            | `packages/contracts/access/catalog.mjs`                                                                                     | 现有权限测试通过；权限报表能看到新点                                 |
| 3   | **统计接口**：`summary`、`risks`、`load`。SQL 聚合，按 `deleted_at IS NULL`、模块范围、`own_only` 过滤；商务字段按 `project.commercial:view` 决定是否返回；无 `delivery.overview.team:view` 时他人合并为“其他成员”；ETag                                                        | `apps/api/src/modules/delivery/overview.mjs`，在 `routes.mjs` 注册                                                          | 集成测试：403、404、`own_only`、模块范围、商务字段隐藏、ETag 304     |
| 4   | **口径一致性测试**：用固定数据集断言接口各数字 = 共享判定在同一数据集上过滤出的条数                                                                                                                                                                                             | `tests/integration/api/delivery-overview.test.mjs`                                                                          | 测试通过                                                             |
| 5   | **开发清单 URL 下钻**：读 `risk`、`phase`、`status`、`module`、`assignee`、`ids` 等参数，URL 优先于 sessionStorage；顶部显示“来自开发概览：<条件> · 清除”                                                                                                                       | `apps/web/src/features/delivery/DeliveryView.vue`                                                                           | e2e：带参数打开清单，条数与概览一致；清除后恢复原筛选                |
| 6   | **页面骨架**：菜单项去掉 `planned`，挂 `delivery.overview:view`；新路由 `workspace/development-overview`；页头视角切换（默认值按第 11 节），里程碑时间轴                                                                                                                        | `apps/web/src/features/navigation.ts`、`router/index.ts`、新目录 `apps/web/src/features/development-overview/`              | 无权限时菜单隐藏、直接访问显示无权限                                 |
| 7   | **项目视角**：四张风险卡、阶段 × 状态矩阵（可按模块切换）、本周关注清单（风险 + 静止项 + 计划漂移）、负载热力（仅 team 权限）、预算双进度条（仅商务权限）                                                                                                                       | 同上                                                                                                                        | 内置浏览器截图，明暗两种主题                                         |
| 8   | **开发组视角**：冻结风险条、交接就绪队列、反向交接、对象冲突、开发完成待测、FSD 定稿率                                                                                                                                                                                          | 同上                                                                                                                        | 截图；每个数字点开后清单条数一致                                     |
| 9   | **收尾**：DESIGN 令牌检查、空状态文案、规格与交接文档、待办 FEAT-009 状态                                                                                                                                                                                                       | 文档                                                                                                                        | `npm run check:architecture`、相关单元/集成/e2e 测试全部通过         |

## 3. 约束

- 图表只用 `theme.css` 令牌，色阶最多三档；不用饼图、仪表盘、漏斗。若需要图表库，先按契约评估依赖，优先用现有组件与 SVG。
- 估算值一律标“估算”；无数据显示原因，不补 0。
- 不在前端二次实现口径：概览页只展示接口结果，清单页的判定来自共享模块。
- 新增的接口、权限点、路由同步更新契约第 3 节相关模块说明与 `docs/README.md` 导航。
