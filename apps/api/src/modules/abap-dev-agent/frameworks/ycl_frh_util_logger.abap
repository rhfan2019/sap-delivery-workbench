class YCL_FRH_UTIL_LOGGER definition
  public
  create public .

public section.

  interfaces IF_SERIALIZABLE_OBJECT .

  methods CONSTRUCTOR .
  methods ADD_FROM_SYMSG
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods ADD_FROM_CX
    importing
      !IO_EXCEPTION type ref to CX_ROOT
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods ADD_FROM_BAPIRET2
    importing
      !IS_BAPIRET2 type BAPIRET2
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods ADD_FROM_BAPITAB
    importing
      !IT_BAPIRET type BAPIRET2_T
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods ADD_FROM_BDC
    importing
      !IT_BDCMSG type TAB_BDCMSGCOLL
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods ADD_ERROR
    importing
      !IV_CLIKE type CLIKE
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods ADD_INFO
    importing
      !IV_CLIKE type CLIKE
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods DISPLAY
    importing
      !IV_NO_DUPLICATE type ABAP_BOOL default ABAP_TRUE
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods SAVE
    importing
      !IV_OBJECT type BALOBJ_D
      !IV_SUBOBJECT type BALSUBOBJ
      !IV_EXTNUMBER type BALNREXT optional
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  methods IS_EMPTY
    returning
      value(RV_RESULT) type ABAP_BOOL .
  methods HAS_ERRORS
    returning
      value(RV_RESULT) type ABAP_BOOL .
  methods GET_MESSAGES
    returning
      value(RT_RESULT) type BAPIRET2_T .
  methods GET_COUNT
    returning
      value(RV_RESULT) type I .
  methods CLEAR
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
  class-methods GET_BAPIRET2_FROM_SYMSG
    returning
      value(RS_RESULT) type BAPIRET2 .
  PROTECTED SECTION.
private section.

  data MO_RECA_LIST type ref to IF_RECA_MESSAGE_LIST .

  methods ADD_FROM_CLIKE
    importing
      value(IV_CLIKE) type CLIKE
      value(IV_MSGTY) type SY-MSGTY default 'I'
    returning
      value(RO_RESULT) type ref to YCL_FRH_UTIL_LOGGER .
ENDCLASS.



CLASS YCL_FRH_UTIL_LOGGER IMPLEMENTATION.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->ADD_ERROR
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_CLIKE                       TYPE        CLIKE
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD add_error.
    ro_result = me.

    me->add_from_clike( iv_clike = iv_clike iv_msgty = 'E' ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->ADD_FROM_BAPIRET2
* +-------------------------------------------------------------------------------------------------+
* | [--->] IS_BAPIRET2                    TYPE        BAPIRET2
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD add_from_bapiret2.
    ro_result = me.

    IF is_bapiret2 IS NOT INITIAL.
      mo_reca_list->add_from_bapi( is_bapiret = is_bapiret2 ).
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->ADD_FROM_BAPITAB
* +-------------------------------------------------------------------------------------------------+
* | [--->] IT_BAPIRET                     TYPE        BAPIRET2_T
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD add_from_bapitab.
    ro_result = me.

    IF it_bapiret IS NOT INITIAL.
      mo_reca_list->add_from_bapi( it_bapiret = it_bapiret ).
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->ADD_FROM_BDC
* +-------------------------------------------------------------------------------------------------+
* | [--->] IT_BDCMSG                      TYPE        TAB_BDCMSGCOLL
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD add_from_bdc.
    ro_result = me.

    LOOP AT it_bdcmsg ASSIGNING FIELD-SYMBOL(<ls_bdcmsg>).
      mo_reca_list->add(
        id_msgty = <ls_bdcmsg>-msgtyp
        id_msgid = <ls_bdcmsg>-msgid
        id_msgno = CONV symsgno( <ls_bdcmsg>-msgnr )
        id_msgv1 = <ls_bdcmsg>-msgv1
        id_msgv2 = <ls_bdcmsg>-msgv2
        id_msgv3 = <ls_bdcmsg>-msgv3
        id_msgv4 = <ls_bdcmsg>-msgv4
      ).
    ENDLOOP.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_UTIL_LOGGER->ADD_FROM_CLIKE
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_CLIKE                       TYPE        CLIKE
* | [--->] IV_MSGTY                       TYPE        SY-MSGTY (default ='I')
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD add_from_clike.
    ro_result = me.

    IF iv_clike IS NOT INITIAL.
      cl_message_helper=>set_msg_vars_for_clike( iv_clike ).
      sy-msgty = iv_msgty.
      mo_reca_list->add_symsg( ).
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->ADD_FROM_CX
* +-------------------------------------------------------------------------------------------------+
* | [--->] IO_EXCEPTION                   TYPE REF TO CX_ROOT
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD add_from_cx.
    ro_result = me.

    IF io_exception IS BOUND.
      mo_reca_list->add_from_exception( io_exception ).
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->ADD_FROM_SYMSG
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD add_from_symsg.
    ro_result = me.

    IF sy-msgid IS NOT INITIAL OR sy-msgty IS NOT INITIAL.
      mo_reca_list->add_symsg( ).
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->ADD_INFO
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_CLIKE                       TYPE        CLIKE
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD ADD_INFO.
    ro_result = me.

    me->add_from_clike( iv_clike = iv_clike iv_msgty = 'I' ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->CLEAR
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD clear.
    ro_result = me.

    mo_reca_list->clear( ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->CONSTRUCTOR
* +-------------------------------------------------------------------------------------------------+
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD constructor.
    mo_reca_list = cf_reca_message_list=>create( ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->DISPLAY
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_NO_DUPLICATE                TYPE        ABAP_BOOL (default =ABAP_TRUE)
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD display.
    ro_result = me.

    IF me->is_empty( ) = abap_true.
      RETURN.
    ENDIF.

    DATA(lv_log_handle) = mo_reca_list->get_handle( ).
    DATA(lt_log_handles) = VALUE bal_t_logh( ( lv_log_handle ) ).
    DATA ls_display_profile TYPE bal_s_prof.

    " 获取系统标准的应用日志弹窗配置文件
    CALL FUNCTION 'BAL_DSP_PROFILE_POPUP_GET'
      IMPORTING
        e_s_display_profile = ls_display_profile.

    " 调用标准引擎渲染出现代化的日志弹窗（自带过滤、详情下钻、严重程度统计）
    CALL FUNCTION 'BAL_DSP_LOG_DISPLAY'
      EXPORTING
        i_s_display_profile  = ls_display_profile
        i_t_log_handle       = lt_log_handles
      EXCEPTIONS
        profile_inconsistent = 1
        internal_error       = 2
        no_data_available    = 3
        no_authority         = 4
        OTHERS               = 5.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Static Public Method YCL_FRH_UTIL_LOGGER=>GET_BAPIRET2_FROM_SYMSG
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RS_RESULT                      TYPE        BAPIRET2
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_bapiret2_from_symsg.
    CLEAR rs_result.

    MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
      INTO DATA(lv_message).

    rs_result = VALUE #( id         = sy-msgid
                         type       = sy-msgty
                         number     = sy-msgno
                         message    = lv_message
                         message_v1 = sy-msgv1
                         message_v2 = sy-msgv2
                         message_v3 = sy-msgv3
                         message_v4 = sy-msgv4 ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->GET_COUNT
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RV_RESULT                      TYPE        I
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_count.
    rv_result = mo_reca_list->count( ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->GET_MESSAGES
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RT_RESULT                      TYPE        BAPIRET2_T
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_messages.
    DATA lv_message TYPE bapi_msg.
    DATA lt_recamsg TYPE re_t_msg.
    mo_reca_list->get_list( IMPORTING et_list = lt_recamsg ).

    LOOP AT lt_recamsg ASSIGNING FIELD-SYMBOL(<ls_recamsg>).
      CALL FUNCTION 'FORMAT_MESSAGE'
        EXPORTING
          id        = <ls_recamsg>-msgid
          lang      = sy-langu
          no        = <ls_recamsg>-msgno
          v1        = <ls_recamsg>-msgv1
          v2        = <ls_recamsg>-msgv2
          v3        = <ls_recamsg>-msgv3
          v4        = <ls_recamsg>-msgv4
        IMPORTING
          msg       = lv_message
        EXCEPTIONS
          not_found = 1
          OTHERS    = 2.

      APPEND VALUE #(
          type       = <ls_recamsg>-msgty
          id         = <ls_recamsg>-msgid
          number     = <ls_recamsg>-msgno
          message    = lv_message
          message_v1 = <ls_recamsg>-msgv1
          message_v2 = <ls_recamsg>-msgv2
          message_v3 = <ls_recamsg>-msgv3
          message_v4 = <ls_recamsg>-msgv4
      ) TO rt_result.

      CLEAR lv_message.
    ENDLOOP.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->HAS_ERRORS
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RV_RESULT                      TYPE        ABAP_BOOL
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD has_errors.
    rv_result = abap_false.
    IF mo_reca_list->has_messages_of_msgty( id_msgty = 'E' )
      OR mo_reca_list->has_messages_of_msgty( id_msgty = 'A' ).
      rv_result = abap_true.
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->IS_EMPTY
* +-------------------------------------------------------------------------------------------------+
* | [<-()] RV_RESULT                      TYPE        ABAP_BOOL
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD is_empty.
    rv_result = mo_reca_list->is_empty( ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_LOGGER->SAVE
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_OBJECT                      TYPE        BALOBJ_D
* | [--->] IV_SUBOBJECT                   TYPE        BALSUBOBJ
* | [--->] IV_EXTNUMBER                   TYPE        BALNREXT(optional)
* | [<-()] RO_RESULT                      TYPE REF TO YCL_FRH_UTIL_LOGGER
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD save.
    ro_result = me.

    IF me->is_empty( ) = abap_true.
      RETURN.
    ENDIF.

    " ！！！极客的底层渗透 (Deep Injection) ！！！
    " 因为 IF_RECA_MESSAGE_LIST->STORE 在新版系统中被削减为纯无参提交，
    " 我们直接抽出它底层的 BAL (Application Log) 内存句柄，暴力改写它的头部配置！
    DATA(lv_log_handle) = mo_reca_list->get_handle( ).
    DATA ls_log_header  TYPE bal_s_log.

    " 1. 读取当前的空白头部信息
    CALL FUNCTION 'BAL_LOG_HDR_READ'
      EXPORTING
        i_log_handle = lv_log_handle
      IMPORTING
        e_s_log      = ls_log_header
      EXCEPTIONS
        OTHERS       = 1.

    IF sy-subrc = 0.
      " 2. 将我们在 SAVE 时才知道的精准业务参数，强行注入进去
      ls_log_header-object    = iv_object.
      ls_log_header-subobject = iv_subobject.
      ls_log_header-extnumber = iv_extnumber.
      ls_log_header-aldate    = sy-datum.
      ls_log_header-altime    = sy-uzeit.
      ls_log_header-aluser    = sy-uname.
      ls_log_header-alprog    = sy-cprog.

      " 3. 将被篡改的头部信息写回内存句柄
      CALL FUNCTION 'BAL_LOG_HDR_CHANGE'
        EXPORTING
          i_log_handle = lv_log_handle
          i_s_log      = ls_log_header
        EXCEPTIONS
          OTHERS       = 1.
    ENDIF.

    " 4. 让标准引擎去执行保存动作，它会将内存中修改后的信息完美落库（SLG1）！
    mo_reca_list->store(
      EXPORTING
        if_in_update_task = abap_false
    ).
  ENDMETHOD.
ENDCLASS.
