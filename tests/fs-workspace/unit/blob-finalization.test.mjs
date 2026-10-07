import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDiscardUpload } from '../../../apps/api/src/fs-workspace/attachments/repository.mjs';
test('unknown commit outcome retains a blob until database ownership can be established', async () => {
  assert.equal(
    await shouldDiscardUpload(
      {
        query: async () => {
          throw new Error('database disconnected');
        },
      },
      'id',
    ),
    false,
  );
  assert.equal(await shouldDiscardUpload({ query: async () => ({ rowCount: 1 }) }, 'id'), false);
  assert.equal(await shouldDiscardUpload({ query: async () => ({ rowCount: 0 }) }, 'id'), true);
});
