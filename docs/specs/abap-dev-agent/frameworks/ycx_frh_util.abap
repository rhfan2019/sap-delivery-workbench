class YCX_FRH_UTIL definition
  public
  inheriting from CX_DYNAMIC_CHECK
  create public .

public section.

  interfaces IF_T100_MESSAGE .
  interfaces IF_T100_DYN_MSG .

  data MV_MSGV1 type SYMSGV .
  data MV_MSGV2 type SYMSGV .
  data MV_MSGV3 type SYMSGV .
  data MV_MSGV4 type SYMSGV .

  methods CONSTRUCTOR
    importing
      !TEXTID like IF_T100_MESSAGE=>T100KEY optional
      !PREVIOUS like PREVIOUS optional
      !MV_MSGV1 type SYMSGV optional
      !MV_MSGV2 type SYMSGV optional
      !MV_MSGV3 type SYMSGV optional
      !MV_MSGV4 type SYMSGV optional .
  class-methods RAISE_FROM_SYST
    raising
      YCX_FRH_UTIL .
  class-methods RAISE_FROM_TEXT
    importing
      value(IV_TEXT) type CSEQUENCE
      value(IV_MSGTY) type SY-MSGTY default 'E'
    raising
      YCX_FRH_UTIL .