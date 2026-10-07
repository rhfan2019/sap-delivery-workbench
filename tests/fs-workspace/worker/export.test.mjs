import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { document, template } from '../fixtures/document.mjs';
import { toRenderModel } from '../../../apps/api/src/fs-workspace/export/render-model.mjs';
import { renderHtml } from '../../../apps/api/src/fs-workspace/export/html.mjs';
import { renderDocx } from '../../../apps/api/src/fs-workspace/export/docx.mjs';
import { renderPdf } from '../../../apps/api/src/fs-workspace/export/pdf.mjs';
import { parsePdfBytes } from '../../../apps/api/src/fs-workspace/attachments/parser.mjs';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
test('real Word/PDF render same Chinese content and draft watermark without executing HTML', async () => {
  const ast = document();
  ast.title = '合成测试功能说明';
  ast.sections[0].blocks[0].text = '中文金额 123.45 元 <script>alert(1)</script>';
  const model = toRenderModel(ast, template),
    manifest = { document_version_id: 'synthetic-v1', watermark_policy: 'discussion' };
  const html = renderHtml(model, manifest);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  const docx = await renderDocx(model, manifest, { fontName: 'Microsoft YaHei' });
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  const zip = await JSZip.loadAsync(docx),
    xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /中文金额 123\.45 元/);
  assert.match(xml, /未批准/);
  assert.ok(zip.file('[Content_Types].xml'));
  const pdf = await renderPdf(model, manifest, {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    fontName: 'Microsoft YaHei',
    fontFile: 'C:/Windows/Fonts/msyh.ttc',
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const parsed = await parsePdfBytes(pdf),
    text = parsed.regions.map((r) => r.text).join('\n');
  assert.match(text, /中文金额/);
  assert.match(text, /123\.45/);
  assert.match(text, /未批准/);
  await mkdir('artifacts/fs-workspace/export', { recursive: true });
  await writeFile('artifacts/fs-workspace/export/synthetic.docx', docx);
  await writeFile('artifacts/fs-workspace/export/synthetic.pdf', pdf);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 }),
    pdfDoc = await task.promise;
  try {
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const page = await pdfDoc.getPage(n),
        viewport = page.getViewport({ scale: 1.4 }),
        canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      await writeFile(`artifacts/fs-workspace/export/page-${n}.png`, canvas.toBuffer('image/png'));
    }
  } finally {
    await task.destroy();
  }
});

test('long Chinese tables retain every row across PDF pages and repeat headers', async () => {
  const ast = document();
  ast.title = '跨页长表验收';
  const block = ast.sections[0].blocks[0];
  block.kind = 'table';
  block.text = null;
  block.columns = ['验收序号', '中文业务内容', '金额'];
  block.rows = Array.from({ length: 100 }, (_, i) => ({
    id: 'row-' + i,
    cells: [
      `ROW${String(i + 1).padStart(3, '0')}`,
      `公司范围与币种检查：第${i + 1}项；异常时保留原始业务记录。`,
      `${i + 1}.45`,
    ],
  }));
  const model = toRenderModel(ast, template),
    manifest = { document_version_id: 'long-table-v1', watermark_policy: 'discussion' };
  const options = {
    executablePath:
      process.env.FS_CHROMIUM_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    fontName: 'Microsoft YaHei',
    fontFile: process.env.FS_FONT_FILE ?? 'C:/Windows/Fonts/msyh.ttc',
  };
  const pdf = await renderPdf(model, manifest, options),
    docx = await renderDocx(model, manifest, { fontName: options.fontName });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 }),
    pdfDoc = await task.promise;
  assert.ok(pdfDoc.numPages >= 3);
  let all = '';
  try {
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const page = await pdfDoc.getPage(n),
        content = await page.getTextContent();
      const text = content.items.map((item) => item.str ?? '').join('');
      all += text;
      assert.match(text, /未批准/, 'each page must retain discussion status');
      if (text.includes('ROW')) assert.match(text, /验收序号/);
      const view = page.getViewport({ scale: 1 });
      const status = content.items.find((item) => item.str?.includes('未批准'));
      if (n > 1)
        assert.ok(
          status && status.transform[5] > view.height - 50,
          JSON.stringify({ page: n, height: view.height, status: status?.transform }),
        );
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        assert.ok(item.transform[4] >= 0 && item.transform[4] + item.width <= view.width + 1);
        assert.ok(item.transform[5] > 0 && item.transform[5] < view.height);
      }
      const viewport = page.getViewport({ scale: 1 }),
        canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      await writeFile(
        `artifacts/fs-workspace/export/long-table-${n}.png`,
        canvas.toBuffer('image/png'),
      );
    }
    for (const row of block.rows)
      for (const cell of [row.cells[0], row.cells[2]]) assert.ok(all.includes(cell), cell);
    await writeFile('artifacts/fs-workspace/export/long-table.pdf', pdf);
    await writeFile('artifacts/fs-workspace/export/long-table.docx', docx);
  } finally {
    await task.destroy();
  }
});
