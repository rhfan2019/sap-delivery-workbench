# 列表报表控件

> 状态：已实施 · 最后更新：2026-11-04。用户 2026-11-04 确认参照 Fiori List Report 与 ALV 的筛选体验，把“表格 + 筛选 + 布局”封装成跨页面的控件，开发清单是第一个使用者。界面规范见 [DESIGN.md](../DESIGN.md) 第 6.1 节。

## 1. 定位与取舍

| Fiori / ALV 能力                 | 这里的做法                                                      |
| -------------------------------- | --------------------------------------------------------------- |
| SmartFilterBar                   | 常驻筛选栏，可隐藏（快捷键 F），隐藏后条件变成可移除的标签      |
| Adapt Filters                    | 适配筛选：任意字段可放上筛选栏，可调整顺序                      |
| SELECT-OPTIONS（I/E + EQ/BT/CP） | 条件结构（第 3 节），前端已开放多选、排除、范围、包含文字和为空 |
| SmartTable 列头菜单 / ALV 列筛选 | 列头菜单：排序、同一筛选面板、加入筛选栏、隐藏此列              |
| Variant Management               | 视图：保存筛选栏字段、条件、列和排序，可设默认、打开即应用      |

已确认的取舍（用户 2026-11-04 确认）：

- **没有“开始”（Go）按钮**：开发清单全量加载在前端，条件改动立即生效。`打开即应用` 关闭的视图除外，它先显示条件，点“应用”才显示结果。
- **范围页签保留**：“全部 / 我的开发 / 风险”叠加在筛选结果之上，计数随筛选变化，也保存进视图。
- **常用日期范围是动态的**：选“本月”保存的就是“本月”，每次按当天计算；手填日期才是固定的。
- **分两档**：字段多、数据量大的台账用这个控件；很短的设置列表继续用 DESIGN.md 第 5 节的“设置列表表格”，不强行套用。

## 2. 怎么使用

控件在 `apps/web/src/components/list-report/`。页面只声明字段和规则：

```ts
const report = useListReport<Item>({
  listKey: 'delivery.items', // 在 LIST_REPORTS 登记
  rows,
  fields,
  columns,
  scopes,
  searchText,
  compare,
  today,
  stateKey,
  layoutKey,
  viewsUrl,
});
```

```vue
<ListReport v-model:checked="checked" :report="report" scope-label="清单范围" width-key="…">
  <template #cell="{ row, column }">…</template>
  <template #mobile-row="{ row }">…</template>
  <template #empty="{ hasFilters }">…</template>
  <template #detail>…</template>
</ListReport>
```

| 文件                 | 职责                                                 |
| -------------------- | ---------------------------------------------------- |
| `useListReport.ts`   | 状态与规则：条件、范围、排序、分页、工作状态、视图   |
| `ListReport.vue`     | 页面主体：工具行、筛选栏、标签、表格、列头菜单、翻页 |
| `FilterField.vue`    | 筛选栏上的一个字段                                   |
| `FilterPanel.vue`    | 编辑一个字段的条件，筛选栏和列头菜单共用             |
| `AdaptFilters.vue`   | 适配筛选                                             |
| `ViewMenu.vue`       | 视图下拉、已修改提示、保存                           |
| `SaveViewDialog.vue` | 另存为新视图，列出将保存的内容                       |
| `ManageViews.vue`    | 管理视图：改名、默认、打开即应用、删除               |

字段类型 `ListField.type`：`select`（多选，带命中数；`emptyLabel` 提供“未分配”这类空值选项）、`date`（常用范围、起止日期、只看未填写）、`number`（最小、最大）、`text`（包含文字）。开发清单的字段由 `features/delivery/listFields.ts` 从字段目录生成，自定义列随之可筛选；`select` 的多选、排除、为空都按阶段字段分别判断（如“开发状态”“开发人员”），解决了原来“负责人”与“阶段状态”分开判断、可能查出别人负责的阶段的问题；需要跨阶段时用“任一阶段状态”“任一阶段负责人”。

## 3. 条件

`packages/contracts/list-report/conditions.mjs`，纯函数、前后端共用：

- 一个字段有多条范围 `{ sign: 'I' | 'E', option, low, high }`，`option` 为 `EQ`、`CP`（包含文字，不分大小写）、`BT`（范围，任一端可空）、`EMPTY`、`PRESET`（常用日期范围）。
- 判断规则同 SELECT-OPTIONS：有包含范围时至少满足一条，且不满足任何排除范围。多值字段任一值满足即算满足。
- 不同字段之间是“且”。**每个有条件的字段都留在筛选栏上**，不会有看不见的条件；在适配筛选取消勾选会一并清除条件。

## 4. 视图

- **数据**：`app.list_view`（项目、所有者、`list_key`、名称、`is_default`、`auto_apply`、`state`）。视图按人按项目；同一人同一列表名称唯一、默认最多一个；每人每列表最多 50 个。“标准”是系统视图，不入库，名称保留。
- **内容**：`normalizeViewState`（`packages/contracts/list-report/views.mjs`）只保留搜索、范围、筛选栏字段及顺序、条件、列（顺序、显示、列宽）、排序。列宽变化不算“已修改”。
- **接口**：`GET/POST /api/projects/:projectId/list-views/:listKey`、`PATCH/DELETE …/:id`，归 `list-views` 模块。
- **权限**：读取跟随列表的查看权限点，写入需要 `delivery.view:save`（登记在 `LIST_REPORTS`），`PRJ_VIEW` 自带；范围外项目与别人的视图 404，缺权限 403，项目归档后只读（409）。创建、修改、删除写审计（`list_view.*`）。
- **打开顺序**：本次会话离开时的状态 → 默认视图 → 标准视图（列布局沿用本浏览器记住的）。下钻（如从开发概览进入）是附加筛选，不写入工作状态、不应用默认视图。

## 5. 现状与下一步

最后更新：2026-11-04（第一期实施）。

- **现状**：第一期已实施并用于开发清单：筛选栏、多选与排除、日期范围、列头菜单、适配筛选、私有视图。
- **下一步**：值帮助“定义条件”对话框与项目共享视图（FEAT-026）；再接一个差异大的页面验证控件边界（FEAT-027）。
- **已知问题**：FEAT-026、FEAT-027。
- **架构速览**：页面声明 → `useListReport`（规则）→ `ListReport`（界面）→ `WorkbenchTable`（表格，列布局由外部传入）；条件与视图校验在 `packages/contracts/list-report`，视图存储在 `apps/api/src/modules/list-views`。
- **测试资产**：`tests/unit/contracts/list-report.test.mjs`（条件、预设、视图校验）、`tests/integration/api/list-views.test.mjs`（403 / 404、所有者、默认、归档、审计）、`tests/e2e/list-report-ui.test.mjs`（完整流程）。
- **注意事项**：新列表要在 `LIST_REPORTS` 登记并给出权限点；列头菜单和面板在 portal 里打开，样式放 `list-report.css` 且类名带 `lr-` 前缀；模态对话框会挡住 `askConfirmation`，要先收起（见 `ManageViews.vue`）。
- **新会话开场提示**：先读本文与 DESIGN.md 第 6.1 节；改条件语义动 `conditions.mjs` 和单测，改界面动 `components/list-report/`。
