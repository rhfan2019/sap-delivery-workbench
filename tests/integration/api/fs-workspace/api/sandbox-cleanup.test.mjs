import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../../../fixtures/fs-workspace/api.mjs';
import { clearSandboxHistory } from '../../../../../apps/api/src/modules/item-workspace/clear-sandbox.mjs';
test('sandbox cleanup removes conversations but preserves stage runs and referenced immutable artifacts', async () => {
  const f = await apiFixture();
  try {
    const base = f.base.replace('/fs-workspace', '/work/development');
    await f.app.inject({ method: 'POST', url: base, payload: {}, headers: f.headers });
    const session = randomUUID(),
      run = randomUUID(),
      artifact = randomUUID();
    await f.db.query(
      'INSERT INTO app.fsd_agent_session(id,organization_id,actor_id,selection) VALUES($1,$2,$3,$4)',
      [session, f.scope.organizationId, f.scope.actorId, { itemId: f.scope.itemId }],
    );
    await f.db.query(
      "INSERT INTO app.fsd_agent_run(id,organization_id,actor_id,conversation_id,request_id,request_hash,state,snapshot) VALUES($1,$2,$3,$4,$5,'x','completed',$6)",
      [
        run,
        f.scope.organizationId,
        f.scope.actorId,
        session,
        randomUUID(),
        { prompt: '测试隐私', text: '测试回答' },
      ],
    );
    await f.db.query(
      "INSERT INTO app.fsd_agent_revision(id,organization_id,actor_id,conversation_id,run_id,revision,spec,markdown,content_hash,evidence,manifest) VALUES($1,$2,$3,$4,$5,1,'{}','saved','hash','{}','{}')",
      [artifact, f.scope.organizationId, f.scope.actorId, session, run],
    );
    await f.db.query(
      'UPDATE app.item_work_version SET source_artifact_id=$1 WHERE workspace_id=$2',
      [artifact, f.workspace.id],
    );
    const stage = (
      await f.app.inject({
        method: 'POST',
        url: base + '/agent/conversations',
        payload: { selection: {} },
        headers: f.headers,
      })
    ).json().conversationId;
    await f.db.query("UPDATE app.fsd_agent_run SET state='running' WHERE id=$1", [run]);
    await assert.rejects(clearSandboxHistory(f.db, f.scope.organizationId), /still active/);
    assert.equal(
      (await f.db.query('SELECT snapshot FROM app.fsd_agent_run WHERE id=$1', [run])).rows[0]
        .snapshot.prompt,
      '测试隐私',
    );
    await f.db.query("UPDATE app.fsd_agent_run SET state='completed' WHERE id=$1", [run]);
    await clearSandboxHistory(f.db, f.scope.organizationId);
    assert.equal(
      (await f.db.query('SELECT snapshot FROM app.fsd_agent_run WHERE id=$1', [run])).rows[0]
        .snapshot.prompt,
      undefined,
    );
    assert.equal(
      (await f.db.query('SELECT markdown FROM app.fsd_agent_revision WHERE id=$1', [artifact]))
        .rows[0].markdown,
      'saved',
    );
    assert.ok(
      (await f.db.query('SELECT cleared_at FROM app.fsd_agent_session WHERE id=$1', [session]))
        .rows[0].cleared_at,
    );
    assert.equal(
      (await f.db.query('SELECT cleared_at FROM app.fsd_agent_session WHERE id=$1', [stage]))
        .rows[0].cleared_at,
      null,
    );
    assert.equal(
      (await f.app.inject({ method: 'GET', url: base + '/sessions', headers: f.headers })).json()
        .items.length,
      1,
    );
  } finally {
    await f.close();
  }
});
