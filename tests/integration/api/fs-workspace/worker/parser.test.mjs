import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfBytes } from '../../../../../apps/api/src/modules/fs-workspace/attachments/parser.mjs';
import { syntheticPdf } from '../../../../fixtures/fs-workspace/pdf.mjs';

test('PDF text extraction retains page location and does not invent table columns', async () => {
  const parsed = await parsePdfBytes(syntheticPdf());
  assert.equal(parsed.state, 'complete');
  assert.equal(parsed.coverage.total_pages, 1);
  assert.match(parsed.regions[0].text, /Synthetic business requirement/);
  assert.equal(parsed.regions[0].locator, 'page:1');
  assert.deepEqual(parsed.regions[0].rows, []);
  assert.ok(parsed.warnings.includes('TABLE_LAYOUT_REQUIRES_REVIEW'));
});
test('corrupt PDF and blank scanned page cannot become complete', async () => {
  assert.equal((await parsePdfBytes(Buffer.from('%PDF-broken'))).state, 'failed');
  const empty = await parsePdfBytes(syntheticPdf(''));
  assert.equal(empty.state, 'failed');
  assert.deepEqual(empty.unread_regions, ['page:1']);
  assert.ok(empty.warnings.includes('OCR_UNAVAILABLE'));
});
