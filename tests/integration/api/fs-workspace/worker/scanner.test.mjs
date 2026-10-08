import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanAttachment,
  classifyScan,
} from '../../../../../apps/api/src/modules/fs-workspace/attachments/scanner.mjs';

test('unconfigured scanner fails closed without accessing attachment contents', async () => {
  assert.deepEqual(await scanAttachment('unused', { executable: null }), {
    state: 'failed',
    code: 'SCANNER_UNAVAILABLE',
  });
});
test('scanner errors and incomplete receipts can never grant clean status', () => {
  assert.equal(classifyScan(2, 'Scanned files: 0\nInfected files: 0').state, 'failed');
  assert.equal(classifyScan(0, '').state, 'failed');
  assert.equal(classifyScan(0, 'Scanned files: 0\nInfected files: 0').state, 'failed');
  assert.equal(classifyScan(0, 'Scanned files: 1\nInfected files: 0').state, 'clean');
  assert.equal(classifyScan(1, 'Scanned files: 1\nInfected files: 1').state, 'rejected');
});
