CLASS ycl_frh_util_auth DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
    TYPE-POOLS abap .

    METHODS constructor .
    METHODS check_authority
      IMPORTING
        VALUE(iv_parameter)   TYPE any OPTIONAL
        VALUE(it_sel_opt)     TYPE STANDARD TABLE OPTIONAL
        VALUE(iv_auth_object) TYPE xuobject
        VALUE(iv_auth_field)  TYPE xufield
        VALUE(iv_actvt_field) TYPE xufield DEFAULT 'ACTVT'
        VALUE(iv_actvt_value) TYPE activ_auth DEFAULT '03'
        VALUE(iv_table_field) TYPE string OPTIONAL
      CHANGING
        !ct_sel_opt           TYPE STANDARD TABLE OPTIONAL
      EXCEPTIONS
        check_failed .
  PROTECTED SECTION.


  PRIVATE SECTION.

    METHODS check_authority_for_parameter
      IMPORTING
        VALUE(iv_parameter)   TYPE any OPTIONAL
        VALUE(iv_auth_object) TYPE xuobject
        VALUE(iv_auth_field)  TYPE xufield
        VALUE(iv_actvt_field) TYPE xufield DEFAULT 'ACTVT'
        VALUE(iv_actvt_value) TYPE activ_auth DEFAULT '03'
      EXCEPTIONS
        check_failed .
    METHODS check_authority_for_sel_opt
      IMPORTING
        VALUE(it_sel_opt)     TYPE STANDARD TABLE OPTIONAL
        VALUE(iv_auth_object) TYPE xuobject
        VALUE(iv_auth_field)  TYPE xufield
        VALUE(iv_actvt_field) TYPE xufield DEFAULT 'ACTVT'
        VALUE(iv_actvt_value) TYPE activ_auth DEFAULT '03'
        VALUE(iv_table_field) TYPE string
      CHANGING
        !ct_sel_opt           TYPE STANDARD TABLE OPTIONAL
      EXCEPTIONS
        check_failed .
    METHODS build_authority_where_clause
      IMPORTING
        VALUE(iv_auth_object)  TYPE xuobject
        VALUE(iv_auth_field)   TYPE xufield
        VALUE(iv_actvt_field)  TYPE xufield DEFAULT 'ACTVT'
        VALUE(iv_actvt_value)  TYPE activ_auth DEFAULT '03'
        VALUE(iv_tabname)      TYPE string OPTIONAL
        VALUE(iv_alias)        TYPE string OPTIONAL
        VALUE(iv_fieldname)    TYPE string
      RETURNING
        VALUE(rv_where_clause) TYPE string
      EXCEPTIONS
        check_failed .
    METHODS parse_authority_table_field
      IMPORTING
        VALUE(iv_auth_field)  TYPE xufield
        VALUE(iv_table_field) TYPE string
      EXPORTING
        !ev_tabname           TYPE string
        !ev_fieldname         TYPE string
      EXCEPTIONS
        check_failed .
ENDCLASS.



CLASS YCL_FRH_UTIL_AUTH IMPLEMENTATION.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_UTIL_AUTH->BUILD_AUTHORITY_WHERE_CLAUSE
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_AUTH_OBJECT                 TYPE        XUOBJECT
* | [--->] IV_AUTH_FIELD                  TYPE        XUFIELD
* | [--->] IV_ACTVT_FIELD                 TYPE        XUFIELD (default ='ACTVT')
* | [--->] IV_ACTVT_VALUE                 TYPE        ACTIV_AUTH (default ='03')
* | [--->] IV_TABNAME                     TYPE        STRING(optional)
* | [--->] IV_ALIAS                       TYPE        STRING(optional)
* | [--->] IV_FIELDNAME                   TYPE        STRING
* | [<-()] RV_WHERE_CLAUSE                TYPE        STRING
* | [EXC!] CHECK_FAILED
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD build_authority_where_clause.
    DATA(lo_converter_osql) = cl_auth_objects_to_sql=>create_for_open_sql( ).

    lo_converter_osql->add_authorization_object(
      EXPORTING
        iv_authorization_object = iv_auth_object
        it_activities           = VALUE #( ( auth_field = iv_actvt_field value = iv_actvt_value ) )
        it_field_mapping        = VALUE #( ( auth_field = iv_auth_field
                                             view_field = VALUE #( table_ddic_name = iv_tabname
                                                                   table_alias     = iv_alias
                                                                   field_name      = iv_fieldname ) ) )
    ).

    TRY.
        rv_where_clause = lo_converter_osql->get_sql_condition( ).
      CATCH cx_auth_not_authorized.
        " 在这里抛出 E 消息，阻断选择屏幕
        MESSAGE e003(00) WITH '无权访问对象' iv_auth_object RAISING check_failed.
    ENDTRY.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_AUTH->CHECK_AUTHORITY
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_PARAMETER                   TYPE        ANY(optional)
* | [--->] IT_SEL_OPT                     TYPE        STANDARD TABLE(optional)
* | [--->] IV_AUTH_OBJECT                 TYPE        XUOBJECT
* | [--->] IV_AUTH_FIELD                  TYPE        XUFIELD
* | [--->] IV_ACTVT_FIELD                 TYPE        XUFIELD (default ='ACTVT')
* | [--->] IV_ACTVT_VALUE                 TYPE        ACTIV_AUTH (default ='03')
* | [--->] IV_TABLE_FIELD                 TYPE        STRING(optional)
* | [<-->] CT_SEL_OPT                     TYPE        STANDARD TABLE(optional)
* | [EXC!] CHECK_FAILED
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD check_authority.

*$--------------------------------------------$*
*$  (1). 检查PARAMETER和SELECT-OPTIONS
*$--------------------------------------------$*
    IF iv_parameter IS NOT SUPPLIED AND it_sel_opt IS NOT SUPPLIED.
*      参数 IV_PARAMETER 和 IT_SEL_OPT 不能同时传入
      MESSAGE e002 RAISING check_failed.
    ENDIF.

    IF iv_parameter IS SUPPLIED AND it_sel_opt IS SUPPLIED.
*      参数 IV_PARAMETER 和 IT_SEL_OPT 必须传入一个
      MESSAGE e002 RAISING check_failed.
    ENDIF.

*$--------------------------------------------$*
*$  (2.1). 场景A：单值权限校验
*$--------------------------------------------$*
    IF iv_parameter IS SUPPLIED.
      me->check_authority_for_parameter(
        EXPORTING
          iv_parameter   = iv_parameter
          iv_auth_object = iv_auth_object
          iv_auth_field  = iv_auth_field
          iv_actvt_field = iv_actvt_field
          iv_actvt_value = iv_actvt_value
        EXCEPTIONS
          check_failed   = 1
          OTHERS         = 2
      ).

      IF sy-subrc <> 0.
        MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
          WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
          RAISING check_failed.
      ENDIF.

      RETURN.
    ENDIF.


*$--------------------------------------------$*
*$  (2.2). 场景B：范围权限校验
*$--------------------------------------------$*
    IF it_sel_opt IS SUPPLIED.
      check_authority_for_sel_opt(
        EXPORTING
          it_sel_opt     = it_sel_opt[]
          iv_auth_object = iv_auth_object
          iv_auth_field  = iv_auth_field
          iv_actvt_field = iv_actvt_field
          iv_actvt_value = iv_actvt_value
          iv_table_field = iv_table_field
        CHANGING
          ct_sel_opt     = ct_sel_opt[]
        EXCEPTIONS
          check_failed   = 1
          OTHERS         = 2
      ).

      IF sy-subrc <> 0.
        MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
          WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
          RAISING check_failed.
      ENDIF.

      RETURN.
    ENDIF.


  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_UTIL_AUTH->CHECK_AUTHORITY_FOR_PARAMETER
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_PARAMETER                   TYPE        ANY(optional)
* | [--->] IV_AUTH_OBJECT                 TYPE        XUOBJECT
* | [--->] IV_AUTH_FIELD                  TYPE        XUFIELD
* | [--->] IV_ACTVT_FIELD                 TYPE        XUFIELD (default ='ACTVT')
* | [--->] IV_ACTVT_VALUE                 TYPE        ACTIV_AUTH (default ='03')
* | [EXC!] CHECK_FAILED
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD check_authority_for_parameter.
    IF iv_parameter IS INITIAL.
*      参数 IV_PARAMETER 不允许为空
      MESSAGE e005 RAISING check_failed.
    ENDIF.

    AUTHORITY-CHECK OBJECT iv_auth_object
      ID iv_auth_field  FIELD iv_parameter
      ID iv_actvt_field FIELD iv_actvt_value.
    IF sy-subrc <> 0.
*        您未授权（权限对象&1字段&2值&3活动&4）
      MESSAGE e003 WITH iv_auth_object iv_auth_field iv_parameter iv_actvt_value
        RAISING check_failed.
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_UTIL_AUTH->CHECK_AUTHORITY_FOR_SEL_OPT
* +-------------------------------------------------------------------------------------------------+
* | [--->] IT_SEL_OPT                     TYPE        STANDARD TABLE(optional)
* | [--->] IV_AUTH_OBJECT                 TYPE        XUOBJECT
* | [--->] IV_AUTH_FIELD                  TYPE        XUFIELD
* | [--->] IV_ACTVT_FIELD                 TYPE        XUFIELD (default ='ACTVT')
* | [--->] IV_ACTVT_VALUE                 TYPE        ACTIV_AUTH (default ='03')
* | [--->] IV_TABLE_FIELD                 TYPE        STRING
* | [<-->] CT_SEL_OPT                     TYPE        STANDARD TABLE(optional)
* | [EXC!] CHECK_FAILED
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD check_authority_for_sel_opt.
*$--------------------------------------------$*
*$  声明变量
*$--------------------------------------------$*
    DATA lv_have_not_eq TYPE abap_bool.
    DATA lv_tabname     TYPE string.
    DATA lv_fieldname   TYPE string.

    CONSTANTS lc_max_records TYPE i VALUE 5000. "允许的最大范围表记录数

*$--------------------------------------------$*
*$  初始化
*$--------------------------------------------$*
    CLEAR ct_sel_opt[].

*    校验范围表结构，即使输入为空也必须包含标准组件
    DATA lr_sel_opt_line TYPE REF TO data.
    CREATE DATA lr_sel_opt_line LIKE LINE OF it_sel_opt.
    ASSIGN lr_sel_opt_line->* TO FIELD-SYMBOL(<ls_sel_opt_line>).

    ASSIGN COMPONENT 'SIGN' OF STRUCTURE <ls_sel_opt_line> TO FIELD-SYMBOL(<lv_sel_opt_component>).
    IF sy-subrc <> 0.
      MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
    ENDIF.

    ASSIGN COMPONENT 'OPTION' OF STRUCTURE <ls_sel_opt_line> TO <lv_sel_opt_component>.
    IF sy-subrc <> 0.
      MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
    ENDIF.

    ASSIGN COMPONENT 'LOW' OF STRUCTURE <ls_sel_opt_line> TO <lv_sel_opt_component>.
    IF sy-subrc <> 0.
      MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
    ENDIF.

    ASSIGN COMPONENT 'HIGH' OF STRUCTURE <ls_sel_opt_line> TO <lv_sel_opt_component>.
    IF sy-subrc <> 0.
      MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
    ENDIF.

*$--------------------------------------------$*
*$  首先针对用户输入的单值 (EQ) 进行精确拦截，快速阻断显式无权输入
*$--------------------------------------------$*
    LOOP AT it_sel_opt ASSIGNING FIELD-SYMBOL(<ls_sel_opt>).
      ASSIGN COMPONENT 'SIGN'   OF STRUCTURE <ls_sel_opt> TO FIELD-SYMBOL(<lv_sign>).
      IF sy-subrc <> 0.
        MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
      ENDIF.

      ASSIGN COMPONENT 'OPTION' OF STRUCTURE <ls_sel_opt> TO FIELD-SYMBOL(<lv_option>).
      IF sy-subrc <> 0.
        MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
      ENDIF.

      ASSIGN COMPONENT 'LOW' OF STRUCTURE <ls_sel_opt> TO FIELD-SYMBOL(<lv_low>).
      IF sy-subrc <> 0.
        MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
      ENDIF.

      ASSIGN COMPONENT 'HIGH' OF STRUCTURE <ls_sel_opt> TO FIELD-SYMBOL(<lv_high>).
      IF sy-subrc <> 0.
        MESSAGE e398(00) WITH '选择范围表结构无效' RAISING check_failed.
      ENDIF.

*      记录是否存在非"SIGN = I AND OPTION = EQ"的条目
      IF NOT ( <lv_sign> = 'I' AND  <lv_option> = 'EQ' ).
        lv_have_not_eq = abap_true.
        CONTINUE.
      ENDIF.

      me->check_authority_for_parameter(
        EXPORTING
          iv_parameter   = <lv_low>
          iv_auth_object = iv_auth_object
          iv_auth_field  = iv_auth_field
          iv_actvt_field = iv_actvt_field
          iv_actvt_value = iv_actvt_value
        EXCEPTIONS
          check_failed   = 1
          OTHERS         = 2
      ).
      IF sy-subrc <> 0.
        MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
          WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
          RAISING check_failed.
      ENDIF.
    ENDLOOP.

*    如果所有的选择条件都是“SIGN = I AND OPTION = EQ”，则无需进一步进行复杂的权限检查
    IF lv_have_not_eq = abap_false AND it_sel_opt[] IS NOT INITIAL.
      ct_sel_opt[] = it_sel_opt[].
      RETURN.
    ENDIF.

*$--------------------------------------------$*
*$  检查参数IV_TABLE_FIELD
*$--------------------------------------------$*
    me->parse_authority_table_field(
      EXPORTING
        iv_auth_field  = iv_auth_field
        iv_table_field = iv_table_field
      IMPORTING
        ev_tabname     = lv_tabname
        ev_fieldname   = lv_fieldname
      EXCEPTIONS
        check_failed   = 1
        OTHERS         = 2 ).
    IF sy-subrc <> 0.
      MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
        RAISING check_failed.
    ENDIF.

*$--------------------------------------------$*
*$  查询满足权限的范围表
*$--------------------------------------------$*
    DATA(lv_where_sscr) = |{ lv_fieldname } IN @IT_SEL_OPT[] | .
    DATA(lv_where_auth) = CONV string( '' ).

*    基于权限对象构建用户授权的SQL条件
    me->build_authority_where_clause(
      EXPORTING
        iv_auth_object  = iv_auth_object
        iv_auth_field   = iv_auth_field
        iv_actvt_field  = iv_actvt_field
        iv_actvt_value  = iv_actvt_value
        iv_tabname      = lv_tabname
        iv_fieldname    = lv_fieldname
      RECEIVING
        rv_where_clause = lv_where_auth
      EXCEPTIONS
        check_failed    = 1
        OTHERS          = 2 ).
    IF sy-subrc <> 0.
      MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
        RAISING check_failed.
    ENDIF.

*    允许的最大范围表数
    DATA(lv_max_records_cfg) = NEW ycl_frh_util_tvarvc( )->get_value(
                                  iv_name    = 'YFRH_UTIL_AUTH_MAX_RECORDS'
                                  iv_default = |{ lc_max_records }| ).
    DATA lv_max_records TYPE i.

    TRY.
        lv_max_records = CONV i( lv_max_records_cfg ).
        IF lv_max_records <= 0.
          lv_max_records = lc_max_records.
        ENDIF.
      CATCH cx_sy_conversion_error.
        lv_max_records = lc_max_records.
    ENDTRY.

    DATA(lv_max_records_1) = lv_max_records + 1.
    DATA(lv_select_list)   = |'I' AS sign, 'EQ' AS option, { lv_fieldname } AS low|.

*    SELECT DISTINCT
*           'I'              AS sign,
*           'EQ'             AS option,
*           ( lv_fieldname ) AS low
    SELECT DISTINCT (lv_select_list)
      FROM (lv_tabname)
      WHERE (lv_where_sscr)     "选择屏幕条件
        AND (lv_where_auth)     "权限对象条件
      INTO CORRESPONDING FIELDS OF TABLE @ct_sel_opt
      UP TO @lv_max_records_1 ROWS.

    IF ct_sel_opt[] IS INITIAL.
*      选择范围内无已授权数据（权限对象 &1，字段 &2）
      MESSAGE e009 WITH iv_auth_object iv_auth_field RAISING check_failed.
    ELSE.
      IF lines( ct_sel_opt[] ) > lv_max_records.
*      授权结果超过上限 &1 条（权限对象 &2，字段 &3），请缩小选择范围
        MESSAGE e010 WITH lv_max_records iv_auth_object iv_auth_field RAISING check_failed.
      ENDIF.
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_AUTH->CONSTRUCTOR
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD constructor.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_UTIL_AUTH->PARSE_AUTHORITY_TABLE_FIELD
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_AUTH_FIELD                  TYPE        XUFIELD
* | [--->] IV_TABLE_FIELD                 TYPE        STRING
* | [<---] EV_TABNAME                     TYPE        STRING
* | [<---] EV_FIELDNAME                   TYPE        STRING
* | [EXC!] CHECK_FAILED
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD parse_authority_table_field.
*    解析权限字段的主数据表，格式应该为{TABLE}-{FIELD}，例如T001W-WERKS
    IF iv_table_field IS NOT INITIAL AND iv_table_field NP '*-*'.
*      参数 IV_TABLE_FIELD 值未传入或格式不对或值不正确
      MESSAGE e004 RAISING check_failed.
    ENDIF.

*    解析主数据表名与字段名
    IF iv_table_field IS NOT INITIAL.
      SPLIT iv_table_field AT '-' INTO ev_tabname ev_fieldname.
      ev_tabname   = to_upper( ev_tabname ).
      ev_fieldname = to_upper( ev_fieldname ).
    ELSE.
*      如果未传入参数iv_table_field的值，则自动获取权限对象字段的范围表
      SELECT SINGLE FROM authx INNER JOIN dd04l ON dd04l~rollname = authx~rollname
        FIELDS dd04l~entitytab  "数据元素 -> 域 -> 范围表
        WHERE authx~fieldname = @iv_auth_field
        INTO @DATA(lv_entitytab).
      IF sy-subrc <> 0 OR lv_entitytab IS INITIAL.
*        无法自动推导权限字段 &1 的范围表，请显式传输IV_TABLE_FIELD的参数值
        MESSAGE e006 WITH iv_auth_field RAISING check_failed.
      ELSE.
        ev_tabname   = to_upper( lv_entitytab ).
        ev_fieldname = to_upper( iv_auth_field ).
      ENDIF.
    ENDIF.

*    真实性校验与单字段类型获取 (RTTS)
    TRY.
        DATA(lo_elem_descr) = CAST cl_abap_elemdescr( cl_abap_typedescr=>describe_by_name( |{ ev_tabname }-{ ev_fieldname }| ) ).
      CATCH cx_root.
*        参数 IV_TABLE_FIELD 值未传入或格式不对或值不正确
        MESSAGE e004 RAISING check_failed.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
