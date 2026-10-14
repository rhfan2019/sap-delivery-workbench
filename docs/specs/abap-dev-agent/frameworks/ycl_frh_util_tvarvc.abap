*YCL_FRH_UTIL_TVARVC 是一个基于 Clean ABAP 规范构建的、
*用于高效访问系统配置表（TVARVC）的实例级工具类。
*它摒弃了传统的静态全局缓存，采用实例级状态隔离，确保
*复杂长后台作业中的数据安全性；同时引入了纯粹的依赖注
*入（Pure DI），通过构造器动态挂载 YCL_L
*OGGER，实现了异常的静默拦截与集中归集。该类兼具极致的
*性能（内存缓存防抖）与完美的开发者体验（面向对象、类
*型安全）。
class YCL_FRH_UTIL_TVARVC definition
  public
  final
  create public .

public section.

    " 统一工具类构造契约：纯粹的依赖注入 (仅按需传入 Logger)
  methods CONSTRUCTOR
    importing
      !IO_LOGGER type ref to YCL_FRH_UTIL_LOGGER optional .
    " 读取单值 (Type P)
  methods GET_VALUE
    importing
      value(IV_NAME) type RVARI_VNAM
      value(IV_DEFAULT) type ANY optional
    returning
      value(RV_VALUE) type RVARI_VAL_255 .
    " 读取范围表 (Type S) - 强制泛型输入以保证底层类型安全
  methods GET_RANGE
    importing
      value(IV_NAME) type RVARI_VNAM
    changing
      !CT_RANGE type STANDARD TABLE .
  methods IS_IN_RANGE
    importing
      !IV_NAME type RVARI_VNAM
      !IV_VALUE type CLIKE
    returning
      value(RV_BOOL) type ABAP_BOOL .
  methods IS_CONFIGURED
    importing
      !IV_NAME type RVARI_VNAM
    returning
      value(RV_BOOL) type ABAP_BOOL .
  methods CLEAR_CACHE
    importing
      value(IV_NAME) type TVARVC-NAME optional .
protected section.
private section.

  types:
    BEGIN OF ts_cache,
        name  TYPE tvarvc-name,
        type  TYPE tvarvc-type,
        value TYPE tvarvc-low,
        range TYPE REF TO data, " 使用数据引用动态存储范围表
      END OF ts_cache .
  types:
    BEGIN OF ts_range,
        sign   TYPE tvarvc-sign,
        option TYPE tvarvc-opti,
        low    TYPE tvarvc-low,
        high   TYPE tvarvc-high,
      END OF ts_range .
  types:
    tt_range TYPE TABLE OF ts_range WITH EMPTY KEY .

  data MO_LOGGER type ref to YCL_FRH_UTIL_LOGGER .
  data:
    " 极客改造：静态全局缓存降级为实例级缓存，实现真正的状态物理隔离
    mt_cache TYPE HASHED TABLE OF ts_cache WITH UNIQUE KEY name type .

  methods LOAD_FROM_DB
    importing
      value(IV_NAME) type TVARVC-NAME
      value(IV_TYPE) type TVARVC-TYPE .
ENDCLASS.



CLASS YCL_FRH_UTIL_TVARVC IMPLEMENTATION.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_TVARVC->CLEAR_CACHE
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_NAME                        TYPE        TVARVC-NAME(optional)
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD clear_cache.
    IF iv_name IS INITIAL.
      CLEAR mt_cache.
    ELSE.
      DELETE mt_cache WHERE name = iv_name.
    ENDIF.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_TVARVC->CONSTRUCTOR
* +-------------------------------------------------------------------------------------------------+
* | [--->] IO_LOGGER                      TYPE REF TO YCL_FRH_UTIL_LOGGER(optional)
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD constructor.
    mo_logger = io_logger.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_TVARVC->GET_RANGE
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_NAME                        TYPE        RVARI_VNAM
* | [<-->] CT_RANGE                       TYPE        STANDARD TABLE
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_range.
    CLEAR ct_range.
    load_from_db( iv_name = iv_name iv_type = 'S' ).

    TRY.
        DATA(lr_range) = mt_cache[ name = iv_name type = 'S' ]-range.
        ASSIGN lr_range->* TO FIELD-SYMBOL(<lt_range>).
        MOVE-CORRESPONDING <lt_range> TO ct_range.
      CATCH cx_root.
        CLEAR ct_range.
    ENDTRY.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_TVARVC->GET_VALUE
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_NAME                        TYPE        RVARI_VNAM
* | [--->] IV_DEFAULT                     TYPE        ANY(optional)
* | [<-()] RV_VALUE                       TYPE        RVARI_VAL_255
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD get_value.
    load_from_db( iv_name = iv_name iv_type = 'P' ).
    rv_value = VALUE #( mt_cache[ name = iv_name type = 'P' ]-value DEFAULT iv_default ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_TVARVC->IS_CONFIGURED
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_NAME                        TYPE        RVARI_VNAM
* | [<-()] RV_BOOL                        TYPE        ABAP_BOOL
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD is_configured.
    " 优先去 DB 探查一次（内部会进行缓存控制）
    load_from_db( iv_name = iv_name iv_type = 'P' ).
    load_from_db( iv_name = iv_name iv_type = 'S' ).

    rv_bool = xsdbool( line_exists( mt_cache[ name = iv_name ] ) ).
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Public Method YCL_FRH_UTIL_TVARVC->IS_IN_RANGE
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_NAME                        TYPE        RVARI_VNAM
* | [--->] IV_VALUE                       TYPE        CLIKE
* | [<-()] RV_BOOL                        TYPE        ABAP_BOOL
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD is_in_range.
    rv_bool = abap_false.
    load_from_db( iv_name = iv_name iv_type = 'S' ).

    TRY.
        DATA(lr_range) = mt_cache[ name = iv_name type = 'S' ]-range.

        FIELD-SYMBOLS <lt_range> TYPE tt_range.
        ASSIGN lr_range->* TO <lt_range>.

        IF iv_value IN <lt_range>.
          rv_bool = abap_true.
        ENDIF.
      CATCH cx_root.
        rv_bool = abap_false.
    ENDTRY.
  ENDMETHOD.


* <SIGNATURE>---------------------------------------------------------------------------------------+
* | Instance Private Method YCL_FRH_UTIL_TVARVC->LOAD_FROM_DB
* +-------------------------------------------------------------------------------------------------+
* | [--->] IV_NAME                        TYPE        TVARVC-NAME
* | [--->] IV_TYPE                        TYPE        TVARVC-TYPE
* +--------------------------------------------------------------------------------------</SIGNATURE>
  METHOD load_from_db.
    FIELD-SYMBOLS <lt_range> TYPE STANDARD TABLE.

    " 命中实例缓存则直接返回
    IF line_exists( mt_cache[ name = iv_name type = iv_type ] ).
      RETURN.
    ENDIF.

    DATA(ls_cache) = VALUE ts_cache(
        name = iv_name
        type = iv_type
    ).

    CASE iv_type.
      WHEN 'P'.
        SELECT SINGLE FROM tvarvc
          FIELDS low
          WHERE name = @iv_name
            AND type = 'P'
          INTO @ls_cache-value.
        IF sy-subrc = 0.
          INSERT ls_cache INTO TABLE mt_cache.
        ENDIF.

      WHEN 'S'.
        ls_cache-range = NEW tt_range( ).
        ASSIGN ls_cache-range->* TO <lt_range>.

        SELECT FROM tvarvc
          FIELDS
            sign,
            opti AS option,
            low,
            high
          WHERE name = @iv_name
            AND type = @iv_type
          INTO TABLE @<lt_range>.
        IF sy-subrc = 0.
          INSERT ls_cache INTO TABLE mt_cache.
        ENDIF.
    ENDCASE.
  ENDMETHOD.
ENDCLASS.