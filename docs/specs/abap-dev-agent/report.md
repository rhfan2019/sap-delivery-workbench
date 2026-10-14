# 开发类型规范：可执行程序（报表与功能）

适用于开发清单中开发类型为“报表”（只读查询）和“功能”（可编辑 ALV、BAPI 写回、审批等）的开发项。产物是**一个完整的可执行程序**（巨石代码，不拆 INCLUDE），业务逻辑封装在继承基类 `YCL_FRH_REPORT` 的局部类 `lcl_report` 中。本规范与系统指令第十部分的通用规范一起生效，冲突时以本规范为准。

## 一、基类是架构的唯一依据

会话上下文中的“基类源码”一节给出 `YCL_FRH_REPORT` 的完整源码，并注明来自目标系统还是内置副本。

- **以源码为准**：重定义的方法名、可见性、参数和返回值必须与源码完全一致。不凭记忆写基类方法，不调用源码中不存在的方法。
- **只重定义需要的方法**：基类方法默认是空实现，没用到的不要重定义。
- **基类依赖的工具类**（`YCL_FRH_UTIL_AUTH`、`YCL_FRH_UTIL_LOGGER`、`YCL_FRH_UTIL_TVARVC`）：只使用本规范给出的调用方式。需要其他方法时，有目标系统就先读取该类的源码确认签名；没有目标系统时不使用，改用标准写法并列入未决事项。
- 基类来自内置副本、且目标系统中没有该类时，在开发方案 3.4 节写明：先在 SAP 中部署 `YCL_FRH_REPORT` 及其依赖的工具类、函数模块 `YALV_DISPLAY_ALV_GRID`。

### 1. 运行流程

| 时机               | 程序事件                     | 调用                                         |
| ------------------ | ---------------------------- | -------------------------------------------- |
| 程序启动           | `INITIALIZATION`             | 创建 `lcl_report` 对象，调用 `initialize( )` |
| 选择屏幕输出前     | `AT SELECTION-SCREEN OUTPUT` | `selscr_modify( )`                           |
| 选择屏幕回车或执行 | `AT SELECTION-SCREEN`        | `selscr_ucomm( )`，然后 `selscr_check( )`    |
| 执行               | `START-OF-SELECTION`         | `run( )`                                     |

`run( )` 由基类实现，依次调用 `prepare( )` → `select( )` → `process( )` → `display( )`。`display( )` 在后台作业（`sy-batch`）中直接返回，前台时自动把 `gt_out` 关联为输出表、构建字段目录与 ALV 参数，并调用 `YALV_DISPLAY_ALV_GRID` 显示。

### 2. 可重定义的方法

| 方法                            | 可见性    | 职责                                                                |
| ------------------------------- | --------- | ------------------------------------------------------------------- |
| `initialize`                    | PUBLIC    | 选择屏幕默认值、通配符默认值、左侧宽度等初始化                      |
| `selscr_modify`                 | PUBLIC    | 选择屏幕动态显示（`LOOP AT SCREEN`）                                |
| `selscr_ucomm`                  | PUBLIC    | 选择屏幕上的按钮或单选联动                                          |
| `selscr_check`                  | PUBLIC    | 选择条件的逻辑校验与权限检查（SRI，见第四部分）                     |
| `prepare`                       | PROTECTED | 取数前的准备，如读取 TVARVC 参数、组织范围                          |
| `select`                        | PROTECTED | 取数，结果放入 `gt_out`（及 `gt_dtl`）                              |
| `process`                       | PROTECTED | 数据库无法完成的加工（状态灯、文本拼接、跨来源合并）                |
| `build_alv_grid_fcat`           | PROTECTED | 调整字段目录：标题、隐藏、合计、可编辑、热点等                      |
| `build_alv_grid_paras`          | PROTECTED | 调整 ALV 参数（`ms_alv_grid_paras`），如排序、标题                  |
| `on_grid_toolbar`               | PUBLIC    | 在 ALV 工具栏增加按钮（`e_object->mt_toolbar`）                     |
| `on_grid_pf_status_set`         | PUBLIC    | 调整 GUI 状态中排除的功能（`ct_extab`）                             |
| `on_grid_user_command`          | PUBLIC    | 处理按钮功能码（`e_ucomm`），如保存、审批                           |
| `on_grid_top_of_page`           | PUBLIC    | 表头信息                                                            |
| `on_grid_double_click`          | PUBLIC    | 双击，基类在重定义后自动注册事件                                    |
| `on_grid_hotspot_click`         | PUBLIC    | 热点单击，基类在重定义后自动注册事件                                |
| `on_grid_data_changed`          | PUBLIC    | 可编辑 ALV 的录入校验，基类在重定义后自动注册事件                   |
| `on_grid_data_changed_finished` | PUBLIC    | 录入完成后的联动计算，基类在重定义后自动注册事件                    |
| `render_left`                   | PUBLIC    | 左侧容器内容（需在 `initialize` 中调用 `set_left_width( )` 设宽度） |

PUBLIC 方法在 `PUBLIC SECTION` 中用 `METHODS 方法名 REDEFINITION.` 声明，PROTECTED 方法在 `PROTECTED SECTION` 中声明。可见性写错会导致语法错误。

### 3. 可直接使用的基类能力

| 能力             | 用法                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| 字段目录单列引用 | `me->ref_fcat( 'MATNR' )->coltext = '物料'(f01).` 字段名不存在时以 A 类消息终止，开发阶段即可暴露错误    |
| 进度提示         | `me->set_progress( iv_text = '正在读取采购申请'(c01) iv_perc = 30 ).`                                    |
| 跳转事务         | `me->call_transaction( iv_tcode = 'ME53N' it_spagpa = VALUE #( ( parid = 'BAN' parval = lv_banfn ) ) ).` |
| 当前 ALV 控件    | 受保护属性 `mo_alv_grid`，用于 `check_changed_data( )`、`refresh_table_display( )` 等                    |
| 重新执行         | `me->restart( )` 以当前选择条件重新提交程序                                                              |
| 权限检查         | `me->get_util_auth( )->check_authority( ... )`，见第四部分                                               |

### 4. 基类已经处理、子类不要重复的

- **选择文本**：参照 DDIC 字段的参数和选择条件（`PARAMETERS ... TYPE 表-字段`、`SELECT-OPTIONS ... FOR 表-字段`），基类在运行时自动以字段描述作为选择文本。只有没有 DDIC 参照的字段才需要手工维护选择文本。
- **字段目录**：基类按 `ts_out` 的组件自动生成字段目录，标题来自数据元素。子类在 `build_alv_grid_fcat` 中只做调整，不从头构建，不用宏。
- **ALV 布局**：斑马线、选择列（`MARK`）、布局变式与保存权限、默认标题都由基类设置，子类不要重复设置。
- **技术字段**：`MARK` 和 `LIGHT` 自动设为技术字段，不显示。

## 二、程序结构

### 1. 输出表约定

- `lcl_report` 必须有一个 **PUBLIC** 实例属性 `gt_out`，类型为内表 `tt_out`。基类通过 RTTI 按名称查找该属性，名称或可见性不符时以 A 类消息终止。
- `ts_out` 的组件尽量参照 DDIC 字段（`TYPE 表-字段`），以便字段目录自动带出标题和格式，每个参照字段同行写中文注释。
- 需要行选择（勾选后执行操作）时，`ts_out` 第一个组件为 `mark TYPE c LENGTH 1`；需要状态灯时增加 `light TYPE c LENGTH 1`（取值 `'1'` 红、`'2'` 黄、`'3'` 绿），并在 `build_alv_grid_paras` 中设置 `ms_alv_grid_paras-layout-excp_fname = 'LIGHT'`。
- 有明细时，明细内表为 PUBLIC 属性 `gt_dtl`。

### 2. 代码顺序

```abap
REPORT zxxx.

*--- 数据库表声明（选择条件参照） ---*
TABLES: ...

*--- 选择屏幕 ---*
SELECTION-SCREEN BEGIN OF BLOCK b01 WITH FRAME TITLE TEXT-b01.
  SELECT-OPTIONS: s_werks FOR t001w-werks.            " 工厂
SELECTION-SCREEN END OF BLOCK b01.
*--- 权限影子范围表（不显示） ---*
SELECT-OPTIONS: s_werks1 FOR t001w-werks NO-DISPLAY.

*--- 报表类定义 ---*
CLASS lcl_report DEFINITION FINAL INHERITING FROM ycl_frh_report.
  PUBLIC SECTION.
    TYPES: BEGIN OF ts_out,
             mark  TYPE c LENGTH 1,
             werks TYPE t001w-werks,                  " 工厂
           END OF ts_out,
           tt_out TYPE STANDARD TABLE OF ts_out WITH EMPTY KEY.

    DATA gt_out TYPE tt_out.                          " 输出清单

    METHODS initialize REDEFINITION.
    METHODS selscr_check REDEFINITION.

  PROTECTED SECTION.
    METHODS select REDEFINITION.
    METHODS build_alv_grid_fcat REDEFINITION.
ENDCLASS.

DATA go_report TYPE REF TO lcl_report.

*--- 程序事件 ---*
INITIALIZATION.
  go_report = NEW #( ).
  go_report->initialize( ).

AT SELECTION-SCREEN OUTPUT.
  go_report->selscr_modify( ).

AT SELECTION-SCREEN.
  go_report->selscr_ucomm( ).
  go_report->selscr_check( ).

START-OF-SELECTION.
  go_report->run( ).

*--- 报表类实现 ---*
CLASS lcl_report IMPLEMENTATION.
  ...
ENDCLASS.
```

以上是结构示意，`...` 处在实际代码中必须写完整。

- **事件块只做调用**：`INITIALIZATION` 只允许创建对象和调用 `initialize( )`；其他事件块只调用对应方法。默认值、通配符等逻辑全部放进 `initialize`。
- 选择屏幕用 `SELECTION-SCREEN BEGIN OF BLOCK ... WITH FRAME TITLE TEXT-bxx` 分组。
- 选择条件参照的表在 `TABLES` 中显式声明。
- 全局只有选择屏幕、`TABLES` 和 `go_report`，其他数据都是类的属性或方法内的局部变量。

### 3. 选择屏幕

- **默认值**：在 `initialize` 中赋值。给 `SELECT-OPTIONS` 设通配符默认值时填充 `sign = 'I'`、`option = 'CP'`。
- **校验**：`selscr_check` 只做逻辑防呆：联动必填、日期区间合理性、互斥条件。不为校验输入值是否存在而查询配置表。
- 校验失败用 `MESSAGE '...'(mxx) TYPE 'E'.`，停留在选择屏幕。

## 三、取数与加工

- `select` 负责取数，尽量在 SQL 中完成关联、过滤、计算和汇总（通用规范第十部分第 3 条），结果直接放入 `gt_out`。
- `process` 只做数据库无法完成的加工。不要在 `process` 中做本可在 SQL 中完成的算术。
- 选择条件需要权限过滤的，查询只绑定影子范围表 `s_xxx1`，不绑定原选择条件（第四部分）。
- 拆分复杂逻辑时用 `select1`、`select2`、`process1` 等私有方法，在 `PRIVATE SECTION` 中声明，配中文注释。
- 取数后没有数据时：`MESSAGE '没有符合条件的数据'(m01) TYPE 'S' DISPLAY LIKE 'E'.`，然后返回，不显示空清单。
- 数据量大时，用 `set_progress( )` 提示进度。

## 四、权限检查（SRI 影子范围协议）

只针对 `SELECT-OPTIONS`：

1. **影子范围表**：每个需要权限检查的选择条件 `s_xxx`，定义一个同参照、后缀为 `1` 的不显示范围表 `s_xxx1`（`NO-DISPLAY`）。不得使用 `gr_xxx` 等其他命名。
2. **检查方法**：在重定义的 `selscr_check` 中调用基类工具，不手写 `AUTHORITY-CHECK` 循环：

   ```abap
   me->get_util_auth( )->check_authority(
     EXPORTING
       it_sel_opt        = s_werks[]
       iv_auth_object    = 'M_BANF_WRK'
       iv_auth_field     = 'WERKS'
     CHANGING
       ct_sel_opt        = s_werks1[]             " 查询条件 S_WERKS 的影子
     EXCEPTIONS
       no_authority      = 1
       too_many_records  = 2
       invalid_parameter = 3
       OTHERS            = 4 ).
   IF sy-subrc <> 0.
     MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
       WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.
   ENDIF.
   ```

3. **隔离**：所有 SELECT 只绑定影子范围表（`IN @s_werks1`），不绑定原选择条件。
4. 权限对象和字段先用 SAP 工具核实，写入开发方案 2.3 节。
5. 单值参数（`PARAMETERS`）或按行、按单据的操作权限（如审批），用 `AUTHORITY-CHECK` 按开发方案 1.5 节的规则检查。

## 五、ALV 输出

- **字段目录**：在 `build_alv_grid_fcat` 中用 `me->ref_fcat( '字段名' )` 调整单列；批量调整用 `MODIFY ct_fcat FROM VALUE #( ... ) TRANSPORTING ... WHERE ...`。不用宏，不写冗余的 `ref_field` / `ref_table`。
- **列标题**：需要覆盖 DDIC 标题时，`coltext` 使用文本符号 `'...'(fxx)`。
- **数量与金额**：设置 `qfieldname` / `cfieldname` 绑定单位与币种字段；不同单位不能合计时不设 `do_sum`。
- **热点与跳转**：`ref_fcat( ... )->hotspot = abap_true`，重定义 `on_grid_hotspot_click`，用 `call_transaction( )` 跳转。
- 布局、斑马线、变式等已由基类处理，不要重复设置。

## 六、可编辑 ALV 与写回（功能类）

- **可编辑栏位**：在 `build_alv_grid_fcat` 中设置 `edit = abap_true`。
- **录入校验**：重定义 `on_grid_data_changed`，用 `er_data_changed` 逐单元格校验并添加错误协议。
- **按钮**：在 `on_grid_toolbar` 中向 `e_object->mt_toolbar` 追加按钮，在 `on_grid_user_command` 中按 `e_ucomm` 分派。
- **处理前**：调用 `mo_alv_grid->check_changed_data( )` 取得最新录入；确认勾选行（`mark = abap_true`）；无勾选时给出提示。
- **处理单位**：按开发方案 1.5 节归集（按行或按单据）。
- **提交与回滚**：调用 BAPI 后检查 `RETURN` 中的 E/A 消息；成功则 `BAPI_TRANSACTION_COMMIT`（`wait = abap_true`），失败则 `BAPI_TRANSACTION_ROLLBACK`。按开发方案确定是逐对象提交还是整体提交，单个对象失败不影响其他对象（逐对象提交时）。
- **逐对象结果**：每行记录处理结果（状态灯 `light` 与结果消息字段），处理结束汇总成功、失败数量。
- **锁**：直接更新或需要防并发时，先调用对应的锁对象函数（`ENQUEUE_*`），失败时记为该对象失败。BAPI 自带锁的不重复加锁。
- **刷新**：处理后按开发方案的规则更新 `gt_out` 中对应行，调用 `mo_alv_grid->refresh_table_display( )`；需要整体重新取数时调用 `restart( )`。

## 七、开发方案的手工步骤

- **3.1 程序属性**：类型“可执行程序”；标题；状态、应用、包由开发顾问按项目规范填写。
- **3.2 文本元素**：代码中全部文本符号（`bxx` 块标题、`fxx` 字段目录、`mxx` 消息、`cxx` 其他），编号与代码一致。
- **3.3 选择文本**：只列没有 DDIC 参照的参数和选择条件；参照 DDIC 字段的由基类自动处理，写“其余由基类按 DDIC 自动生成”。
- **3.4 其他对象**：事务码（开发清单登记了事务码时）、需要新建的 DDIC 对象、基类部署（第一部分）。

## 八、自查补充

在系统指令第十二部分的自查表之外，逐项确认：

| 检查项   | 达标                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 基类对齐 | 重定义的方法都在基类源码中存在，可见性与签名一致；没有重定义未用的方法                                             |
| 输出表   | `gt_out` 为 PUBLIC 内表属性；需要勾选时有 `mark`                                                                   |
| 事件块   | `INITIALIZATION` 只有创建对象和 `initialize( )`；默认值都在 `initialize` 中                                        |
| SRI      | 每个需权限检查的 `s_xxx` 都有 `s_xxx1`，用 `get_util_auth( )->check_authority` 并处理异常；SELECT 只绑定影子范围表 |
| 字段目录 | 只在 `build_alv_grid_fcat` 中调整，使用 `ref_fcat`，无宏                                                           |
| 写回     | 勾选检查、`check_changed_data`、提交回滚、逐行结果、刷新都已实现                                                   |
