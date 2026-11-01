# 开发清单：实施记录

> 归档，不代表现状。从[模块文档](../../modules/development-list.md)移出的实施过程、待确认答复与执行记录，章节号保持原样。

## 6. 数据清除与迁移

一个前向迁移完成，运行前先备份数据库（`pg_dump`）。当前开发库有 4 个项目、32 个开发项，按用户决定全部清除：

1. 删除所有设计助手数据：`abap_fsd_agent_*` 七张表（先子表后会话）。
2. 删除 `development_event`、`development_file` 中的行。`.runtime/delivery-files/` 下的附件文件属于受保护的本机数据，迁移不删除，需要时由用户手动清理。
3. 删除 `fs_draft`、`fs_version` 两张表。
4. 删除并重建 `development_item`，然后新建第 3 节的 5 张表，恢复 `development_event`、`development_file`、`abap_fsd_agent_session` 指向它的外键。
5. 授权：运行账号对新表授予 `SELECT, INSERT, UPDATE, DELETE`。

审计页的运行评论（`audit_comment`）只记录轮次 id、没有外键，清除后这些评论仍保留，但对应的运行详情不再可读。`audit_event` 只追加，不动。

## 7. 受影响的代码

| 位置                                                        | 变更                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/delivery/`                            | `items.mjs`、`validation.mjs` 按新表重写；`clone-*.mjs` 适配新字段；删除 `fs.mjs`；新增标签、开发对象、自定义列、批量修改、Excel 导入导出接口 |
| `apps/api/src/modules/item-workspace/context.mjs`           | 设计阶段负责人改取 `fsd` 阶段的 `assignee_id`，开发阶段改取 `development` 阶段的                                                              |
| `apps/api/src/modules/abap-fsd-agent/routes.mjs` 及系统指令 | 开发项上下文改用 `business_function`（转为纯文本）；去掉 `acceptance`                                                                         |
| `apps/web/src/features/delivery/`                           | 列表、抽屉、批量修改、导入导出重写；删除 `FsEditor.vue`、`FsEntry.vue`                                                                        |
| `scripts/maintenance/import-report-cases.mjs`               | 按新字段改写，或由 Excel 导入替代后删除                                                                                                       |
| `scripts/testing/delivery-ui-sandbox.mjs`、`tests/`         | 同步改写集成测试与 E2E 测试                                                                                                                   |

Excel 读写需要新增一个依赖（候选 `exceljs`），实施前按契约登记。

## 8. 待确认

| 编号 | 问题                                                                                               | 建议                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1   | 业务 Owner 存文本还是从项目成员中选？                                                              | 存文本。客户方的业务负责人一般不是平台用户                                                                                                                                                                                       |
| Q2   | 四个阶段的负责人（业务顾问、开发人员、顾问测试人、IT/用户测试人）是否必须是平台上的项目成员？      | 必须是。Agent 的编辑权限按阶段负责人判断；IT/用户测试人如果常是客户方人员，可改为文本                                                                                                                                            |
| Q3   | “已延误”由用户手工设置，还是系统按“计划完成日期已过且未完成”自动判断？                             | 手工设置；表格对“计划已过期但状态不是已完成”的行显示提醒，不自动改数据。2026-10-30 起清单的“风险”页签与提醒改用共享判定 `atRisk`：手工已延误或计划已过未完成都算（[开发概览设计](../../modules/development-overview.md)第 3 节） |
| Q4   | 编号按项目各自从 00001 开始，还是全组织统一流水？                                                  | 按项目                                                                                                                                                                                                                           |
| Q5   | 抽屉里的“关联附件”和“最近活动”是否保留？它们不在字段表里，但不是字段                               | 都保留，放在抽屉最后两组                                                                                                                                                                                                         |
| Q6   | 事务码一个开发项可能有多个吗？`TADIR` 中事务码本身是对象类型 `TRAN`                                | 保留文本字段，允许逗号分隔多个；以后可从开发对象中类型为 `TRAN` 的行自动带出                                                                                                                                                     |
| Q7   | 按用户保存的视图（列顺序、显示列、筛选条件）是否要存数据库、能否共享给项目成员？目前存在浏览器本地 | 本轮保持浏览器本地；需要共享视图时再加 `development_view` 表                                                                                                                                                                     |

## 9. 实施结果（2026-10-13）

- **迁移**：`database/migrations/1791900000000_development-list-rebuild.sql`，按第 6 节执行；目录契约升级为 1.6（3.3 节）。
- **共享字段目录**：`packages/contracts/delivery/fields.mjs`。字段键：基本字段用名称（如 `name`），阶段字段用 `阶段.字段`（如 `fsd.status`、`development.effortDays`），自定义列用 `custom.<id>`，另有 `tags`、`objects`。
- **接口**（前缀 `/api/projects/:projectId`）：

  | 接口                                                                                             | 说明                                                                         |
  | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
  | `GET /development-items`                                                                         | 清单：开发项（含阶段、对象、标签、自定义值）、成员、标签、自定义列           |
  | `POST /development-items`、`PATCH /development-items/:id`                                        | 新建；按字段键修改（带 `rowVersion`）                                        |
  | `DELETE /development-items/:id`                                                                  | 软删除，编号不复用                                                           |
  | `POST /development-items/batch`                                                                  | `action`：`update`（含 `addTags`/`removeTags`）、`copy`、`delete`；单事务    |
  | `POST /development-items/export`                                                                 | 导出 Excel（指定 `ids` 与列 `keys`）                                         |
  | `GET /development-items/import-template`                                                         | 导入模板（含下拉选项与填写说明）                                             |
  | `POST /development-items/import/preview`、`/import`                                              | 导入检查预览；确认导入（全部通过才写入）                                     |
  | `GET`、`POST /development-items/:id/files`、`GET`、`DELETE /development-items/:id/files/:fileId` | 附件列表、上传、下载、删除（删除写开发项事件 `file_removed`，2026-10-29 起） |
  | `/development-tags`                                                                              | 标签：新建需 `delivery.item:edit`，改名、删除需 `delivery.config:manage`     |
  | `/development-fields`                                                                            | 自定义列定义（`delivery.config:manage`）；删除即归档                         |

- **下钻**：地址带 `from=overview|load`、`label` 与筛选键（判定在 `packages/contracts/delivery/overview.mjs` 的 `matchesFilter`）时，清单显示“来自开发概览 / 开发排期：…”筛选条；下钻条件替代本页筛选，不保存、不读取也不覆盖记住的筛选，只响应本标签的地址（[开发概览设计](../../modules/development-overview.md)第 8 节、[开发排期设计](../../modules/development-load.md)第 4 节）。
- **测试副本**（`/:id/test-copy`）：编号取新流水号，名称加测试前缀，FSD 负责人为发起人。
- **删除**：旧的报表案例导入脚本 `scripts/maintenance/import-report-cases.mjs` 由 Excel 导入替代后删除。
