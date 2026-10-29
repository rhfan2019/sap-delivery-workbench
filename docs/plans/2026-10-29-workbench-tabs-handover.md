# 工作台多标签页交接文档

> 状态：现行，持续更新。最后更新：2026-10-29（main `669d469`，第一期实施中）。

用于开启新会话，继续**工作台浏览器式多标签页**。读完本文、[AGENTS.md](../../AGENTS.md)、[目录与依赖契约](../architecture/repository-contract.md)、[工作台多标签页](../specs/workbench-tabs.md)和[设计规范](../specs/DESIGN.md)第 4.1 节即可接手。运行与登录见[智能助手本机运行与观察](../guides/agent-operations.md)；未完成事项以[待办与问题清单](backlog.md)为准，本文只列编号。

## 1. 现状一句话

第一期实施中：外壳增加标签栏，工作台菜单页面在标签内打开、切换时保留；开发项记录页仍在当前标签内打开、不保留；项目仍是全局的。

## 2. 下一步

完成 FEAT-005 第一期并验收；之后按用户安排做 FEAT-006（项目跟随标签），FEAT-007（开发项多标签）已暂缓。

## 3. 已知问题

FEAT-005、FEAT-006、FEAT-007。

## 4. 架构速览

| 位置                                    | 作用                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/web/src/services/tabs.ts`         | 标签状态与本地记住；`openInNewTab`、`activateTab`、`closeTab`；页面用 `switchingTab()`、`useTabLeave()` |
| `apps/web/src/components/AppTabs.vue`   | 标签栏、标签右键菜单                                                                                    |
| `apps/web/src/components/AppLayout.vue` | `KeepAlive` 按标签保留页面（记录页除外）、按标签记住滚动、菜单与图标栏的新标签打开方式                  |
| `apps/web/src/services/shortcuts.ts`    | 后台保留的页面注销快捷键                                                                                |

规则以规格为准，本文不重复。

## 5. 测试资产

无专用数据；用 `.env` 的 TEST_USER 登录工作台即可（见运行指南）。

## 6. 本工作线注意事项

- 被保留的页面在后台仍是挂载状态：新增页面若用全局单例（`services/shell.ts` 的 `detailOpen`、`projectContext` 的 `leaveDelivery`）、`window` 监听或快捷键，必须在 `onDeactivated` / `onActivated` 里收放，或用 `useShortcut`。
- 有“未保存修改”的页面：离开守卫写成 `switchingTab() || safeLeave()`，并用 `useTabLeave(safeLeave)` 让关闭标签时询问。
- 界面只用 `theme.css` 令牌；标签栏取值见 DESIGN.md 第 4.1 节。
- 提交前：`npm run check:architecture`、`npm run check`、`npm run test:unit`，并在内置浏览器按规格第 10 节查看。

## 7. 新会话开场提示（可直接复制）

> 请先阅读 AGENTS.md、docs/architecture/repository-contract.md、docs/specs/workbench-tabs.md 和 docs/plans/2026-10-29-workbench-tabs-handover.md。我们在 main 上做工作台的浏览器式多标签页。先确认服务状态，在内置浏览器里看一下标签栏现状，然后从交接文档第 2 节开始，等我的具体指令。
