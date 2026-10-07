import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotContext } from '../../../apps/api/src/fs-workspace/changes/entities.mjs';

test('missing or out-of-scope source snapshot cannot return a fabricated context ID', async () => {
  const db = { query: async () => ({ rowCount: 0 }) };
  await assert.rejects(
    snapshotContext(db, {}, { ast: { context: { context_snapshot_id: 'missing' } } }, []),
    /上下文/,
  );
});
