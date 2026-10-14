class YCL_FRH_REPORT definition
  public
  create public .

public section.

  types:
    BEGIN OF ts_alv_grid_paras,
        title             TYPE sy-title,
        structure_name    TYPE dd02l-tabname,
        variant           TYPE disvariant,
        save              TYPE char01,
        default           TYPE char01,

        layout            TYPE lvc_s_layo,
        print             TYPE lvc_s_prnt,
        special_groups    TYPE lvc_t_sgrp,
        toolbar_excluding TYPE ui_functions,
        hyperlink         TYPE lvc_t_hype,
        except_qinfo      TYPE lvc_t_qinf,

        fieldcatalog      TYPE lvc_t_fcat,
        excluding         TYPE slis_t_extab,
        sort              TYPE lvc_t_sort,
        filter            TYPE lvc_t_filt,
      END OF ts_alv_grid_paras .

  methods CONSTRUCTOR .
  methods RUN
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods RESTART
    importing
      value(IV_REPORT) type SY-REPID default SY-REPID
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods ON_GRID_TOOLBAR
    importing
      !E_OBJECT type ref to CL_ALV_EVENT_TOOLBAR_SET .
  methods ON_GRID_PF_STATUS_SET
    changing
      !CT_EXTAB type SLIS_T_EXTAB .
  methods ON_GRID_TOP_OF_PAGE .
  methods ON_GRID_USER_COMMAND
    importing
      !E_UCOMM type SY-UCOMM .
  methods ON_GRID_DOUBLE_CLICK
    for event DOUBLE_CLICK of CL_GUI_ALV_GRID
    importing
      !E_ROW
      !E_COLUMN
      !ES_ROW_NO .
  methods ON_GRID_HOTSPOT_CLICK
    for event HOTSPOT_CLICK of CL_GUI_ALV_GRID
    importing
      !E_ROW_ID
      !E_COLUMN_ID
      !ES_ROW_NO .
  methods ON_GRID_DATA_CHANGED
    for event DATA_CHANGED of CL_GUI_ALV_GRID
    importing
      !ER_DATA_CHANGED
      !E_ONF4
      !E_ONF4_BEFORE
      !E_ONF4_AFTER
      !E_UCOMM .
  methods ON_GRID_DATA_CHANGED_FINISHED
    for event DATA_CHANGED_FINISHED of CL_GUI_ALV_GRID
    importing
      !E_MODIFIED
      !ET_GOOD_CELLS .
  methods SET_PROGRESS
    importing
      !IV_TEXT type CLIKE optional
      !IV_PERC type I optional
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods CALL_TRANSACTION
    importing
      value(IV_TCODE) type SY-TCODE
      value(IV_SKIP_SCREEN) type SY-FTYPE default ''
      value(IT_SPAGPA) type RFC_T_SPAGPA optional
    returning
      value(RV_SUBRC) type SY-SUBRC .
  methods SELSCR_MODIFY
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods SELSCR_CHECK
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods SELSCR_UCOMM
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods INITIALIZE
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods RENDER_UI
    importing
      !IV_REPID type SY-REPID default 'SAPLYREP'
      !IV_DYNNR type SY-DYNNR default '2000'
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods FREE_UI
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods REFRESH_UI
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods SET_LEFT_WIDTH
    importing
      !IV_WIDTH type I
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods GET_LEFT_WIDTH
    returning
      value(RV_RESULT) type I .
  methods RENDER_LEFT
    importing
      !IO_CONTAINER type ref to CL_GUI_CONTAINER .
  methods DISPATCH_UCOMM
    changing
      !CV_UCOMM type SY-UCOMM optional
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods GET_UTIL_LOGGER
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods GET_UTIL_TVARVC
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_TVARVC .
  methods GET_UTIL_AUTH
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_AUTH .
  methods GET_OBJECT_DESCR
    returning
      value(RO_RESULT) type ref to CL_ABAP_OBJECTDESCR .
  methods SET_GLOBALS_FROM_SLVC_FULLSCR
    importing
      !IO_ALV_GRID type ref to CL_GUI_ALV_GRID .
  methods GET_ALV_GRID_PARAS
    returning
      value(RS_PARAS) type TS_ALV_GRID_PARAS .
  methods SET_ALV_GRID_PARAS
    importing
      !IS_PARAS type TS_ALV_GRID_PARAS
    returning
      value(RO_ME) type ref to YCL_FRH_REPORT .
  methods GET_OUTTAB_REF
    returning
      value(RR_RESULT) type ref to DATA .
  methods SET_OUTTAB_REF
    importing
      !IT_OUTTAB_REF type ref to DATA optional .
  PROTECTED SECTION.

    DATA mt_outtab TYPE REF TO data .
    DATA mo_alv_grid TYPE REF TO cl_gui_alv_grid .
    DATA mo_object_descr TYPE REF TO cl_abap_objectdescr .
    DATA ms_alv_grid_paras TYPE ts_alv_grid_paras .
    DATA mo_container_left TYPE REF TO cl_gui_container .
    DATA mv_dummy TYPE bapi_msg .
    DATA mv_width_left TYPE i VALUE 0 ##NO_TEXT.       " 左侧宽度
    DATA mo_util_logger TYPE REF TO ycl_frh_util_logger .
    DATA mo_util_tvarvc TYPE REF TO ycl_frh_util_tvarvc .
    DATA mo_util_auth TYPE REF TO ycl_frh_util_auth .

    METHODS prepare
      RETURNING
        VALUE(ro_me) TYPE REF TO ycl_frh_report .
    METHODS select
      RETURNING
        VALUE(ro_me) TYPE REF TO ycl_frh_report .
    METHODS process
      RETURNING
        VALUE(ro_me) TYPE REF TO ycl_frh_report .
    METHODS display
      RETURNING
        VALUE(ro_me) TYPE REF TO ycl_frh_report .
    METHODS build_alv_grid_fcat
      CHANGING
        !ct_fcat     TYPE lvc_t_fcat
      RETURNING
        VALUE(ro_me) TYPE REF TO ycl_frh_report .
    METHODS build_alv_grid_paras
      RETURNING
        VALUE(ro_me) TYPE REF TO ycl_frh_report .
    METHODS ref_fcat
      IMPORTING
        VALUE(iv_fieldname) TYPE lvc_fname
      RETURNING
        VALUE(rr_fcat)      TYPE REF TO lvc_s_fcat .
private section.

  methods SET_SELSCR_TEXTS .
  methods BUILD_ALV_GRID_FCAT_INT .
  methods CHECK_ALV_GRID_FCAT_INT .
  methods BUILD_ALV_GRID_PARAS_INT .
ENDCLASS.



CLASS YCL_FRH_REPORT IMPLEMENTATION.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Protected Method YCL_FRH_REPORT->BUILD_ALV_GRID_FCAT
* +-------------------------------------------------------------------------------------------------+
* | [<-->] CT_FCAT                        TYPE        LVC_T_FCAT
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD build_alv_grid_fcat.
    ro_me = me.

*&---------------------------------------------------------------------*
*&      示例代码，请拷贝粘贴
*&---------------------------------------------------------------------*
**    1. 点射微调：利用 7.40 表表达式作为左值，大道至简！
**    (注意：如果字段名拼错会触发快速失败 Dump，严格保证代码质量)
*    ct_fcat[ fieldname = 'MATNR' ]-scrtext_l = '核心物料'.
*    ct_fcat[ fieldname = 'MATNR' ]-hotspot   = abap_true.
*    ct_fcat[ fieldname = 'MATNR' ]-just      = 'C'. " 居中对齐
*
**    2. 块级修改：使用 Field Symbol 复用指针，极致性能！
*    ASSIGN ct_fcat[ fieldname = 'WRBTR' ] TO FIELD-SYMBOL(<ls_fcat>).
*    IF sy-subrc = 0.
*      <ls_fcat>-do_sum     = abap_true. " 开启合计
*      <ls_fcat>-edit       = abap_true. " 开启编辑模式
*      <ls_fcat>-cfieldname = 'WAERS'.   " 绑定货币参考字段
*    ENDIF.
*
**    3. 批量隐藏：使用高阶 MODIFY 语法
*    MODIFY ct_fcat FROM VALUE #( no_out = abap_true )
*      TRANSPORTING no_out
*      WHERE fieldname CP 'MARK'.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_REPORT->BUILD_ALV_GRID_FCAT_INT
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD build_alv_grid_fcat_int.
    DATA lo_salv TYPE REF TO cl_salv_table.
    FIELD-SYMBOLS <lt_outtab> TYPE ANY TABLE.

    ASSIGN me->mt_outtab->* TO <lt_outtab>.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    TRY.
        cl_salv_table=>factory(
          IMPORTING
            r_salv_table = lo_salv
          CHANGING
            t_table      = <lt_outtab> ).

*        利用隐藏的标准元数据控制类，直接将 SALV 的列转换为 LVC 格式
        ms_alv_grid_paras-fieldcatalog = cl_salv_controller_metadata=>get_lvc_fieldcatalog(
          r_columns      = lo_salv->get_columns( )
          r_aggregations = lo_salv->get_aggregations( ) ).

      CATCH cx_salv_msg.
        RETURN.
    ENDTRY.

*    默认不显示零
    MODIFY ms_alv_grid_paras-fieldcatalog
      FROM VALUE #( no_zero = 'X' )
      TRANSPORTING no_zero
      WHERE no_zero = space.

*    处理一些技术性字段
    MODIFY ms_alv_grid_paras-fieldcatalog
      FROM VALUE #( tech = abap_true )
      TRANSPORTING tech
      WHERE fieldname = 'MARK'
         OR fieldname = 'LIGHT'.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Protected Method YCL_FRH_REPORT->BUILD_ALV_GRID_PARAS
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD build_alv_grid_paras.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->CALL_TRANSACTION
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_TCODE                       TYPE        SY-TCODE
* | [--->] IV_SKIP_SCREEN                 TYPE        SY-FTYPE (default ='')
* | [--->] IT_SPAGPA                      TYPE        RFC_T_SPAGPA(optional)
* | [<-()] RV_SUBRC                       TYPE        SY-SUBRC
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD call_transaction.
    CALL FUNCTION 'ABAP4_CALL_TRANSACTION'
      EXPORTING
        tcode                   = iv_tcode
        skip_screen             = iv_skip_screen
      IMPORTING
        subrc                   = rv_subrc
      TABLES
        spagpa_tab              = it_spagpa
      EXCEPTIONS
        call_transaction_denied = 1
        tcode_invalid           = 2
        OTHERS                  = 3
        ##SUBRC_OK.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_REPORT->CHECK_ALV_GRID_FCAT_INT
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD check_alv_grid_fcat_int.
    DATA ls_outtab TYPE REF TO data.

    FIELD-SYMBOLS <lt_outtab> TYPE ANY TABLE.
    FIELD-SYMBOLS <ls_outtab> TYPE any.

    ASSIGN mt_outtab->* TO <lt_outtab>.
    CREATE DATA ls_outtab LIKE LINE OF <lt_outtab>.
    ASSIGN ls_outtab->* TO <ls_outtab>.

    LOOP AT me->ms_alv_grid_paras-fieldcatalog ASSIGNING FIELD-SYMBOL(<ls_fcat>).
      ASSIGN COMPONENT <ls_fcat>-fieldname OF STRUCTURE <ls_outtab> TO FIELD-SYMBOL(<lv_field_value>).
      IF sy-subrc <> 0.
*        暴力提示A类型的错误，在开发测试过程中暴露低级错误
*        无效字段名 &1
        MESSAGE a008 WITH <ls_fcat>-fieldname.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->CONSTRUCTOR
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD constructor.
*$--------------------------------------------$*
*$  获取当前实例的对象描述
*$--------------------------------------------$*
    mo_object_descr = CAST cl_abap_objectdescr(
        cl_abap_typedescr=>describe_by_object_ref( me ) ).


*$--------------------------------------------$*
*$  动态注入选择屏幕动态文本
*$--------------------------------------------$*
    me->set_selscr_texts( ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->DISPATCH_UCOMM
* +-------------------------------------------------------------------------------------------------+
* | [<-->] CV_UCOMM                       TYPE        SY-UCOMM(optional)
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD dispatch_ucomm.
    ro_me = me.

    IF mo_alv_grid IS BOUND.
      mo_alv_grid->set_function_code( CHANGING c_ucomm = cv_ucomm ).
      cl_gui_cfw=>dispatch( ).
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Protected Method YCL_FRH_REPORT->DISPLAY
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD display.
    ro_me = me.

*    此处待细化...
    IF sy-batch IS NOT INITIAL.
      RETURN.
    ENDIF.

*$--------------------------------------------$*
*$  静默将父类OUTTAB关联到子类的属性GT_OUT!
*$--------------------------------------------$*
    me->set_outtab_ref( ).

*$--------------------------------------------$*
*$  构建ALV参数
*$--------------------------------------------$*
    me->build_alv_grid_fcat_int( ).
    me->build_alv_grid_fcat( CHANGING ct_fcat = me->ms_alv_grid_paras-fieldcatalog ).

    me->build_alv_grid_paras_int( ).
    me->build_alv_grid_paras( ).

*    检查ALV字段目录
    me->check_alv_grid_fcat_int( ).


**$--------------------------------------------$*
**$  调用ALV显示清单
**$--------------------------------------------$*
    DATA(lo_report) = me.
    CALL FUNCTION 'YALV_DISPLAY_ALV_GRID'
      CHANGING
        co_report = lo_report.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->FREE_UI
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD free_ui.
    ro_me = me.

*    释放左侧容器
    IF mo_container_left IS BOUND.
      mo_container_left->free(
        EXCEPTIONS
          cntl_error        = 1
          cntl_system_error = 2
          OTHERS            = 3 ).
      FREE mo_container_left.
    ENDIF.

    cl_gui_cfw=>flush(
      EXCEPTIONS
        cntl_error        = 1
        cntl_system_error = 2
        OTHERS            = 3 ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->GET_ALV_GRID_PARAS
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RS_PARAS                       TYPE        TS_ALV_GRID_PARAS
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_alv_grid_paras.
    rs_paras = ms_alv_grid_paras.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->GET_LEFT_WIDTH
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RV_RESULT                      TYPE        I
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_left_width.
    rv_result = mv_width_left.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->GET_OBJECT_DESCR
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_RESULT                      TYPE REF TO CL_ABAP_OBJECTDESCR
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_object_descr.
    ro_result = mo_object_descr.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->GET_OUTTAB_REF
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RR_RESULT                      TYPE REF TO DATA
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_outtab_ref.
    rr_result = mt_outtab.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->GET_UTIL_AUTH
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_AUTH
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_util_auth.
    IF mo_util_auth IS INITIAL.
      mo_util_auth = NEW #( ).
    ENDIF.

    ro_result = mo_util_auth.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->GET_UTIL_LOGGER
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_util_logger.
    IF mo_util_logger IS INITIAL.
      mo_util_logger = NEW #( ).
    ENDIF.

    ro_result = mo_util_logger.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->GET_UTIL_TVARVC
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_TVARVC
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_util_tvarvc.
    IF mo_util_tvarvc IS NOT BOUND.
      mo_util_tvarvc = NEW #( get_util_logger( ) ).
    ENDIF.

    ro_result = mo_util_tvarvc.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->INITIALIZE
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD initialize.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_DATA_CHANGED
* +-------------------------------------------------------------------------------------------------+
* | [--->] ER_DATA_CHANGED                LIKE
* | [--->] E_ONF4                         LIKE
* | [--->] E_ONF4_BEFORE                  LIKE
* | [--->] E_ONF4_AFTER                   LIKE
* | [--->] E_UCOMM                        LIKE
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD on_grid_data_changed.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_DATA_CHANGED_FINISHED
* +-------------------------------------------------------------------------------------------------+
* | [--->] E_MODIFIED                     LIKE
* | [--->] ET_GOOD_CELLS                  LIKE
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD on_grid_data_changed_finished.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_DOUBLE_CLICK
* +-------------------------------------------------------------------------------------------------+
* | [--->] E_ROW                          LIKE
* | [--->] E_COLUMN                       LIKE
* | [--->] ES_ROW_NO                      LIKE
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD on_grid_double_click.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_PF_STATUS_SET
* +-------------------------------------------------------------------------------------------------+
* | [<-->] CT_EXTAB                       TYPE        SLIS_T_EXTAB
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD on_grid_pf_status_set.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_TOOLBAR
* +-------------------------------------------------------------------------------------------------+
* | [--->] E_OBJECT                       TYPE REF TO CL_ALV_EVENT_TOOLBAR_SET
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD on_grid_toolbar.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_TOP_OF_PAGE
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD on_grid_top_of_page.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_USER_COMMAND
* +-------------------------------------------------------------------------------------------------+
* | [--->] E_UCOMM                        TYPE        SY-UCOMM
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD on_grid_user_command.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Protected Method YCL_FRH_REPORT->PREPARE
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD prepare.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Protected Method YCL_FRH_REPORT->PROCESS
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD process.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->REFRESH_UI
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD refresh_ui.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Protected Method YCL_FRH_REPORT->REF_FCAT
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_FIELDNAME                   TYPE        LVC_FNAME
* | [<-()] RR_FCAT                        TYPE REF TO LVC_S_FCAT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD ref_fcat.
    TRY.
        " 极客内存直击：直接拉取内表中该行的真实内存地址
        rr_fcat = REF #( ms_alv_grid_paras-fieldcatalog[ fieldname = to_upper( iv_fieldname ) ] ).

      CATCH cx_sy_itab_line_not_found.
*        无效的字段名必须触发严厉的A类型错误，从而使得可以在开发系统就发现问题！
        MESSAGE a008 WITH iv_fieldname.
    ENDTRY.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->RENDER_LEFT
* +-------------------------------------------------------------------------------------------------+
* | [--->] IO_CONTAINER                   TYPE REF TO CL_GUI_CONTAINER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD render_left.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->RENDER_UI
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_REPID                       TYPE        SY-REPID (default ='SAPLYREP')
* | [--->] IV_DYNNR                       TYPE        SY-DYNNR (default ='2000')
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD render_ui.
    ro_me = me.

*$--------------------------------------------$*
*$  渲染左边的容器
*$--------------------------------------------$*
*    在功能模块REUSE_ALV_GRID_DISPLAY_LVC的输出屏幕（SAPLSLVC_FULLSCREEN/0500）
*    中创建一个Docking Container
    IF mv_width_left > 0
      AND me->mo_container_left IS NOT BOUND
      AND line_exists( mo_object_descr->methods[ name = 'RENDER_LEFT' is_redefined = abap_true ] ).
      me->mo_container_left ?= NEW
        cl_gui_docking_container( repid     = 'SAPLSLVC_FULLSCREEN'
                                  dynnr     = '0500'
                                  side      = cl_gui_docking_container=>dock_at_left
                                  extension = mv_width_left ).
      me->render_left( me->mo_container_left ).
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->RESTART
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_REPORT                      TYPE        SY-REPID (default =SY-REPID)
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD restart.
    ro_me = me.

    DATA lt_rspara TYPE TABLE OF rsparams WITH EMPTY KEY.

*    释放UI资源
    me->free_ui( ).

    CALL FUNCTION 'RS_REFRESH_FROM_SELECTOPTIONS'
      EXPORTING
        curr_report     = iv_report
      TABLES
        selection_table = lt_rspara
      EXCEPTIONS
        not_found       = 1
        no_report       = 2
        OTHERS          = 3
        ##SUBRC_OK.

    SUBMIT (iv_report) VIA SELECTION-SCREEN
      WITH SELECTION-TABLE lt_rspara.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->RUN
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD run.
    ro_me = me.

    me->get_util_logger( )->clear( ).

    me->prepare( ).
    me->select( ).
    me->process( ).
    me->display( ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Protected Method YCL_FRH_REPORT->SELECT
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD select.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SELSCR_CHECK
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD selscr_check.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SELSCR_MODIFY
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD selscr_modify.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SELSCR_UCOMM
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD selscr_ucomm.
    ro_me = me.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SET_ALV_GRID_PARAS
* +-------------------------------------------------------------------------------------------------+
* | [--->] IS_PARAS                       TYPE        TS_ALV_GRID_PARAS
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD set_alv_grid_paras.
    ms_alv_grid_paras = is_paras.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SET_GLOBALS_FROM_SLVC_FULLSCR
* +-------------------------------------------------------------------------------------------------+
* | [--->] IO_ALV_GRID                    TYPE REF TO CL_GUI_ALV_GRID
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD set_globals_from_slvc_fullscr.
    mo_alv_grid = io_alv_grid.

*    注册事件
    LOOP AT me->mo_object_descr->methods ASSIGNING FIELD-SYMBOL(<ls_method>)
      WHERE of_class      = 'CL_GUI_ALV_GRID'
        AND is_redefined = abap_true.
      CASE <ls_method>-name.
        WHEN 'ON_GRID_DOUBLE_CLICK'.
          SET HANDLER me->on_grid_double_click FOR mo_alv_grid.

        WHEN 'ON_GRID_HOTSPOT_CLICK'.
          SET HANDLER me->on_grid_hotspot_click FOR mo_alv_grid.

        WHEN 'ON_GRID_DATA_CHANGED'.
          SET HANDLER me->on_grid_data_changed FOR mo_alv_grid.

        WHEN 'ON_GRID_DATA_CHANGED_FINISHED'.
          SET HANDLER me->on_grid_data_changed_finished FOR mo_alv_grid.
      ENDCASE.
    ENDLOOP.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SET_LEFT_WIDTH
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_WIDTH                       TYPE        I
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD set_left_width.
    ro_me = me.

    me->mv_width_left = iv_width.

*    IF MO_
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SET_OUTTAB_REF
* +-------------------------------------------------------------------------------------------------+
* | [--->] IT_OUTTAB_REF                  TYPE REF TO DATA(optional)
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD set_outtab_ref.
    IF it_outtab_ref IS SUPPLIED.

      mt_outtab = it_outtab_ref.
      RETURN.
    ENDIF.


*    约定大于配置，每个报表必须有一个名为“GT_OUT”的内表用于输出
    DATA(lv_attr_name) = 'GT_OUT'.

*    获取子类的运行时类型信息 (RTTI)
    DATA(lo_objectdescr) = CAST cl_abap_objectdescr( cl_abap_typedescr=>describe_by_object_ref( me ) ).

*    检查是否存在公共属性 GT_OUT
    IF NOT line_exists( lo_objectdescr->attributes[ name       = lv_attr_name
                                                    visibility = cl_abap_objectdescr=>public ] ).
*      子类 lcl_report 缺失重要公共内表属性 gt_out
      MESSAGE a007.
    ENDIF.

*    判断属性GT_OUT是否是一个内表
    IF lo_objectdescr->get_attribute_type( p_name = lv_attr_name )->type_kind <> cl_abap_typedescr=>typekind_table.
*      子类 lcl_report 缺失重要公共内表属性 gt_out
      MESSAGE a007.
    ENDIF.

    FIELD-SYMBOLS <lt_outtab> TYPE ANY TABLE.
    ASSIGN me->(lv_attr_name) TO <lt_outtab>.

    mt_outtab = REF #( <lt_outtab> ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->SET_PROGRESS
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_TEXT                        TYPE        CLIKE(optional)
* | [--->] IV_PERC                        TYPE        I(optional)
* | [<-()] RO_ME                          TYPE REF TO YCL_FRH_REPORT
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD set_progress.
    ro_me = me.

    IF sy-batch IS INITIAL.
      CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
        EXPORTING
          percentage = iv_perc
          text       = iv_text.
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_REPORT->SET_SELSCR_TEXTS
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD set_selscr_texts.
    DATA lt_sscr TYPE STANDARD TABLE OF rsscr.

    " 1. 获取调用主程序（AI生成的Report）的选择屏幕底层元数据
    " 这里必须使用 sy-cprog 而不是 sy-repid，确保获取的是主程序的屏幕信息
    LOAD REPORT sy-cprog PART 'SSCR' INTO lt_sscr.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    " 2. 仅过滤带有数据字典参考(DBFIELD)的参数(P)或选择表(S)
    LOOP AT lt_sscr ASSIGNING FIELD-SYMBOL(<ls_sscr>)
      WHERE ( kind = 'S' OR
              kind = 'P' )
        AND dbfield IS NOT INITIAL.

      " 3. 动态组装跨程序访问的文本变量名
      " SAP标准的屏幕文本变量格式为：(%_NAME_%_APP_%-TEXT)
      DATA(lv_text_var) = |({ sy-cprog })%_{ <ls_sscr>-name }_%_APP_%-TEXT|.

      ASSIGN (lv_text_var) TO FIELD-SYMBOL(<lv_text>).
      IF sy-subrc = 0.
        " 为了防止误覆盖开发者手工精心维护的文本，仅在文本为空或等于变量名时处理
        IF <lv_text> IS INITIAL OR to_upper( <lv_text> ) = <ls_sscr>-name.
          TRY.
              " 4. 使用 RTTS 动态获取数据字典的描述
              DATA(lo_elem_descr) = CAST cl_abap_elemdescr( cl_abap_typedescr=>describe_by_name( <ls_sscr>-dbfield ) ).
              DATA(ls_ddic)       = lo_elem_descr->get_ddic_field( sy-langu ).

              " 按照中文字段、长字段、短字段、底层描述的优先级取值
              DATA(lv_ddic_text) = COND #(
                WHEN ls_ddic-scrtext_m IS NOT INITIAL THEN ls_ddic-scrtext_m
                WHEN ls_ddic-scrtext_l IS NOT INITIAL THEN ls_ddic-scrtext_l
                WHEN ls_ddic-scrtext_s IS NOT INITIAL THEN ls_ddic-scrtext_s
                ELSE ls_ddic-fieldtext
              ).

              " 5. 运行时内存注入，界面即刻生效
              IF lv_ddic_text IS NOT INITIAL.
                <lv_text> = lv_ddic_text.
              ENDIF.

            CATCH cx_root.
              " 方案明确要求无DDIC参考或异常时不处理（兜底机制），直接跳过
              CONTINUE.
          ENDTRY.
        ENDIF.
      ENDIF.
    ENDLOOP.

  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_REPORT->BUILD_ALV_GRID_PARAS_INT
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD build_alv_grid_paras_int.

*$--------------------------------------------$*
*$  设置ALV参数
*$--------------------------------------------$*
*    报表标题
    IF me->ms_alv_grid_paras-title IS INITIAL.
      me->ms_alv_grid_paras-title = sy-title.
    ENDIF.


*$--------------------------------------------$*
*$  ALV变式
*$--------------------------------------------$*
    me->ms_alv_grid_paras-variant-report = sy-cprog.


*$--------------------------------------------$*
*$  ALV布局
*$--------------------------------------------$*
    me->ms_alv_grid_paras-title              = sy-title.
    me->ms_alv_grid_paras-layout-zebra       = abap_true.
    me->ms_alv_grid_paras-layout-cwidth_opt  = abap_false.
    me->ms_alv_grid_paras-layout-sel_mode    = 'A'.
    me->ms_alv_grid_paras-layout-box_fname   = 'MARK'.
    me->ms_alv_grid_paras-default            = abap_true.

*    动态检查变式保存权限，防止越权覆盖全局布局
    AUTHORITY-CHECK OBJECT 'S_ALV_LAYO'
      ID 'ACTVT' FIELD '23'.
    me->ms_alv_grid_paras-save = COND #( WHEN sy-subrc = 0 THEN 'A' ELSE 'U' ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_REPORT->ON_GRID_HOTSPOT_CLICK
* +-------------------------------------------------------------------------------------------------+
* | [--->] E_ROW_ID                       LIKE
* | [--->] E_COLUMN_ID                    LIKE
* | [--->] ES_ROW_NO                      LIKE
* +--------------------------------------------------------------------------------------</SIGNATURE>
  method ON_GRID_HOTSPOT_CLICK.
  endmethod.
ENDCLASS.