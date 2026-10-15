import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkCode } from '../../../../apps/api/src/modules/abap-dev-agent/tools/check.mjs';

const example = await readFile(
  new URL(
    '../../../../apps/api/src/modules/abap-dev-agent/prompts/report-example.abap',
    import.meta.url,
  ),
  'utf8',
);
const plan = `## 3.2 文本元素\n\n| 编号 | 文本 |\n| --- | --- |\n${['b10', 'b11', 'm01', 'm03', 'f01', 'f02', 'f03', 'f04'].map((id) => `| ${id} | x |`).join('\n')}\n`;
const rules = async (code, options = { plan }) =>
  (await checkCode(code, options)).map((p) => p.rule);

test('the shipped example passes every check', async () => {
  const tables = {
    EKKO: ['EBELN', 'EKORG', 'BEDAT', 'LIFNR', 'BSTYP', 'LOEKZ'],
    EKPO: ['EBELN', 'EBELP', 'MATNR', 'WERKS', 'LOEKZ', 'RETPO', 'MENGE', 'MEINS', 'ELIKZ'],
    EKET: ['EBELN', 'EBELP', 'WEMNG', 'EINDT'],
    LFA1: ['LIFNR', 'NAME1'],
    MAKT: ['MATNR', 'SPRAS', 'MAKTX'],
    T001W: ['WERKS', 'NAME1'],
  };
  const verifyTable = async (t) =>
    tables[t] ? `${t}（TABL）共 n 个字段：\n${tables[t].join(' X\n')}` : null;
  assert.deepEqual(await checkCode(example, { plan, verifyTable }), []);
});

test('blocks must pair and statements must end', async () => {
  assert.deepEqual(await rules('IF a = 1.\n  WRITE 1.\nENDLOOP.'), ['block']);
  assert.deepEqual(await rules('METHOD x.\n  WRITE 1'), ['block', 'block']);
  assert.deepEqual(await rules("CLASS lcl DEFINITION DEFERRED.\nWRITE 'IF'."), []);
});

test('coding rules that can be decided from the text are reported', async () => {
  assert.deepEqual(
    await rules(
      'SELECT FROM ekko FIELDS ebeln FOR ALL ENTRIES IN @lt WHERE x = 1 INTO TABLE @DATA(r).',
    ),
    ['for_all_entries'],
  );
  assert.deepEqual(await rules('SELECT * FROM ekko INTO TABLE @DATA(r).'), [
    'select_star',
    'sql_syntax',
  ]);
  assert.deepEqual(await rules('SELECT ebeln FROM ekko INTO TABLE @DATA(r).'), ['sql_syntax']);
  assert.deepEqual(await rules('METHODS select REDEFINITION.\nme->select( ).'), []);
  assert.deepEqual(await rules('LOOP AT lt INTO DATA(ls).\n  AT NEW a.\n  ENDAT.\nENDLOOP.'), [
    'at_new',
  ]);
  assert.deepEqual(await rules('TYPES: BEGIN OF ls_out, a TYPE i, END OF ls_out.'), [
    'types_prefix',
    'types_prefix',
  ]);
  assert.deepEqual(await rules('"! doc\nWRITE 1.'), ['abap_doc']);
  assert.deepEqual(await rules('WRITE 1.\n...\nWRITE 2.'), ['placeholder']);
  assert.deepEqual(await rules("WRITE '请稍后...'."), []);
});

test('INITIALIZATION only creates the report and calls initialize', async () => {
  const ok =
    'INITIALIZATION.\n  DATA(go_report) = NEW lcl_report( ).\n  go_report->initialize( ).\nSTART-OF-SELECTION.\n  go_report->run( ).';
  assert.deepEqual(await rules(ok), []);
  assert.deepEqual(await rules(ok.replace('START-OF', "  p_x = 'A'.\nSTART-OF")), [
    'initialization',
  ]);
});

test('shadow ranges must be filled by check_authority and bound in queries', async () => {
  const code = [
    'SELECT-OPTIONS s_ekorg FOR ekko-ekorg.',
    'SELECT-OPTIONS s_ekorg1 FOR ekko-ekorg NO-DISPLAY.',
    "me->get_util_auth( )->check_authority( EXPORTING it_sel_opt = s_ekorg[] iv_auth_object = 'M_BEST_EKO' iv_auth_field = 'ACTVT' CHANGING ct_sel_opt = s_ekorg1[] ).",
    'SELECT FROM ekko FIELDS ebeln WHERE ekorg IN @s_ekorg INTO TABLE @DATA(r).',
  ].join('\n');
  assert.deepEqual((await rules(code)).sort(), ['auth_field', 'shadow']);
  const unfilled = code
    .split('\n')
    .filter((l) => !l.includes('check_authority'))
    .join('\n');
  assert.ok((await rules(unfilled)).includes('shadow'));
});

test('text symbols must be unique and listed in the plan; plan must exist', async () => {
  const code = "WRITE '甲'(m01).\nWRITE '乙'(m01).\nWRITE '丙'(m09).";
  const found = await checkCode(code, { plan });
  assert.deepEqual(
    found.map((p) => p.rule),
    ['text_symbol', 'text_symbol'],
  );
  assert.match(found[1].message, /m09/);
  assert.deepEqual(await rules('WRITE 1.', { plan: '' }), ['plan']);
});

test('tables and fields are checked only when SAP says so', async () => {
  const verifyTable = async (t) => (t === 'EKKO' ? 'EKKO（TABL）共 1 个字段：\nEBELN 键' : null);
  const code =
    'DATA lv_x TYPE ekko-ebelnx.\nDATA ls_y TYPE ts_out-a.\nSELECT FROM zfoo FIELDS a INTO TABLE @DATA(r).';
  const found = await checkCode(code, { plan, verifyTable });
  assert.deepEqual(
    found.map((p) => p.message),
    ['第 1 行的字段 EKKO-EBELNX 在 SAP 中不存在。', '第 3 行的表 ZFOO 在 SAP 中不存在。'],
  );
});
