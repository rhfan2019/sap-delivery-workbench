import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture, etag } from '../fixtures/api.mjs';
import { candidate } from '../fixtures/change.mjs';
test('entity revisions use temporary ID mapping and stale confirmation is invalidated', async () => {
  const f = await apiFixture();
  try {
    const proposal = await candidate(f, f.workspace, [
      {
        op: 'add',
        entity_type: 'rule',
        target_id: 'tmp:rule',
        expected_revision: null,
        before_hash: null,
        value: {
          id: 'tmp:rule',
          revision: 0,
          text: '容差为零',
          classification: 'pending',
          source_refs: [],
          depends_on: [],
        },
        reason: '明确规则',
      },
    ]);
    let result = await f.request(
      'POST',
      `/changes/${proposal.change_set_id}/accept`,
      { base_document_version: f.workspace.draft_head.id, accepted_group_ids: ['all'] },
      { 'idempotency-key': randomUUID(), 'if-match': etag(f.workspace) },
    );
    assert.equal(result.statusCode, 200, result.body);
    let workspace = result.json().data;
    let doc = (await f.request('GET', '/versions/' + workspace.draft_head.id)).json().data;
    const stableId = doc.rule_refs[0];
    assert.match(stableId, /^[a-f0-9-]{36}$/);
    const {
      rows: [entity],
    } = await f.db.query(
      'SELECT e.id,e.head_revision,r.content_hash,r.payload FROM app.fs_entity e JOIN app.fs_entity_revision r ON r.entity_id=e.id AND r.revision=e.head_revision WHERE e.workspace_id=$1 AND e.stable_id=$2',
      [workspace.id, stableId],
    );
    const confirmation = {
      subject_id: stableId,
      subject_revision: '1',
      subject_hash: entity.content_hash,
      context_snapshot_id: doc.context.context_snapshot_id,
      choice_id: 'confirm',
      decision_text: '确认容差为零',
    };
    result = await f.request('POST', '/confirmations', confirmation, {
      'idempotency-key': randomUUID(),
      'if-match': etag(workspace),
    });
    assert.equal(result.statusCode, 201, result.body);
    workspace = result.json().data.workspace;
    const update = await candidate(f, workspace, [
      {
        op: 'replace',
        entity_type: 'rule',
        target_id: stableId,
        expected_revision: 1,
        before_hash: entity.content_hash,
        value: { ...entity.payload, text: '容差为一' },
        reason: '改变财务规则',
      },
    ]);
    result = await f.request(
      'POST',
      `/changes/${update.change_set_id}/accept`,
      { base_document_version: workspace.draft_head.id, accepted_group_ids: ['all'] },
      { 'idempotency-key': randomUUID(), 'if-match': etag(workspace) },
    );
    assert.equal(result.statusCode, 200, result.body);
    workspace = result.json().data;
    const stale = await f.request('POST', '/confirmations', confirmation, {
      'idempotency-key': randomUUID(),
      'if-match': etag(workspace),
    });
    assert.equal(stale.statusCode, 409, stale.body);
    const { rows } = await f.db.query(
      'SELECT action FROM app.fs_confirmation WHERE workspace_id=$1 ORDER BY created_at,id',
      [workspace.id],
    );
    assert.deepEqual(
      rows.map((r) => r.action),
      ['confirm', 'invalidate'],
    );
    doc = (await f.request('GET', '/versions/' + workspace.draft_head.id)).json().data;
    assert.deepEqual(doc.confirmation_refs, []);
    assert.deepEqual(doc.approval_refs, []);
    const latest = {
      ...confirmation,
      subject_revision: '2',
      subject_hash: (
        await f.db.query(
          'SELECT content_hash FROM app.fs_entity_revision WHERE entity_id=$1 AND revision=2',
          [entity.id],
        )
      ).rows[0].content_hash,
      context_snapshot_id: doc.context.context_snapshot_id,
    };
    const reconfirm = await f.request('POST', '/confirmations', latest, {
      'idempotency-key': randomUUID(),
      'if-match': etag(workspace),
    });
    assert.equal(reconfirm.statusCode, 201, reconfirm.body);
    workspace = reconfirm.json().data.workspace;
    const restore = await f.request(
      'POST',
      '/restore',
      {
        source_version_id: f.workspace.draft_head.id,
        base_document_version: workspace.draft_head.id,
        reason: '恢复无规则的历史稿',
      },
      { 'idempotency-key': randomUUID(), 'if-match': etag(workspace) },
    );
    assert.equal(restore.statusCode, 200, restore.body);
    const current = (
      await f.db.query(
        'SELECT r.payload FROM app.fs_entity e JOIN app.fs_entity_revision r ON r.entity_id=e.id AND r.revision=e.head_revision WHERE e.id=$1',
        [entity.id],
      )
    ).rows[0].payload;
    assert.equal(
      current.tombstone,
      true,
      'restoring history cannot leave later entity heads active',
    );
  } finally {
    await f.close();
  }
});
