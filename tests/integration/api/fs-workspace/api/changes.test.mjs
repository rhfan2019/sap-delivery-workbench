import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { apiFixture, etag } from '../../../../fixtures/fs-workspace/api.mjs';
import { contentHash } from '../../../../../apps/api/src/modules/fs-workspace/document/ast.mjs';

test('manual edits are reviewable, concurrent accept commits once, restore creates new revision', async () => {
  const f = await apiFixture();
  try {
    const original = (await f.request('GET', '/versions/' + f.workspace.draft_head.id)).json().data;
    const old = original.sections[0].blocks[0],
      body = {
        base_document_version: original.id,
        block_id: old.id,
        before_hash: contentHash(old),
        new_block: { ...old, text: '用户明确的新内容' },
        reason: '人工修订',
      };
    const proposeHeaders = { 'idempotency-key': randomUUID(), 'if-match': etag(f.workspace) };
    const propose = await f.request('POST', '/manual-edits', body, proposeHeaders);
    assert.equal(propose.statusCode, 201, propose.body);
    const change = propose.json().data;
    assert.equal(
      (await f.request('GET')).json().data.workspace.draft_head.id,
      original.id,
      'proposal cannot mutate head',
    );
    const second = await f.request(
      'POST',
      '/manual-edits',
      { ...body, new_block: { ...old, text: '另一个修改' } },
      { ...proposeHeaders, 'idempotency-key': randomUUID() },
    );
    assert.equal(second.statusCode, 201, second.body);
    const acceptBody = {
      base_document_version: original.id,
      accepted_group_ids: change.atomic_groups.map((g) => g.id),
    };
    const acceptHeaders = { 'idempotency-key': randomUUID(), 'if-match': etag(f.workspace) };
    const [a, b] = await Promise.all([
      f.request('POST', `/changes/${change.change_set_id}/accept`, acceptBody, acceptHeaders),
      f.request(
        'POST',
        `/changes/${second.json().data.change_set_id}/accept`,
        { ...acceptBody, accepted_group_ids: second.json().data.atomic_groups.map((g) => g.id) },
        { ...acceptHeaders, 'idempotency-key': randomUUID() },
      ),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
    const successful = a.statusCode === 200 ? a : b;
    const workspace = successful.json().data;
    assert.equal(
      (
        await f.db.query(
          'SELECT count(*)::int AS n FROM app.fs_document_revision WHERE workspace_id=$1',
          [workspace.id],
        )
      ).rows[0].n,
      2,
    );
    if (a.statusCode === 200) {
      assert.equal(
        (
          await f.request(
            'POST',
            `/changes/${change.change_set_id}/accept`,
            acceptBody,
            acceptHeaders,
          )
        ).json().data.draft_head.id,
        workspace.draft_head.id,
      );
    }
    const staleEdit = await f.request('POST', '/manual-edits', body, {
      'idempotency-key': randomUUID(),
      'if-match': etag(workspace),
    });
    assert.equal(staleEdit.statusCode, 409);
    const restore = await f.request(
      'POST',
      '/restore',
      {
        source_version_id: original.id,
        base_document_version: workspace.draft_head.id,
        reason: '恢复',
      },
      { 'idempotency-key': randomUUID(), 'if-match': etag(workspace) },
    );
    assert.equal(restore.statusCode, 200, restore.body);
    const restored = (
      await f.request('GET', '/versions/' + restore.json().data.draft_head.id)
    ).json().data;
    assert.notEqual(restored.id, original.id);
    assert.deepEqual(restored.sections, original.sections);
    assert.deepEqual(restored.approval_refs, []);
    assert.deepEqual((await f.request('GET', '/versions/' + original.id)).json().data, original);
  } finally {
    await f.close();
  }
});
