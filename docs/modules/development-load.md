# 开发排期（开发人员周排期与负载）

状态：已实施（2026-10-31），用户 2026-10-31 确认需求。参照用户在 Excel 里维护的“开发人员负载表”。后续的甘特图与 AI 排计划见 [FEAT-013](../backlog.md)、[FEAT-014](../backlog.md)。

开发组长每周排开发计划、看每个人的负载，以及计划和实际完成差了多少。“开发管理”下单独一个菜单“开发排期”。

## 1. 谁能看

- 权限点 `delivery.load:view`（权限组“开发排期”），经单一角色 `DL_LOAD` 挂到项目经理（C_PM）、开发组长（C_DEV_LEAD）、开发顾问（C_DEV）。
- 开发顾问也看全部人员的行：负载表就是用来横向比较的，不按模块范围或“仅本人负责”过滤。
- 缺权限 403，范围外项目 404。

## 2. 表的结构

**顶部**：总个数、已开发（个数与占比）、已测试（个数与占比）。

**统计基准日期**：下拉选择，只有周一；范围为“项目开始日期 − 7 天”到“项目截止日期 + 30 天”内的周一（取项目主数据的计划开始、结束日期；项目没填日期时取今天前后半年）。默认本周一，本周不在范围内时取最近的一端。所选日期写进地址 `?week=`。

**展望周数**：下拉选择 1–12 周，默认 3 周，决定基准周之后显示几周；写进地址 `?ahead=`。

**行**：总计（第一行）→ 每位开发人员 → TBD（开发阶段还没指派人的开发项）。

- 人员：持有开发顾问、开发组长、分包开发角色的成员（没有任务也显示，看得出谁有空），加上开发阶段指派过的任何人（已离开项目的标“已离开项目”）。
- 顺序：按成员的**排序码**从小到大，没填的排最后，再按姓名。排序码在“项目 → 成员与权限”的列表里直接填（0–9999，可留空），持有“管理成员”的人可改，包括自己的。

**列**：开发人员 | 未安排计划日期 | 总计 | “MM/DD 以前” | 各周 | “YYYY-MM-DD 以后”。

- 各周：基准周的上一周、基准周、之后展望周数个周；“以前”是第一周之前的全部。
- “以后”是最后一周之后的全部，日期为最后一周的下一个周一（含当天），随基准日期和展望周数变化。
- 每个周的表头三行：周一日期、ISO 周号（如 2026W43）、日期范围（如 10/19~10/25）；真实的本周绿色高亮，所选基准周顶部描一条蓝线。
- 每组四列：预计人天、计划个数、实际个数、累计差异个数。
- 表头和前两列在表格滚动时固定。

## 3. 口径

只看开发阶段；开发阶段**已取消**的开发项不统计（四个阶段都取消即“已移出范围”，自然包括在内）。

| 数字           | 口径                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| 总个数         | 开发阶段未取消的开发项                                                                                               |
| 已开发         | 开发阶段状态为“已完成”                                                                                               |
| 已测试         | 顾问测试状态为“已完成”；IT 顾问 / 用户测试不计                                                                       |
| 未安排计划日期 | 开发阶段没有计划完成日、且未完成                                                                                     |
| 预计人天       | 开发阶段的人天预估，按计划完成日所在的周；总计列含未排日期的                                                         |
| 计划个数       | 计划完成日落在该周的个数；**总计列是该人负责的全部开发项**（含未排日期的），因此总计行的计划个数等于总个数           |
| 实际个数       | 开发阶段已完成、实际完成日落在该周的个数；总计列是全部已完成的（含没填实际完成日的），因此总计行的实际个数等于已开发 |
| 累计差异个数   | 从“以前”起往右累计的“实际 − 计划”；总计列为“已完成 − 全部”。负数红底、正数绿底、0 留空                               |

“以前 + 各周 + 以后”的计划个数之和是有计划完成日的开发项，比总计少未安排日期的；实际个数之和比总计少没填实际完成日的已完成项。所以“以后”的累计差异不一定等于总计的差异。

## 4. 下钻与后退

- 点未安排、计划、实际、预计人天的数字，在**当前标签**打开开发清单，地址 `?from=load&project=&label=&phase=development&<筛选键>`，清单显示“来自开发排期：…”的筛选条，条数与数字一致。筛选键：`assignee` / `unassigned`、`active`、`unplanned`、`status`、`planned` / `actual`（`起~止`，可空一端），判定在 `packages/contracts/delivery/overview.mjs` 的 `matchesFilter`。
- 浏览器后退回到开发排期时，页面是原来那个实例：不重新请求、不出现骨架屏，基准日期、页面与表格的横纵滚动位置都不变。实现是工作台标签在标签内跳转时保留上一页（[工作台多标签页](workbench-tabs.md)第 4 节）。
- 下钻打开的开发清单与已开着的开发清单互不影响：它只响应自己标签的地址，筛选条件不保存，也不读取、覆盖开发清单记住的筛选。
- “以后”的数字同样可点，筛选为 `planned` / `actual` = `起~`（不限止）。
- 切换基准日期或展望周数不发请求：接口返回每人每周的分组，页面在本地排出各周。

## 5. 实现

| 位置                                                             | 内容                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/contracts/delivery/load.mjs`                           | 周一、ISO 周号、基准日期选项、按人按周分组 `loadRows`、各周与“以后”排布、累计差异 `loadWindow` |
| `packages/contracts/delivery/overview.mjs`                       | 下钻筛选键 `unassigned`、`active`、`unplanned`、`planned`、`actual`                            |
| `apps/api/src/modules/development-overview/load.mjs`             | `GET /api/projects/:projectId/development-load`；人员与排序                                    |
| `apps/api/src/modules/access/members.mjs`                        | 成员带 `sortCode`；`PUT /api/projects/:projectId/members/:userId/sort-code`                    |
| `database/migrations/1792660000000_project-member-sort-code.sql` | `app.project_member.sort_code`                                                                 |
| `apps/web/src/features/development-load/`                        | 页面                                                                                           |
| `apps/web/src/services/tabs.ts`、`components/AppLayout.vue`      | 标签内的上一页保留、按页面记住滚动位置                                                         |
| `tests/unit/contracts/delivery-load.test.mjs`                    | 周与选项、分组与累计、筛选                                                                     |
| `tests/integration/api/development-load.test.mjs`                | 401 / 403 / 404、人员与顺序、口径、排序码校验与权限、每个数字等于下钻条数                      |
| `tests/e2e/development-load-ui.test.mjs`                         | 下钻条数一致；后退是同一页面实例、滚动位置不变、没有再次请求；`?week=`、`?ahead=` 切换         |

## 现状与下一步

> 最后更新：2026-10-31（main `075409b`，展望周数与“以后”一组；页面视觉待提升 UI-013）。

### 1. 现状一句话

“开发管理 → 开发排期”的开发人员周排期与负载表已上线（FEAT-012）：按人按周的预计人天、计划、实际与累计差异，基准日期与展望周数可选，之后的合计在“以后”一组，数字下钻到开发清单、后退原样恢复。

### 2. 下一步

用户确认开发排期满足基本需求，页面视觉待后续提升（UI-013）。后续按用户安排：开发人员任务甘特图（FEAT-013）、用 AI 排开发计划（FEAT-014）。开发概览页面的重新设计暂缓（UI-008）。

### 3. 已知问题

UI-013（页面视觉）。后续需求：FEAT-013、FEAT-014。

### 4. 架构速览

- 设计：[开发排期设计](development-load.md)，口径第 3 节，下钻与后退第 4 节，实现位置第 5 节。
- 口径：`packages/contracts/delivery/load.mjs`（周一、ISO 周号、基准日期选项、`loadRows` 分组、`loadWindow` 各周、“以后”与累计差异，`aheadOf` 展望周数），下钻筛选键在 `delivery/overview.mjs` 的 `matchesFilter`。
- 后端：`apps/api/src/modules/development-overview/load.mjs`（契约 3.6），人员与排序码经 access 的 `projectMembers`；排序码接口在 `access/members.mjs`。
- 前端：`apps/web/src/features/development-load/`；开发清单 `DeliveryView.vue` 读取 `?from=load`。
- 后退无感：`services/tabs.ts` 的 `Tab.back` 与 `AppLayout.vue` 按页面记住滚动位置（[工作台多标签页](workbench-tabs.md)第 4 节），对所有标签内跳转生效。
- 权限：`delivery.load:view`（`DL_LOAD`：C_PM、C_DEV_LEAD、C_DEV），不按范围过滤。

### 5. 测试资产

- 单元：`tests/unit/contracts/delivery-load.test.mjs`。
- 集成：`tests/integration/api/development-load.test.mjs`（权限、人员与顺序、口径、排序码、每个数字等于下钻条数）。
- 端到端：`tests/e2e/development-load-ui.test.mjs`（下钻条数；后退为同一页面实例、滚动不变、不再请求；`?week=`、`?ahead=`）。

### 6. 本工作线注意事项

- 口径只改 `load.mjs` 与 `overview.mjs` 的筛选键；改了跑单元、集成与端到端测试，集成测试逐格断言数字与下钻条数一致。
- 下钻打开的开发清单只响应自己标签的地址（`activeTabId` 比对），不读写记住的筛选；浏览器前进后退落到别的标签的地址时切换到那个标签（`tabs.ts` 用 `history.listen` 标记）。
- 页面内不要在激活时重新加载数据，否则破坏“后退无感”；刷新只走页头的刷新按钮。
- 用 Playwright 测滚动恢复时，点击要用 `evaluate((b) => b.click())`：它自己的 `click()` 会先把按钮滚进可视区，改变滚动位置。
- 后端改动需重启 API；重启前按[运行指南](../guides/agent-operations.md)确认没有运行中的助手轮次。

### 7. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md（3.6）、docs/modules/development-load.md。我们在 main 上维护开发排期。先确认服务状态，在内置浏览器里看一下 /workspace/development-load 现状，等我的具体指令。
