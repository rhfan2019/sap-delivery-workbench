import test from 'node:test';
import assert from 'node:assert/strict';
import { previewToolResult } from '../../../../apps/api/src/modules/agent-core/preview.mjs';

test('a query result becomes a few rows of a table', () => {
  const values = Array.from({ length: 7 }, (_, i) => ({ VKORG: '100' + i, BUKRS: '1000' }));
  const content = JSON.stringify({
    status: 'success',
    result: { columns: [{ name: 'VKORG' }, { name: 'BUKRS' }], values },
  });
  assert.deepEqual(previewToolResult('ok', content), {
    kind: 'table',
    columns: ['VKORG', 'BUKRS'],
    rows: values.slice(0, 5).map((v) => [v.VKORG, v.BUKRS]),
    total: 7,
  });
});

test('a search lists the objects it found', () => {
  const content = JSON.stringify({
    status: 'success',
    results: [
      {
        'adtcore:name': 'V_VBAK_VKO',
        'adtcore:type': 'SUSO/B',
        'adtcore:description': '销售单据: 销售范围的权限',
      },
    ],
  });
  assert.deepEqual(previewToolResult('ok', content), {
    kind: 'objects',
    items: [{ name: 'V_VBAK_VKO', type: 'SUSO/B', description: '销售单据: 销售范围的权限' }],
    total: 1,
  });
});

test('SAP errors read as their message, and plain text stays text', () => {
  const failed =
    'SAP 查询失败：{"error":"未知的列名称 \\"VBTYP\\"; type: ExceptionDataPreviewGeneral; localizedMessage: 未知的列名称 \\"VBTYP\\"","code":-32603}';
  assert.deepEqual(previewToolResult('error', failed), {
    kind: 'error',
    text: 'SAP 查询失败：未知的列名称 "VBTYP"',
  });
  assert.deepEqual(previewToolResult('error', '调用失败：批注编号不存在。'), {
    kind: 'error',
    text: '调用失败：批注编号不存在。',
  });
  assert.deepEqual(previewToolResult('ok', 'TVAKT（TABL/DT）共 4 个字段：\nMANDT 键'), {
    kind: 'text',
    text: 'TVAKT（TABL/DT）共 4 个字段：\nMANDT 键',
  });
});
