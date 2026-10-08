import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractBytes } from '../../../../apps/api/src/modules/agent-runtime/attachment-parser.mjs';
import { syntheticPdf } from '../../../fixtures/fs-workspace/pdf.mjs';
async function zip(files) {
  const z = new JSZip();
  for (const [p, t] of Object.entries(files)) z.file(p, t);
  return z.generateAsync({ type: 'nodebuffer' });
}
test('text extracts full contents with source; active and malformed files are rejected', async () => {
  assert.match(
    (await extractBytes('a.csv', Buffer.from('key,value\nA,UNIQUE-713'))).regions[0].text,
    /UNIQUE-713/,
  );
  for (const [n, b] of [
    ['x.html', Buffer.from('<script>alert(1)</script>')],
    ['a.txt', Buffer.alloc(0)],
    ['x.docx', Buffer.from('broken')],
  ])
    assert.notEqual((await extractBytes(n, b)).state, 'ready');
  assert.equal((await extractBytes('x.png', Buffer.from('image'))).state, 'preview_only');
});
test('DOCX paragraphs and table locations, XLSX formulas/cache and PDF pages survive extraction', async () => {
  const doc = await zip({
    'word/document.xml':
      '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>DOC-TOKEN</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>CELL-TOKEN</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  });
  const d = await extractBytes('a.docx', doc);
  assert.equal(d.state, 'ready');
  assert.match(JSON.stringify(d.regions), /paragraph:1/);
  assert.match(JSON.stringify(d.regions), /table:1/);
  const x = await zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="案例" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row r="1"><c r="A1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>',
  });
  const r = await extractBytes('a.xlsx', x);
  assert.equal(r.state, 'ready');
  assert.match(r.regions[0].text, /公式=1\+2/);
  assert.match(r.regions[0].text, /缓存=3/);
  assert.match(r.regions[0].locator, /案例!A1/);
  const p = await extractBytes('a.pdf', syntheticPdf('PDF-TOKEN'));
  assert.equal(p.state, 'ready');
  assert.equal(p.regions[0].locator, 'page:1');
});

test('format failures are explicit for empty/corrupt/legacy/oversized and entity XML', async () => {
  for (const [n, b] of [
    ['a.doc', Buffer.from('old')],
    ['a.xls', Buffer.from('old')],
    ['a.pdf', Buffer.from('%PDF-broken')],
    ['a.txt', Buffer.from([255, 254, 253])],
    ['a.md', Buffer.from('x'.repeat(200001))],
    ['a.txt', Buffer.alloc(20971521)],
  ])
    assert.equal((await extractBytes(n, b)).state, 'failed', n);
  const d = await zip({
    'word/document.xml':
      '<!DOCTYPE x [<!ENTITY a "EXPAND">]><w:document><w:p>&a;</w:p></w:document>',
  });
  assert.equal((await extractBytes('a.docx', d)).state, 'failed');
  const huge = await zip({ 'word/document.xml': ' '.repeat(9 * 1024 * 1024) });
  assert.equal((await extractBytes('a.docx', huge)).state, 'failed');
});
test('XLSX missing formula cache remains visible and excessive cells fail with selection advice', async () => {
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row><c r="A1"><f>NOW()</f></c></row></sheetData></worksheet>',
  };
  const r = await extractBytes('a.xlsx', await zip(files));
  assert.match(r.regions[0].text, /缺失（未计算）/);
  files['xl/worksheets/sheet1.xml'] =
    '<worksheet><sheetData><row>' +
    Array.from({ length: 3001 }, (_, i) => `<c r="A${i + 1}"><v>1</v></c>`).join('') +
    '</row></sheetData></worksheet>';
  const over = await extractBytes('a.xlsx', await zip(files));
  assert.equal(over.state, 'failed');
  assert.match(over.warnings.join(), /选段/);
});
