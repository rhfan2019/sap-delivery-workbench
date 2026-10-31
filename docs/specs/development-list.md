# 开发清单重构设计

> 2026-10-12 设计，2026-10-13 实施。状态：已实施（第 8 节待确认问题均按建议执行）。字段口径以用户提供的字段表（5 组、43 个字段）为准，表中没有的现有字段全部删除。界面约定见[表格页面模板](../guides/table-page-template.md)。

## 1. 已确认的需求

| 主题       | 结论                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 字段       | 只保留字段表中的字段；删除阶段、验收条件、阻塞原因、测试负责人、三个旧“计划完成”日期、“有阻塞”筛选                                               |
| 编号       | 5 位流水号，从 `00001` 开始递增                                                                                                                  |
| 业务顾问   | 现有“业务顾问”即 FSD 阶段的业务顾问；“业务 Owner”是新增字段                                                                                      |
| 新增日期   | 默认当天，可修改                                                                                                                                 |
| 完成百分比 | 手工维护；状态改为“已完成”时自动设为 100                                                                                                         |
| 阶段关系   | FSD、开发、顾问测试、IT/用户测试四个阶段互不依赖，没有阻塞概念                                                                                   |
| 人天预估   | FSD、开发两个阶段，统一一位小数                                                                                                                  |
| 开发对象   | 子表格：对象标识、对象类型、对象名称，对应 SAP `TADIR` 主键（`PGMID`/`OBJECT`/`OBJ_NAME`）；一个开发项可有多个对象；同一对象允许挂在多个开发项下 |
| 标签       | 用户可按需给开发项打标签                                                                                                                         |
| 自定义列   | 运行中按需增加列（见第 5 节）                                                                                                                    |
| 旧数据     | 现有开发项及其关联数据全部清除，编号重新从 1 开始                                                                                                |
| 行内 Agent | 每行有“设计、开发、顾问测试、IT/用户测试”四个按钮；目前只有设计可用，其余三个点击后提示“即将开发”                                                |
| 抽屉       | 风格对齐“大模型”页面抽屉；不分页签，一页内按分组显示；不放 FS 章节编辑器，后续显示设计定稿 FSD 的链接；放“设计”按钮跳转设计助手                  |
| 批量操作   | 批量删除、批量复制、批量修改（弹窗中每个字段一行：勾选框 + 新值，确认后只改勾选字段）等                                                          |
| 导入导出   | 导出 Excel、从 Excel 导入属于页面级操作；导出选中项属于批量操作                                                                                  |

## 2. 表清单总览

| 表                               | 处理           | 作用                                                          |
| -------------------------------- | -------------- | ------------------------------------------------------------- |
| `app.development_item`           | 重建           | 开发项主表：基本信息、开发阶段专有字段、自定义列取值          |
| `app.development_item_phase`     | 新建           | 四个阶段的负责人、人天、日期、百分比、状态、备注（每项 4 行） |
| `app.development_item_object`    | 新建           | 开发对象（`TADIR` 主键）                                      |
| `app.development_tag`            | 新建           | 项目内的标签字典                                              |
| `app.development_item_tag`       | 新建           | 开发项与标签的多对多关系                                      |
| `app.development_field`          | 新建           | 项目级自定义列定义                                            |
| `app.development_event`          | 保留，清空数据 | 开发项变更历史（抽屉“最近活动”、测试复制幂等）                |
| `app.development_file`           | 保留，清空数据 | 开发项附件（待确认是否保留，见第 8 节）                       |
| `app.fs_draft`、`app.fs_version` | 删除           | 旧的手工 FS 章节编辑器，已由设计助手替代                      |

关系：

```text
project ─┬─< development_item ─┬─< development_item_phase   (固定 4 行)
         │                     ├─< development_item_object
         │                     ├─< development_item_tag >── development_tag ──┐
         │                     ├─< development_event                          │
         │                     ├─< development_file                           │
         │                     └─< abap_fsd_agent_session（设计助手，已有）   │
         ├─< development_tag ─────────────────────────────────────────────────┘
         └─< development_field（自定义列定义；取值在 development_item.custom_values）
```

所有表沿用现有约定：带 `organization_id`、`project_id`，用 `(organization_id, project_id, item_id)` 复合外键保证不跨项目；运行账号 `sap_workbench_app` 只授予需要的权限。

## 3. 表结构

### 3.1 `app.development_item`（开发项主表，重建）

| 列                  | 类型         | 约束 / 默认值                                                    | 对应字段         |
| ------------------- | ------------ | ---------------------------------------------------------------- | ---------------- |
| `id`                | uuid         | 主键，`gen_random_uuid()`                                        | —                |
| `organization_id`   | uuid         | 非空                                                             | —                |
| `project_id`        | uuid         | 非空，外键 `project`                                             | —                |
| `item_no`           | integer      | 非空，`1..99999`；`UNIQUE(organization_id, project_id, item_no)` | 编号（数值）     |
| `code`              | varchar(5)   | 生成列 `lpad(item_no::text, 5, '0')`                             | 编号（显示）     |
| `module`            | varchar(16)  | 非空                                                             | 模块             |
| `kind`              | varchar(20)  | 非空，`report / function / interface / enhancement`              | 类型             |
| `name`              | varchar(200) | 非空，去空格后不为空                                             | 开发名称         |
| `business_function` | text         | 非空，默认 `''`；HTML 富文本（服务端清洗）                       | 业务功能点       |
| `priority`          | varchar(10)  | 非空，`high / medium / low`，默认 `medium`                       | 优先级           |
| `difficulty`        | varchar(10)  | 非空，`hard / medium / easy`，默认 `medium`                      | 难易度           |
| `change_type`       | varchar(20)  | 非空，`new / rebuild / optimize`，默认 `new`                     | 开发类型         |
| `registered_on`     | date         | 非空，默认 `current_date`，可修改                                | 开发项新增日期   |
| `business_owner`    | varchar(100) | 非空，默认 `''`                                                  | 业务 Owner       |
| `notes`             | text         | 非空，默认 `''`；HTML 富文本                                     | 基本备注         |
| `transaction_code`  | varchar(200) | 非空，默认 `''`                                                  | 事务码（开发组） |
| `custom_values`     | jsonb        | 非空，默认 `'{}'`，必须是对象；键为自定义列 id                   | 自定义列取值     |
| `created_by`        | uuid         | 非空，外键 `app_user`                                            | —                |
| `created_at`        | timestamptz  | 非空，`now()`                                                    | —                |
| `updated_by`        | uuid         | 外键 `app_user`                                                  | —                |
| `updated_at`        | timestamptz  | 非空，`now()`                                                    | —                |
| `row_version`       | bigint       | 非空，默认 1；乐观锁，任何子表变更也同步加 1                     | —                |
| `deleted_at`        | timestamptz  | 软删除标记                                                       | —                |

索引：`(organization_id, project_id, item_no DESC) WHERE deleted_at IS NULL`（列表默认排序）；`GIN(custom_values)`（自定义列筛选）。

说明：

- **编号**：按项目各自从 `00001` 编号。新建时在同一事务内对项目加咨询锁，取 `max(item_no)+1`（含已软删除的行），删除后编号不复用。界面和导出只显示 `code`。
- **类型**：去掉现有的“表单”。
- **模块**：不在数据库里写死取值，由应用按选项表校验，默认 MM / SD / PP / FICO，方便以后增加 QM、PM 等模块而不改表。
- **富文本**：旧数据全部清除，不再需要 `summary_format` 判别列，统一存清洗后的 HTML。
- **业务 Owner**：通常是客户方人员，不一定是平台用户，所以存文本（待确认，见第 8 节）。
- **事务码**：开发阶段专有，放主表；多个事务码用逗号分隔。

### 3.2 `app.development_item_phase`（阶段明细，新建）

每个开发项固定 4 行，随开发项一起创建：`fsd`、`development`、`consultant_test`、`user_test`。

| 列                | 类型         | 约束 / 默认值                                                                                                   | 对应字段                                         |
| ----------------- | ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `organization_id` | uuid         | 非空                                                                                                            | —                                                |
| `project_id`      | uuid         | 非空                                                                                                            | —                                                |
| `item_id`         | uuid         | 非空，复合外键 → `development_item`                                                                             | —                                                |
| `phase`           | varchar(20)  | 非空，`fsd / development / consultant_test / user_test`；主键 `(item_id, phase)`                                | 分组                                             |
| `assignee_id`     | uuid         | 可空，复合外键 → `project_member(organization_id, project_id, user_id)`                                         | 业务顾问 / 开发人员 / 顾问测试人 / IT/用户测试人 |
| `effort_days`     | numeric(5,1) | 可空，`>= 0`；仅 `fsd`、`development` 允许有值                                                                  | 人天预估                                         |
| `planned_start`   | date         | 可空                                                                                                            | 计划开始日期                                     |
| `planned_end`     | date         | 可空，`>= planned_start`                                                                                        | 计划完成日期                                     |
| `actual_start`    | date         | 可空；第一次变为“进行中”或“已延误”时自动写当天（2026-10-30，[开发概览设计](development-overview.md)第 6 节 D2） | 实际开始日期                                     |
| `actual_end`      | date         | 可空                                                                                                            | 实际完成日期                                     |
| `progress`        | smallint     | 非空，默认 0，`0..100`                                                                                          | 完成百分比                                       |
| `status`          | varchar(20)  | 非空，默认 `not_started`；`not_started / in_progress / completed / delayed / cancelled`                         | 状态                                             |
| `notes`           | text         | 非空，默认 `''`；HTML 富文本                                                                                    | 备注                                             |
| `updated_by`      | uuid         | 外键 `app_user`                                                                                                 | —                                                |
| `updated_at`      | timestamptz  | 非空，`now()`                                                                                                   | —                                                |

约束：`CHECK(status <> 'completed' OR progress = 100)`，保证“已完成即 100%”。应用层在状态改为“已完成”时自动写入 100。

索引：`(organization_id, project_id, phase, status)`、`(organization_id, project_id, phase, assignee_id)`，支撑“我负责的”“各阶段进行中”等筛选。

为什么拆成子表，而不是在主表上平铺 4×8 列：

- 四组字段结构相同，子表一行一个阶段，校验、批量修改、Excel 映射都能复用一套逻辑；平铺需要 30 多列，每列的约束都要写 4 遍。
- 和四个 Agent 一一对应：设计助手的编辑权限取 `fsd` 阶段负责人（现在取 `business_owner_id`），以后开发 Agent 取 `development` 阶段负责人。
- 列表查询一次取出 4 行再在应用里拼成宽行，数据量（每项目几百到几千项）下没有性能问题。

### 3.3 `app.development_item_object`（开发对象，新建）

| 列                | 类型         | 约束 / 默认值                                           | 对应字段 |
| ----------------- | ------------ | ------------------------------------------------------- | -------- |
| `id`              | uuid         | 主键                                                    | —        |
| `organization_id` | uuid         | 非空                                                    | —        |
| `project_id`      | uuid         | 非空                                                    | —        |
| `item_id`         | uuid         | 非空，复合外键 → `development_item`                     | —        |
| `pgmid`           | varchar(4)   | 非空，默认 `R3TR`，大写字母数字                         | 对象标识 |
| `object_type`     | varchar(4)   | 非空，大写字母数字（如 `PROG`、`CLAS`、`ENHO`、`TRAN`） | 对象类型 |
| `object_name`     | varchar(120) | 非空，大写（允许命名空间 `/XXX/`）                      | 对象名称 |
| `sort_order`      | integer      | 非空，默认 0                                            | —        |
| `created_by`      | uuid         | 非空                                                    | —        |
| `created_at`      | timestamptz  | 非空，`now()`                                           | —        |

约束：`UNIQUE(item_id, pgmid, object_type, object_name)`，同一开发项内不重复，跨开发项允许重复。

索引：`(organization_id, project_id, object_type, object_name)`，用于在抽屉里提示“该对象也被 00012、00031 使用”，以及按对象名搜索开发项。

### 3.4 标签：`app.development_tag` + `app.development_item_tag`（新建）

`development_tag`（项目内标签字典）：

| 列                | 类型        | 约束 / 默认值                                     |
| ----------------- | ----------- | ------------------------------------------------- |
| `id`              | uuid        | 主键                                              |
| `organization_id` | uuid        | 非空                                              |
| `project_id`      | uuid        | 非空，外键 `project`                              |
| `name`            | varchar(30) | 非空；项目内按小写唯一                            |
| `color`           | varchar(16) | 非空，默认 `gray`（取自固定调色板，不存任意色值） |
| `created_by`      | uuid        | 非空                                              |
| `created_at`      | timestamptz | 非空                                              |

`development_item_tag`：`organization_id`、`project_id`、`item_id`、`tag_id`、`created_by`、`created_at`；主键 `(item_id, tag_id)`，索引 `(tag_id)`。

- 标签按项目隔离：不同项目的标签互不影响。
- 用户在开发项上输入新标签名时自动创建；在“标签管理”中可改名、改颜色、删除（删除同时解除所有关联）。
- 列表支持按标签筛选（多选，任一匹配），批量修改支持“添加标签 / 移除标签”。

### 3.5 `app.development_field`（自定义列定义，新建）

| 列                                                      | 类型        | 约束 / 默认值                                                                                                   |
| ------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                                                    | uuid        | 主键，同时是 `custom_values` 中的键                                                                             |
| `organization_id`                                       | uuid        | 非空                                                                                                            |
| `project_id`                                            | uuid        | 非空，外键 `project`                                                                                            |
| `label`                                                 | varchar(50) | 非空；项目内未归档的列按小写唯一                                                                                |
| `field_type`                                            | varchar(20) | 非空：`text / long_text / number / date / select / multi_select / member / checkbox / url`                      |
| `options`                                               | jsonb       | 非空，默认 `'[]'`；单选、多选的选项 `[{id, label, color}]`                                                      |
| `group_key`                                             | varchar(20) | 非空，默认 `custom`：`basic / fsd / development / consultant_test / user_test / custom`，决定抽屉里显示在哪一组 |
| `sort_order`                                            | integer     | 非空，默认 0                                                                                                    |
| `required`                                              | boolean     | 非空，默认 false                                                                                                |
| `archived_at`                                           | timestamptz | 归档后隐藏，取值保留                                                                                            |
| `created_by`、`created_at`、`updated_at`、`row_version` | —           | 同其他表                                                                                                        |

自定义列的取值存在 `development_item.custom_values` 里，例如 `{"<字段 id>": "2026-11-01", "<字段 id>": ["<选项 id>"]}`。服务端按定义校验类型。

## 4. 不再保留的旧字段对照

| 旧列                                                       | 处理                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `code`（`DEV-0031` 格式）                                  | 改为 `item_no` + 生成列 `code`（`00031`）              |
| `summary`、`summary_format`                                | 改名为 `business_function`，只存 HTML                  |
| `business_owner_id`                                        | 迁到 `development_item_phase(fsd).assignee_id`         |
| `developer_id`                                             | 迁到 `development_item_phase(development).assignee_id` |
| `tester_id`                                                | 删除，由两个测试阶段的负责人替代                       |
| `planned_fs_date`、`planned_dev_date`、`planned_test_date` | 删除，由各阶段计划日期替代                             |
| `acceptance`、`blocked_reason`、`stage`                    | 删除                                                   |
| `kind = 'form'`                                            | 删除该取值                                             |

## 5. 自定义列：可以实现

可以实现，而且应该按“项目级字段定义 + 取值存 JSON”来做，不靠运行中改表结构。

| 方案                                  | 做法                       | 评价                                                                                          |
| ------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| 运行中 `ALTER TABLE` 加列             | 用户加一列就给表加一列     | 不采用：运行账号不应有改表权限；所有项目共用一张表，A 项目加的列会出现在 B 项目；迁移无法管理 |
| 键值表（每个值一行）                  | `item_id, field_id, value` | 不采用：列表要按字段逐个关联，筛选、排序、导出都复杂                                          |
| **字段定义表 + `custom_values` JSON** | 第 3.5 节                  | **采用**：项目之间隔离；加列不改表；PostgreSQL 的 jsonb 可建索引、可筛选排序                  |

用户能做的事：

- 项目管理员在“列设置 → 自定义列”中新增列：填名称、选类型（文本、长文本、数字、日期、单选、多选、人员、勾选、链接），单选和多选再填选项；选择显示在哪个分组。
- 新列立即出现在表格（可显示、隐藏、排序、筛选）、抽屉对应分组、批量修改弹窗、Excel 导入导出里，用法和内置列一致。
- 改名、调整顺序、增加选项随时可做。修改类型只允许不丢数据的方向（例如文本改长文本）。
- 删除列实际是归档：列隐藏，数据保留，可以恢复。不做物理删除，防止误删整列数据。
- 每个项目最多 50 个有效自定义列，防止表格失控。

和 Excel 相比的差异：Excel 里加列没有类型约束；这里加列要选类型，换来的是筛选、校验、批量修改都能用。不提供“公式列”。

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

| 编号 | 问题                                                                                               | 建议                                                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1   | 业务 Owner 存文本还是从项目成员中选？                                                              | 存文本。客户方的业务负责人一般不是平台用户                                                                                                                                                                         |
| Q2   | 四个阶段的负责人（业务顾问、开发人员、顾问测试人、IT/用户测试人）是否必须是平台上的项目成员？      | 必须是。Agent 的编辑权限按阶段负责人判断；IT/用户测试人如果常是客户方人员，可改为文本                                                                                                                              |
| Q3   | “已延误”由用户手工设置，还是系统按“计划完成日期已过且未完成”自动判断？                             | 手工设置；表格对“计划已过期但状态不是已完成”的行显示提醒，不自动改数据。2026-10-30 起清单的“风险”页签与提醒改用共享判定 `atRisk`：手工已延误或计划已过未完成都算（[开发概览设计](development-overview.md)第 3 节） |
| Q4   | 编号按项目各自从 00001 开始，还是全组织统一流水？                                                  | 按项目                                                                                                                                                                                                             |
| Q5   | 抽屉里的“关联附件”和“最近活动”是否保留？它们不在字段表里，但不是字段                               | 都保留，放在抽屉最后两组                                                                                                                                                                                           |
| Q6   | 事务码一个开发项可能有多个吗？`TADIR` 中事务码本身是对象类型 `TRAN`                                | 保留文本字段，允许逗号分隔多个；以后可从开发对象中类型为 `TRAN` 的行自动带出                                                                                                                                       |
| Q7   | 按用户保存的视图（列顺序、显示列、筛选条件）是否要存数据库、能否共享给项目成员？目前存在浏览器本地 | 本轮保持浏览器本地；需要共享视图时再加 `development_view` 表                                                                                                                                                       |

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

- **下钻**：地址带 `from=overview|load`、`label` 与筛选键（判定在 `packages/contracts/delivery/overview.mjs` 的 `matchesFilter`）时，清单显示“来自开发概览 / 开发排期：…”筛选条；下钻条件替代本页筛选，不保存、不读取也不覆盖记住的筛选，只响应本标签的地址（[开发概览设计](development-overview.md)第 8 节、[开发排期设计](development-load.md)第 4 节）。
- **测试副本**（`/:id/test-copy`）：编号取新流水号，名称加测试前缀，FSD 负责人为发起人。
- **删除**：旧的报表案例导入脚本 `scripts/maintenance/import-report-cases.mjs` 由 Excel 导入替代后删除。
