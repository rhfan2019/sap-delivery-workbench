import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
test('message identity preserves one immutable input snapshot and rejects changed replay', async () => {
  const f = await apiFixture();
  try {
    const created = await f.request(
      'POST',
      '/sessions',
      { title: '业务讨论' },
      { 'idempotency-key': randomUUID() },
    );
    assert.equal(created.statusCode, 201, created.body);
    const sessionId = created.json().data.id;
    const body = {
      client_message_id: randomUUID(),
      content: '金额容差为零',
      attachment_ids: [],
      selection: null,
      intent: 'analyze',
    };
    const send = (value) =>
      f.request('POST', `/sessions/${sessionId}/messages`, value, {
        'idempotency-key': randomUUID(),
      });
    const first = await send(body);
    assert.equal(first.statusCode, 202, first.body);
    assert.equal(first.json().data.run.status, 'waiting_evidence');
    assert.equal((await send(body)).json().data.run.id, first.json().data.run.id);
    assert.equal((await send({ ...body, content: '金额容差为一' })).statusCode, 409);
    const snapshot = (
      await f.db.query('SELECT * FROM app.fs_context_snapshot WHERE id=$1', [
        first.json().data.run.input_snapshot_id,
      ])
    ).rows[0];
    assert.equal(
      (await send({ ...body, client_message_id: randomUUID(), content: '下一条消息' })).statusCode,
      202,
    );
    assert.deepEqual(
      (await f.db.query('SELECT * FROM app.fs_context_snapshot WHERE id=$1', [snapshot.id]))
        .rows[0],
      snapshot,
    );
    const messages = await f.request('GET', `/sessions/${sessionId}/messages`);
    assert.equal(messages.json().data.items.length, 2);
  } finally {
    await f.close();
  }
});
