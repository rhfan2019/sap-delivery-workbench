# 开发类型规范：可执行程序（报表与功能）

适用于开发清单中开发类型为“报表”（只读查询）和“功能”（可编辑 ALV、BAPI 写回、审批等）的开发项。产物是**一个完整的可执行程序**（巨石代码，不拆 INCLUDE），业务逻辑封装在继承基类 `YCL_FRH_REPORT` 的局部类 `lcl_report` 中。本规范与系统指令第十部分的通用规范一起生效，冲突时以本规范为准。

## 一、基类是架构的唯一依据

会话上下文中的“框架接口”一节给出框架各类的定义部分：`YCL_FRH_REPORT` 的 PUBLIC 与 PROTECTED 部分，工具类 `YCL_FRH_UTIL_AUTH`、`YCL_FRH_UTIL_LOGGER`、`YCL_FRH_UTIL_TVARVC` 与异常类 `YCX_FRH_UTIL` 的 PUBLIC 部分，并注明来自目标系统还是内置副本。实现代码不提供；各方法的行为与用法以本规范为准。

- **以接口为准**：重定义的方法名、可见性、参数和返回值，以及调用工具类时的参数名和异常名，必须与“框架接口”完全一致。不凭记忆写框架方法，不调用接口中不存在的方法。
- **只重定义需要的方法**：基类方法默认是空实现，没用到的不要重定义。
- 框架来自内置副本、且目标系统中没有时，在开发方案 3.4 节写明：先在 SAP 中部署框架（`YCL_FRH_REPORT`、`YCL_FRH_UTIL_AUTH`、`YCL_FRH_UTIL_LOGGER`、`YCL_FRH_UTIL_TVARVC`、`YCX_FRH_UTIL`、函数模块 `YALV_DISPLAY_ALV_GRID` 及框架消息类）。

### 1. 运行流程

| 时机               | 程序事件                     | 调用                                         |
| ------------------ | ---------------------------- | -------------------------------------------- |
| 程序启动           | `INITIALIZATION`             | 创建 `lcl_report` 对象，调用 `initialize( )` |
| 选择屏幕输出前     | `AT SELECTION-SCREEN OUTPUT` | `selscr_modify( )`                           |
| 选择屏幕回车或执行 | `AT SELECTION-SCREEN`        | `selscr_check( )`，然后 `selscr_ucomm( )`    |
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
| `on_grid_toolbar`               | PUBLIC    | 在 ALV 工具栏增加按钮；按钮通常放在 GUI 状态中（见第六部分）        |
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
| 字段目录单列引用 | `me->ref_fcat( 'MATNR' )` 取得某列的引用，字段名不存在时以 A 类消息终止；需要在显示前动态修改某列时使用  |
| 进度提示         | `me->set_progress( iv_text = '正在读取采购申请'(c01) iv_perc = 30 ).`                                    |
| 跳转事务         | `me->call_transaction( iv_tcode = 'ME53N' it_spagpa = VALUE #( ( parid = 'BAN' parval = lv_banfn ) ) ).` |
| 当前 ALV 控件    | 受保护属性 `mo_alv_grid`，用于 `check_changed_data( )`、`refresh_table_display( )` 等                    |
| 重新执行         | `me->restart( )` 以当前选择条件重新提交程序                                                              |
| 权限检查         | `me->get_util_auth( )->check_authority( ... )`，见第四部分                                               |

### 4. 基类已经处理、子类不要重复的

- **选择文本**：参照 DDIC 字段的参数和选择条件（`PARAMETERS ... TYPE 表-字段`、`SELECT-OPTIONS ... FOR 表-字段`），基类在运行时自动以字段描述作为选择文本。只有没有 DDIC 参照的字段才需要手工维护选择文本。
- **字段目录的检查**：基类会核对字段目录中的每个字段名都存在于 `gt_out`，不存在时以 A 类消息终止。（基类也会按 `ts_out` 自动生成一份字段目录，但它完全依赖内表定义，标题常不达意，**不使用**，见第五部分。）
- **ALV 布局**：斑马线、选择列（`MARK`）、布局变式与保存权限、默认标题都由基类设置，子类不要重复设置。
- **技术字段**：`MARK` 和 `LIGHT` 自动设为技术字段，不显示。

### 5. 工具类

通过基类的取得方法使用，不自行 `NEW`：

**权限：`me->get_util_auth( )->check_authority( )`**（详见第四部分）

- 选择条件：传 `it_sel_opt` 与 `ct_sel_opt`（影子范围表）。用户只输入了单值（`I EQ`）时逐个检查，原样复制到影子范围表；含区间、通配或排除时，从权限字段对应的主数据表中查出“选择范围内且有权限”的值，以 `I EQ` 形式写入影子范围表，最多 5000 条（TVARVC 参数 `YFRH_UTIL_AUTH_MAX_RECORDS` 可调）。选择条件为空时，影子范围表得到全部有权限的值。
- 单值参数：传 `iv_parameter`，不传 `it_sel_opt` 与 `ct_sel_opt`。两者不能同时传，也不能都不传。
- 主数据表：默认由权限字段的数据元素推导（如 `WERKS` → `T001W`）；推导不出或需要指定时，传 `iv_table_field = 'T001W-WERKS'`。
- 活动：默认 `iv_actvt_field = 'ACTVT'`、`iv_actvt_value = '03'`（显示）；修改、审批等其他活动显式传入。
- 唯一的异常是 `check_failed`。调用时不写 `EXCEPTIONS`，失败消息会直接作为 E 类消息发出（第四部分）。

**日志：`me->get_util_logger( )`**

| 方法                                                            | 用途                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `add_from_bapitab( lt_return )`                                 | 收集 BAPI 返回的 `BAPIRET2_T`                            |
| `add_from_bapiret2( ls_return )`                                | 收集单条 `BAPIRET2`                                      |
| `add_from_symsg( )`                                             | 收集当前 `sy-msg*` 消息（如函数模块异常后）              |
| `add_from_cx( lx_error )`                                       | 收集异常对象的消息                                       |
| `add_error( '...'(mxx) )` / `add_info( ... )`                   | 收集自定义文本消息                                       |
| `has_errors( )` / `is_empty( )` / `get_count( )`                | 判断是否有错误、是否为空、消息数量                       |
| `display( )`                                                    | 以应用日志弹窗显示全部消息（前台）                       |
| `save( iv_object = ... iv_subobject = ... iv_extnumber = ... )` | 保存到应用日志（SLG1），需要已在 SLG0 定义的对象与子对象 |

`run( )` 开始时基类会清空日志。写回类功能处理结束后，用 `display( )` 弹出本次处理的全部消息；需要留存时调用 `save( )`，并把应用日志对象与子对象写入开发方案 3.4 节。方法都返回日志对象本身，可以链式调用。

**参数：`me->get_util_tvarvc( )`**

| 方法                                                                  | 用途                                              |
| --------------------------------------------------------------------- | ------------------------------------------------- |
| `get_value( iv_name = '...' iv_default = ... )`                       | 读单值参数（TVARVC 类型 P），返回 `rvari_val_255` |
| `get_range( EXPORTING iv_name = '...' CHANGING ct_range = lt_range )` | 读范围参数（类型 S）到任意范围表                  |
| `is_in_range( iv_name = '...' iv_value = ... )`                       | 判断值是否落在范围参数中                          |
| `is_configured( iv_name = '...' )`                                    | 参数是否已维护                                    |

用户希望可配置、而又不值得建配置表的值（如参与审批的凭证类型、阈值），放进 TVARVC 参数，在 `prepare` 中读取；参数名以程序名为前缀，写入开发方案 3.4 节（事务 STVARV 维护）。确属固定口径的值才在代码中写死并加注释。

**异常：`YCX_FRH_UTIL`**

局部类内部的辅助方法需要以异常中止时，可以用 `ycx_frh_util=>raise_from_text( iv_text = '...'(mxx) )` 或 `ycx_frh_util=>raise_from_syst( )` 抛出，在调用处 `CATCH ycx_frh_util INTO DATA(lx_error)` 并交给日志或消息处理。简单的报表不需要使用。

## 二、程序结构

### 1. 输出表约定

- `lcl_report` 必须有一个 **PUBLIC** 实例属性 `gt_out`，类型为内表 `tt_out`。基类通过 RTTI 按名称查找该属性，名称或可见性不符时以 A 类消息终止。
- `ts_out` 的组件尽量参照 DDIC 字段（`TYPE 表-字段`），每个参照字段同行写中文注释。
- 需要行选择（勾选后执行操作）时，`ts_out` 第一个组件为 `mark TYPE c LENGTH 1`；需要状态灯时增加 `light TYPE c LENGTH 1`（取值 `'1'` 红、`'2'` 黄、`'3'` 绿），并在 `build_alv_grid_paras` 中设置 `ms_alv_grid_paras-layout-excp_fname = 'LIGHT'`。
- 有明细时，明细内表为 PUBLIC 属性 `gt_dtl`。

### 2. 代码顺序

```abap
*$-------------------------------------------------------------------$*
* Program Name    :   ZXXX                                            *
* Program Title   :   程序标题                                        *
* Application     :   MM                                              *
* Description     :   功能简述                                        *
* Author          :   （开发顾问填写）                                *
* Req Date        :   YYYY.MM.DD                                      *
*$-------------------------------------------------------------------$*
REPORT zxxx.

*--- 数据库表声明（选择条件参照） ---*
TABLES: ...

*--- 选择屏幕 ---*
SELECTION-SCREEN BEGIN OF BLOCK b10 WITH FRAME TITLE TEXT-b10.
  SELECT-OPTIONS s_werks  FOR t001w-werks.              " 工厂
  SELECT-OPTIONS s_werks1 FOR t001w-werks NO-DISPLAY.   " 工厂（权限校验后的影子）
SELECTION-SCREEN END OF BLOCK b10.

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

*--- 报表类实现 ---*
CLASS lcl_report IMPLEMENTATION.
  METHOD initialize.
    super->initialize( ).
    ...
  ENDMETHOD.
  ...
ENDCLASS.

*--- 程序事件 ---*
INITIALIZATION.
  DATA(go_report) = NEW lcl_report( ).
  go_report->initialize( ).

AT SELECTION-SCREEN OUTPUT.
  go_report->selscr_modify( ).

AT SELECTION-SCREEN.
  go_report->selscr_check( ).
  go_report->selscr_ucomm( ).

START-OF-SELECTION.
  go_report->run( ).
```

以上是结构示意，`...` 处在实际代码中必须写完整。

- **程序头**：第一行起是程序头注释块（程序名、标题、应用模块、简述、作者、需求日期），作者由开发顾问填写。
- **重定义 `initialize` 时先调用 `super->initialize( )`**。
- **值帮助**：需要自定义 F4 时，在类中定义 PUBLIC 方法，由 `AT SELECTION-SCREEN ON VALUE-REQUEST FOR 字段` 事件调用。
- **事件块只做调用**：`INITIALIZATION` 只允许创建对象和调用 `initialize( )`；其他事件块只调用对应方法。默认值、通配符等逻辑全部放进 `initialize`。
- 选择屏幕用 `SELECTION-SCREEN BEGIN OF BLOCK ... WITH FRAME TITLE TEXT-bxx` 分组。
- 选择条件参照的表在 `TABLES` 中显式声明。
- 全局只有选择屏幕、`TABLES` 和 `go_report`（在 `INITIALIZATION` 中内联声明），其他数据都是类的属性或方法内的局部变量。

### 3. 选择屏幕

- **默认值**：在 `initialize` 中赋值。给 `SELECT-OPTIONS` 设通配符默认值时填充 `sign = 'I'`、`option = 'CP'`。
- **校验**：`selscr_check` 只做逻辑防呆：联动必填、日期区间合理性、互斥条件。不为校验输入值是否存在而查询配置表。
- `selscr_check` 开头写 `CHECK sy-ucomm NP 'FC*'.`，选择屏幕功能键（FC01～FC05）不触发校验。
- 校验失败用 `MESSAGE '...'(mxx) TYPE 'E'.`，停留在选择屏幕。

## 三、取数与加工

- `prepare` 读取 TVARVC 参数等取数前准备。
- `select` 负责取数，**关联、过滤、汇总和计算全部在 SQL 中完成，下推到 HANA**（通用规范第十部分第 3 条），结果直接放入 `gt_out`。范例中的未清数量就是在 SQL 中用 `CASE` 表达式算出的。
- `process` 只做数据库确实无法完成的加工（如依赖选择屏幕开关的过滤、调用函数取得的值、状态灯）。不得在 `process` 的 `LOOP` 中做本可在 SQL 中完成的算术。
- 选择条件需要权限过滤的，查询只绑定影子范围表 `s_xxx1`，不绑定原选择条件（第四部分）。
- 拆分复杂逻辑时用 `select1`、`select2`、`process1` 等私有方法，在 `PRIVATE SECTION` 中声明，配中文注释。
- 取数后没有数据时：`MESSAGE '未找到符合条件的数据'(mxx) TYPE 'S'.` 后 `LEAVE LIST-PROCESSING.`，回到选择屏幕，不显示空清单。
- 数据量大时，用 `set_progress( )` 提示进度。

## 四、权限检查（SRI 影子范围协议）

只针对 `SELECT-OPTIONS`：

1. **影子范围表**：每个需要权限检查的选择条件 `s_xxx`，紧跟其后定义一个同参照、后缀为 `1` 的不显示范围表 `s_xxx1`（`NO-DISPLAY`）。不得使用 `gr_xxx` 等其他命名。
2. **检查方法**：在重定义的 `selscr_check` 中调用基类工具，不手写 `AUTHORITY-CHECK` 循环。参数与行为见第一部分第 5 节：

   ```abap
   *--- 工厂权限：只保留用户有权限的工厂 ---*
   me->get_util_auth( )->check_authority(
     EXPORTING
       it_sel_opt     = s_werks[]
       iv_auth_object = 'M_BANF_WRK'
       iv_auth_field  = 'WERKS'
     CHANGING
       ct_sel_opt     = s_werks1[] ).                 " 查询条件 S_WERKS 的影子
   ```

   不写 `EXCEPTIONS`：`check_authority` 以 `MESSAGE ... RAISING check_failed` 报错，调用方不处理该异常时，消息作为 E 类消息发出，用户停留在选择屏幕。

3. **隔离**：所有 SELECT 只绑定影子范围表（`IN @s_werks1`），不绑定原选择条件。
4. 权限对象和字段先用 SAP 工具核实，写入开发方案 2.3 节。
5. **单值参数**（`PARAMETERS`）：同样在 `selscr_check` 中调用 `check_authority`，传 `iv_parameter = p_bukrs`，不需要影子变量。
6. **操作权限**（按行、按单据的修改、审批）：在处理时逐对象用 `AUTHORITY-CHECK` 检查，活动按操作确定；无权限的对象记为失败并写入日志，不中断其他对象。

## 五、ALV 输出

- **字段目录逐项填充**：在 `build_alv_grid_fcat` 中用 `ct_fcat = VALUE #( ( ... ) ( ... ) )` 重建整个字段目录，按显示顺序**逐列列出要显示的字段**，不依赖基类自动生成的目录。不在目录中的 `gt_out` 字段（如 `mark`、只用于计算的字段）不显示。不用宏。
- **每列的写法**：`fieldname` 加 `ref_table`；内表字段名与参照字段名不同时再加 `ref_field`（如 `lifnr_name` 参照 `LFA1-NAME1`）。
- **列标题**：参照字段的 DDIC 标题不达意或会与其他列重复时（如两列都参照 `NAME1`、计算列参照 `MENGE`），用 `coltext = '...'(fxx)` 覆盖。
- **数量与金额**：设置 `qfieldname` / `cfieldname` 绑定单位与币种字段；不同单位不能合计时不设 `do_sum`。
- **表头**：重定义 `on_grid_top_of_page`，组装 `slis_t_listheader` 后调用 `REUSE_ALV_COMMENTARY_WRITE`。
- **热点与跳转**：在字段目录中设 `hotspot = abap_true`，重定义 `on_grid_hotspot_click`，用 `call_transaction( )` 跳转。
- **双击**：重定义 `on_grid_double_click`，用 `READ TABLE gt_out INTO DATA(ls_out) INDEX e_row-index` 取行；`e_row-rowtype` 不为空表示合计行，直接返回。显示单据优先用标准的显示函数（如采购凭证 `ME_DISPLAY_PURCHASE_DOCUMENT`），调用前查签名；失败时 `MESSAGE ... TYPE 'S' DISPLAY LIKE 'E'`。
- **默认排序**：在 `build_alv_grid_paras` 中设置 `me->ms_alv_grid_paras-sort`。
- 布局、斑马线、变式等已由基类处理，不要重复设置。

## 六、可编辑 ALV 与写回（功能类）

- **可编辑栏位**：在 `build_alv_grid_fcat` 中设置 `edit = abap_true`。
- **录入校验**：重定义 `on_grid_data_changed`，用 `er_data_changed` 逐单元格校验并添加错误协议。
- **按钮**：放在程序自己的 GUI 状态中。重定义 `on_grid_pf_status_set`，按当前状态把不可用的功能码追加到 `ct_extab`，然后 `SET PF-STATUS 'STANDARD_FULLSCREEN' EXCLUDING ct_extab.`；在 `on_grid_user_command` 中按 `e_ucomm` 分派到各处理方法。GUI 状态 `STANDARD_FULLSCREEN` 由开发顾问从程序 `SAPLKKBL` 复制后增加功能码，功能码、图标与文本列入开发方案 3.4 节。
- **处理前**：调用 `mo_alv_grid->check_changed_data( )` 取得最新录入；确认勾选行（`mark = abap_true`）；无勾选时给出提示。
- **处理单位**：按开发方案 1.5 节归集（按行或按单据）。
- **提交与回滚**：调用 BAPI 后检查 `RETURN` 中的 E/A 消息；成功则 `BAPI_TRANSACTION_COMMIT`（`wait = abap_true`），失败则 `BAPI_TRANSACTION_ROLLBACK`。按开发方案确定是逐对象提交还是整体提交，单个对象失败不影响其他对象（逐对象提交时）。
- **逐对象结果**：每行记录处理结果（状态灯 `light` 与结果消息字段）；BAPI 返回消息用 `get_util_logger( )->add_from_bapitab( )` 收集；处理结束汇总成功、失败数量，并用 `get_util_logger( )->display( )` 显示本次消息。
- **锁**：直接更新或需要防并发时，先调用对应的锁对象函数（`ENQUEUE_*`），失败时记为该对象失败。BAPI 自带锁的不重复加锁。
- **刷新**：处理后按开发方案的规则更新 `gt_out` 中对应行，重定义 `refresh_ui`，在其中调用 `mo_alv_grid->refresh_table_display( is_stable = VALUE #( row = abap_true col = abap_true ) )`，保持滚动位置；需要整体重新取数时调用 `restart( )`。

## 七、开发方案的手工步骤

- **3.1 程序属性**：类型“可执行程序”；标题；状态、应用、包由开发顾问按项目规范填写。
- **3.2 文本元素**：代码中全部文本符号（`bxx` 块标题、`fxx` 字段目录、`mxx` 消息、`cxx` 其他），编号与代码一致。
- **3.3 选择文本**：只列没有 DDIC 参照的参数和选择条件；参照 DDIC 字段的由基类自动处理，写“其余由基类按 DDIC 自动生成”。
- **3.4 其他对象**：事务码（开发清单登记了事务码时）、需要新建的 DDIC 对象、框架部署（第一部分）。

## 八、自查补充

在系统指令第十二部分的自查表之外，逐项确认：

| 检查项   | 达标                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基类对齐 | 重定义的方法都在框架接口中存在，可见性与签名一致；没有重定义未用的方法                                                                                          |
| 输出表   | `gt_out` 为 PUBLIC 内表属性；需要勾选时有 `mark`                                                                                                                |
| 事件块   | `INITIALIZATION` 只有创建对象和 `initialize( )`；默认值都在 `initialize` 中                                                                                     |
| SRI      | 每个需权限检查的 `s_xxx` 都有 `s_xxx1`，用 `get_util_auth( )->check_authority`，`iv_auth_field` 是业务字段（如 `EKORG`）而不是 `ACTVT`；SELECT 只绑定影子范围表 |
| 计算下推 | 计算列在 SQL 中用表达式算出，`process` 中没有可下推的算术                                                                                                       |
| 字段目录 | 在 `build_alv_grid_fcat` 中逐项填充全部显示列；每列有 `ref_table`，重名或不达意的列有 `coltext` 文本符号；无宏                                                  |
| 写回     | 勾选检查、`check_changed_data`、提交回滚、逐行结果、刷新都已实现                                                                                                |

## 九、完整范例

本规范之后附有一个完整的报表范例（采购订单执行情况清单），展示程序头、选择屏幕与影子范围表、SRI 权限检查、类定义、CTE 汇总与 SQL 计算、逐项填充的字段目录、默认排序、双击跳转和程序事件的写法。生成代码时参照它的结构与风格，业务内容以开发方案为准。
