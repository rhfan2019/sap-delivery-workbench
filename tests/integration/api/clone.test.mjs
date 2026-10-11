import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../fixtures/api.mjs';
test('clone endpoint is idempotent, isolated and permission checked', async () => {
  const f = await apiFixture();
  try {
    const url = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/test-copy`;
    const payload = { prefix: '261006-200000-', requestId: randomUUID() };
    const first = await f.app.inject({ method: 'POST', url, headers: f.headers, payload });
    assert.equal(first.statusCode, 201, first.body);
    const c = first.json();
    assert.equal(c.code, '261006-200000-I');
    assert.notEqual(c.id, f.scope.itemId);
    const again = await f.app.inject({ method: 'POST', url, headers: f.headers, payload });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().id, c.id);
    assert.equal(
      (await f.app.inject({ method: 'POST', url, headers: { origin: f.headers.origin }, payload }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url,
          headers: f.headers,
          payload: { ...payload, prefix: '261007-200000-' },
        })
      ).statusCode,
      409,
    );
    const {
      rows: [counts],
    } = await f.db.query(
      'SELECT (SELECT count(*) FROM app.development_file WHERE item_id=$1::uuid) attachments',
      [c.id],
    );
    assert.equal(counts.attachments, '0');
  } finally {
    await f.close();
  }
});
