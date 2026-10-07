import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
import { createConversation } from '../../../apps/api/src/abap-fsd-agent/repository.mjs';
test('workflow routes scope ownership, optimistic commands and development exclusion', async () => {
  const f = await apiFixture();
  try {
    const { organizationId: org, actorId: actor } = f.scope;
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [org, actor],
    );
    const id = await createConversation(f.db, org, actor, {});
    const call = (method, id, payload) =>
      f.app.inject({
        method,
        url: `/api/admin/abap-fsd-agent/conversations/${id}/workflow`,
        payload,
        headers: f.headers,
      });
    const initial = await call('GET', id);
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().phase, 'analysis');
    const body = { command: 'revise', expectedVersion: '1', requestId: randomUUID() };
    const changed = await call('POST', id, body);
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().version, '2');
    assert.equal((await call('POST', id, body)).json().version, '2');
    assert.equal((await call('POST', id, { ...body, requestId: randomUUID() })).statusCode, 409);
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        call('POST', id, { command: 'revise', expectedVersion: '2', requestId: randomUUID() }),
      ),
    );
    assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 409]);
    const duplicate = { command: 'revise', expectedVersion: '3', requestId: randomUUID() };
    const replayed = await Promise.all([call('POST', id, duplicate), call('POST', id, duplicate)]);
    assert.deepEqual(
      replayed.map((r) => r.statusCode),
      [200, 200],
    );
    assert.deepEqual(
      replayed.map((r) => r.json().version),
      ['4', '4'],
    );
    const revisionId = randomUUID();
    await f.db.query(
      "INSERT INTO app.fsd_agent_revision(id,organization_id,actor_id,conversation_id,revision,spec,markdown,content_hash,evidence,manifest) VALUES($1,$2,$3,$4,1,'{}','','hash','[]','{}')",
      [revisionId, org, actor, id],
    );
    await f.db.query(
      'UPDATE app.fsd_agent_session SET workflow=workflow || $2::jsonb WHERE id=$1',
      [
        id,
        {
          phase: 'draft_review',
          version: '5',
          activeRevisionId: revisionId,
          activeContentHash: 'hash',
          activeRevision: 1,
        },
      ],
    );
    const approve = {
      command: 'approve_draft',
      expectedVersion: '5',
      requestId: randomUUID(),
      revisionId,
      contentHash: 'hash',
    };
    const approvals = await Promise.all([call('POST', id, approve), call('POST', id, approve)]);
    assert.deepEqual(
      approvals.map((r) => r.statusCode),
      [200, 200],
    );
    assert.deepEqual(
      approvals.map((r) => r.json().version),
      ['6', '6'],
    );
    const events = await f.db.query(
      'SELECT count(*)::int AS n FROM app.fsd_agent_workflow_event WHERE conversation_id=$1 AND request_id=$2',
      [id, approve.requestId],
    );
    assert.equal(events.rows[0].n, 1);
    assert.equal((await call('GET', randomUUID())).statusCode, 404);
    const dev = await createConversation(f.db, org, actor, { workspaceStage: 'development' });
    assert.equal((await call('GET', dev)).statusCode, 404);
  } finally {
    await f.close();
  }
});
