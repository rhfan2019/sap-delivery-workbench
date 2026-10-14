*$-------------------------------------------------------------------$*
* Program Name    :   YDEMO_FRH_0021                                  *
* Program Title   :   采购订单执行情况清单                            *
* Application     :   MM                                              *
* Description     :   采购订单行项目的订单量、收货量及未清数量        *
* Author          :   范瑞辉                                          *
* Req Date        :   2026.10.14                                      *
*$-------------------------------------------------------------------$*
REPORT ydemo_frh_0021.

*&---------------------------------------------------------------------*
*&      Tables
*&---------------------------------------------------------------------*
TABLES ekko.
TABLES ekpo.


*&---------------------------------------------------------------------*
*&      选择屏幕
*&---------------------------------------------------------------------*
SELECTION-SCREEN BEGIN OF BLOCK b10 WITH FRAME TITLE TEXT-b10.
  SELECT-OPTIONS s_ekorg  FOR ekko-ekorg.                " 采购组织
  SELECT-OPTIONS s_ekorg1 FOR ekko-ekorg NO-DISPLAY.     " 采购组织（仅权限校验）
  SELECT-OPTIONS s_bedat  FOR ekko-bedat.                " 凭证日期
  SELECT-OPTIONS s_lifnr FOR ekko-lifnr.                " 供应商
  SELECT-OPTIONS s_matnr FOR ekpo-matnr.                " 物料
  SELECT-OPTIONS s_werks FOR ekpo-werks.                " 工厂
SELECTION-SCREEN END OF BLOCK b10.

SELECTION-SCREEN BEGIN OF BLOCK b11 WITH FRAME TITLE TEXT-b11.
  PARAMETERS p_open AS CHECKBOX.                        " 仅显示未清
SELECTION-SCREEN END OF BLOCK b11.


*----------------------------------------------------------------------*
* 核心业务类定义
*----------------------------------------------------------------------*
CLASS lcl_report DEFINITION INHERITING FROM ycl_frh_report FINAL.
  PUBLIC SECTION.
    TYPES: BEGIN OF ts_out,
             mark       TYPE char01,          "ALV选择块
             ebeln      TYPE ekko-ebeln,      " 采购订单号
             ebelp      TYPE ekpo-ebelp,      " 行项目
             lifnr      TYPE ekko-lifnr,      " 供应商编码
             lifnr_name TYPE lfa1-name1,      " 供应商名称
             matnr      TYPE ekpo-matnr,      " 物料编码
             maktx      TYPE makt-maktx,      " 物料描述
             werks      TYPE ekpo-werks,      " 工厂
             werks_name TYPE t001w-name1,     " 工厂名称
             menge      TYPE ekpo-menge,      " 订单数量
             meins      TYPE ekpo-meins,      " 单位
             wemng      TYPE eket-wemng,      " 已收货数量（计划行汇总）
             open_qty   TYPE ekpo-menge,      " 还差多少（未清交货数量）
             bedat      TYPE ekko-bedat,      " 订单日期
             eindt      TYPE eket-eindt,      " 交货日期（首个计划行）
             elikz      TYPE ekpo-elikz,      " 交货已完成标识
           END   OF ts_out.
    TYPES: tt_out TYPE STANDARD TABLE OF ts_out WITH EMPTY KEY.

    DATA gt_out TYPE tt_out.

    METHODS selscr_check            REDEFINITION.

    METHODS on_grid_double_click    REDEFINITION.

  PROTECTED SECTION.
    METHODS select                  REDEFINITION.
    METHODS process                 REDEFINITION.
    METHODS build_alv_grid_fcat     REDEFINITION.
    METHODS build_alv_grid_paras    REDEFINITION.
ENDCLASS.


*----------------------------------------------------------------------*
* 核心业务类实现
*----------------------------------------------------------------------*
CLASS lcl_report IMPLEMENTATION.

  METHOD selscr_check.
    CHECK sy-ucomm NP 'FC*'.

*$--------------------------------------------$*
*$  检查必填项
*$--------------------------------------------$*
*    IF s_ekorg[] IS INITIAL OR s_bedat[] IS INITIAL.
**      请输入采购组织和凭证日期
*      MESSAGE '请输入采购组织和凭证日期'(m01) TYPE 'E'.
*    ENDIF.

*$--------------------------------------------$*
*$  检查采购组织的显示权限
*$--------------------------------------------$*
    me->get_util_auth( )->check_authority(
      EXPORTING
        it_sel_opt = s_ekorg[]
        iv_auth_object = 'M_BEST_EKO'
        iv_auth_field = 'EKORG'
        iv_actvt_value = '03'
      CHANGING
        ct_sel_opt = s_ekorg1[]
    ).
  ENDMETHOD.


*&---------------------------------------------------------------------*
*&      METHOD  select
*&---------------------------------------------------------------------*
*&      读取数据
*&---------------------------------------------------------------------*
  METHOD select.
*$--------------------------------------------$*
*$  (1). 按行项目汇总计划行：收货数量求和，交货日期取最早
*$  (2). 关联抬头、行项目、供应商、物料描述、工厂名称
*$--------------------------------------------$*
    WITH
      +item AS (
        SELECT FROM ekko
                 INNER JOIN ekpo ON ekpo~ebeln = ekko~ebeln
                 LEFT OUTER JOIN eket ON eket~ebeln = ekpo~ebeln
                                     AND eket~ebelp = ekpo~ebelp
          FIELDS
            ekpo~ebeln,
            ekpo~ebelp,
            SUM( eket~wemng ) AS wemng,
            MIN( eket~eindt ) AS eindt
          WHERE ekko~ekorg IN @s_ekorg1[]   "采购组织（使用权限检查的范围表影子）
            AND ekko~bedat IN @s_bedat[]
            AND ekko~lifnr IN @s_lifnr[]
            AND ekko~bstyp =  'F'          " 'F' = 采购订单
            AND ekko~loekz =  @space       " 抬头未删除
            AND ekpo~matnr IN @s_matnr[]
            AND ekpo~werks IN @s_werks[]
            AND ekpo~loekz =  @space       " 行项目未删除、未冻结
            AND ekpo~retpo <> 'X'          " 'X' = 退货项目
          GROUP BY ekpo~ebeln, ekpo~ebelp )

      SELECT FROM +item
               INNER JOIN ekko ON ekko~ebeln = +item~ebeln
               INNER JOIN ekpo ON ekpo~ebeln = +item~ebeln
                              AND ekpo~ebelp = +item~ebelp
               LEFT OUTER JOIN lfa1  ON lfa1~lifnr  = ekko~lifnr
               LEFT OUTER JOIN makt  ON makt~matnr  = ekpo~matnr
                                    AND makt~spras  = @sy-langu
               LEFT OUTER JOIN t001w ON t001w~werks = ekpo~werks
        FIELDS
          ekko~ebeln,
          ekpo~ebelp,
          ekko~lifnr,
          lfa1~name1  AS lifnr_name,
          ekpo~matnr,
          makt~maktx,
          ekpo~werks,
          t001w~name1 AS werks_name,
          ekpo~menge,
          ekpo~meins,
          +item~wemng,
          ekko~bedat,
          +item~eindt,
          ekpo~elikz,
          ( CASE WHEN ekpo~elikz = @abap_true THEN 0
                 WHEN +item~wemng > ekpo~menge THEN 0
                 ELSE ekpo~menge - +item~wemng END ) AS open_qty
        ORDER BY ekko~ebeln, ekpo~ebelp
        INTO CORRESPONDING FIELDS OF TABLE @gt_out.
  ENDMETHOD.


*&---------------------------------------------------------------------*
*&      METHOD  process
*&---------------------------------------------------------------------*
*&      按“仅显示未清”过滤；没有数据时回到选择屏幕
*&---------------------------------------------------------------------*
  METHOD process.
*    仅显示未清
    IF p_open = abap_true.
      DELETE gt_out WHERE open_qty = 0.
    ENDIF.

*$--------------------------------------------$*
*$  没有数据时停留在选择屏幕
*$--------------------------------------------$*
    IF gt_out IS INITIAL.
*      未找到符合条件的数据
      MESSAGE '未找到符合条件的数据'(m03) TYPE 'S'.
      LEAVE LIST-PROCESSING.
    ENDIF.
  ENDMETHOD.


  METHOD build_alv_grid_fcat.
    ct_fcat = VALUE #(
          ( fieldname = 'EBELN'      ref_table = 'EKKO' key = abap_true )
          ( fieldname = 'EBELP'      ref_table = 'EKPO' key = abap_true )
          ( fieldname = 'LIFNR'      ref_table = 'EKKO' )
          ( fieldname = 'LIFNR_NAME' ref_table = 'LFA1'  ref_field = 'NAME1'
                                     coltext = '供应商名称'(f01) )
          ( fieldname = 'MATNR'      ref_table = 'EKPO' )
          ( fieldname = 'MAKTX'      ref_table = 'MAKT' )
          ( fieldname = 'WERKS'      ref_table = 'EKPO' )
          ( fieldname = 'WERKS_NAME' ref_table = 'T001W' ref_field = 'NAME1'
                                     coltext = '工厂名称'(f02) )
          ( fieldname = 'MENGE'      ref_table = 'EKPO' qfieldname = 'MEINS' do_sum = abap_true )
          ( fieldname = 'MEINS'      ref_table = 'EKPO' )
          ( fieldname = 'WEMNG'      ref_table = 'EKET' qfieldname = 'MEINS' do_sum = abap_true )
          ( fieldname = 'OPEN_QTY'   ref_table = 'EKPO' ref_field = 'MENGE' qfieldname = 'MEINS' do_sum = abap_true
                                     coltext = '还差多少'(f03) )
          ( fieldname = 'BEDAT'      ref_table = 'EKKO'
                                     coltext = '订单日期'(f04) )
          ( fieldname = 'EINDT'      ref_table = 'EKET' ) ).
  ENDMETHOD.


  METHOD build_alv_grid_paras.
*    默认按采购订单号、行项目升序
    me->ms_alv_grid_paras-sort = VALUE #( ( spos = 1 fieldname = 'EBELN' up = abap_true )
                                          ( spos = 2 fieldname = 'EBELP' up = abap_true ) ).
  ENDMETHOD.


*&---------------------------------------------------------------------*
*&      METHOD  on_grid_double_click
*&---------------------------------------------------------------------*
*&      双击跳转ME23N，并定位到行项目
*&---------------------------------------------------------------------*
  METHOD on_grid_double_click.
    READ TABLE gt_out INTO DATA(ls_out) INDEX e_row-index.
    IF sy-subrc <> 0 OR e_row-rowtype IS NOT INITIAL.
      RETURN.
    ENDIF.

    CALL FUNCTION 'ME_DISPLAY_PURCHASE_DOCUMENT'
      EXPORTING
        i_ebeln = ls_out-ebeln
        i_ebelp = ls_out-ebelp
        i_enjoy = abap_true
      EXCEPTIONS
        OTHERS  = 1.
    IF sy-subrc <> 0.
      MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 DISPLAY LIKE 'E'.
    ENDIF.
  ENDMETHOD.

ENDCLASS.


*&---------------------------------------------------------------------*
*&      程序事件
*&---------------------------------------------------------------------*
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