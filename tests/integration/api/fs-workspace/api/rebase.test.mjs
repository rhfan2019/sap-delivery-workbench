import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { apiFixture, etag } from '../../../../fixtures/fs-workspace/api.mjs';
import { databaseConfig } from '../../../../../apps/api/src/platform/database.mjs';
import { contentHash } from '../../../../../apps/api/src/modules/fs-workspace/document/ast.mjs';
import { claimRun } from '../../../../../apps/api/src/modules/fs-workspace/runs/queue.mjs';
import { runOne } from '../../../../../apps/api/src/modules/fs-workspace/runs/worker.mjs';
test('rebase worker persists a new candidate without overwriting remote document', async () => {
  const f = await apiFixture(),
    pool = new pg.Pool(databaseConfig({ runtime: true }));
  try {
    const document = (await f.request('GET', '/versions/' + f.workspace.draft_head.id)).json().data;
    const blocks = document.sections.flatMap((s) => s.blocks);
    const propose = async (index, text) =>
      (
        await f.request(
          'POST',
          '/manual-edits',
          {
            base_document_version: document.id,
            block_id: blocks[index].id,
            before_hash: contentHash(blocks[index]),
            new_block: { ...blocks[index], text },
            reason: 'synthetic',
          },
          { 'idempotency-key': randomUUID(), 'if-match': etag(f.workspace) },
        )
      ).json().data;
    const local = await propose(0, 'local text'),
      remote = await propose(1, 'remote text');
    const accepted = await f.request(
      'POST',
      `/changes/${remote.change_set_id}/accept`,
      {
        base_document_version: document.id,
        accepted_group_ids: remote.atomic_groups.map((g) => g.id),
      },
      { 'idempotency-key': randomUUID(), 'if-match': etag(f.workspace) },
    );
    assert.equal(accepted.statusCode, 200, accepted.body);
    const workspace = accepted.json().data;
    const queued = await f.request(
      'POST',
      `/changes/${local.change_set_id}/rebase`,
      { new_base_document_version: workspace.draft_head.id },
      { 'idempotency-key': randomUUID() },
    );
    assert.equal(queued.statusCode, 202, queued.body);
    const lease = await claimRun(pool, 'rebase-test', f.scope.organizationId);
    assert.equal(lease.id, queued.json().data.id);
    const outcome = await runOne(pool, lease);
    assert.equal(outcome.status, 'completed');
    assert.equal(
      (await f.request('GET')).json().data.workspace.draft_head.id,
      workspace.draft_head.id,
    );
    const {
      rows: [checkpoint],
    } = await f.db.query('SELECT output_refs FROM app.fs_run_checkpoint WHERE run_id=$1', [
      lease.id,
    ]);
    const candidate = (await f.request('GET', '/changes/' + checkpoint.output_refs[0])).json().data;
    assert.equal(candidate.context.base_document_version, workspace.draft_head.id);
    assert.equal(candidate.operations[0].value.text, 'local text');
    const current = (await f.request('GET', '/versions/' + workspace.draft_head.id)).json().data;
    assert.equal(current.sections.flatMap((s) => s.blocks)[1].text, 'remote text');
  } finally {
    await pool.end();
    await f.close();
  }
});
