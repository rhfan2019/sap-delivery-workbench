import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture, etag } from '../../../../fixtures/fs-workspace/api.mjs';
import { documentHash } from '../../../../../apps/api/src/modules/fs-workspace/document/ast.mjs';

test('immutable document snapshots enforce If-Match, replay and scoped reads', async () => {
  const f = await apiFixture();
  try {
    const head = f.workspace.draft_head.id;
    const original = await f.request('GET', '/versions/' + head);
    assert.equal(original.statusCode, 200, original.body);
    const {
      rows: [pinned],
    } = await f.db.query(
      'SELECT to_jsonb(t) AS template FROM app.fs_document_revision d JOIN app.fs_template_version t ON t.id=d.template_version_id WHERE d.id=$1',
      [head],
    );
    assert.equal(
      original.json().data.content_hash,
      documentHash(original.json().data, pinned.template),
      'new imports use the same canonical content hash as subsequent revisions',
    );
    const body = { base_document_version: head, note: '保存讨论稿' };
    const missing = await f.request('POST', '/versions', body, { 'idempotency-key': randomUUID() });
    assert.equal(missing.statusCode, 428, missing.body);
    const headers = { 'idempotency-key': randomUUID(), 'if-match': etag(f.workspace) };
    const save = () => f.request('POST', '/versions', body, headers);
    const first = await save();
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(
      (await save()).json().data.id,
      first.json().data.id,
      'lost response replay despite old If-Match',
    );
    const stale = await f.request('POST', '/versions', body, {
      ...headers,
      'idempotency-key': randomUUID(),
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.deepEqual(
      (await f.request('GET', '/versions/' + head)).json().data,
      original.json().data,
    );
    const saved = (await f.request('GET', '/versions/' + first.json().data.id)).json().data;
    assert.equal(saved.version_number, 1);
    assert.equal(saved.lifecycle, 'draft');
    assert.deepEqual(saved.approval_refs, []);
    assert.equal((await f.request('GET', '/versions/' + randomUUID())).statusCode, 404);
    const list = await f.request('GET', '/versions?limit=1');
    assert.equal(list.json().data.items.length, 1);
    assert.ok(list.json().data.next_cursor);
    const receipt = await f.request(
      'GET',
      `/commands/${headers['idempotency-key']}?action=snapshotFsVersion`,
    );
    assert.equal(receipt.json().data.state, 'committed');
    assert.ok(receipt.json().data.result_ids.includes(first.json().data.id));
  } finally {
    await f.close();
  }
});
