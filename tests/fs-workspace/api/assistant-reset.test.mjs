import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../fixtures/api.mjs';
import { randomUUID } from 'node:crypto';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
test('reset removes both stage versions and conversations without changing item master data', async () => {
  const f = await apiFixture();
  const base = f.base.replace('/fs-workspace', '/work/');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    const d = (await req('POST', 'design', {})).json();
    await f.db.query(
      "INSERT INTO app.fs_message(organization_id,project_id,workspace_id,session_id,seq,client_message_id,role,body,created_by,run_id) SELECT organization_id,project_id,workspace_id,session_id,1,$2,'user','旧版对话',$3,id FROM app.fs_run WHERE workspace_id=$1 LIMIT 1",
      [d.workspaceId, randomUUID(), f.scope.actorId],
    );
    const otherItem = randomUUID();
    await f.db.query(
      "INSERT INTO app.development_item(id,organization_id,project_id,code,name,module,kind,created_by) VALUES($1,$2,$3,'OTHER','Other','FI','report',$4)",
      [otherItem, f.scope.organizationId, f.scope.projectId, f.scope.actorId],
    );
    await f.db.query(
      'INSERT INTO app.fsd_agent_session(id,organization_id,actor_id,selection) VALUES($1,$2,$3,$4)',
      [
        randomUUID(),
        f.scope.organizationId,
        f.scope.actorId,
        { projectId: f.scope.projectId, itemId: otherItem, workspaceStage: 'design' },
      ],
    );
    const v = (await req('POST', 'development', {})).json();
    const otherOwner = randomUUID();
    await f.db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$2)', [
      otherOwner,
      'reset-' + otherOwner,
    ]);
    await f.db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
      f.scope.organizationId,
      otherOwner,
    ]);
    await f.db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [f.scope.organizationId, f.scope.projectId, otherOwner],
    );
    await f.db.query('UPDATE app.development_item SET developer_id=$2 WHERE id=$1', [
      f.scope.itemId,
      otherOwner,
    ]);
    assert.equal((await req('POST', 'development/agent/reset', {})).statusCode, 403);
    assert.equal((await req('GET', 'design')).json().head.id, d.head.id);
    await f.db.query('UPDATE app.development_item SET developer_id=$2 WHERE id=$1', [
      f.scope.itemId,
      f.scope.actorId,
    ]);
    await req('PATCH', 'development', {
      baseVersionId: v.head.id,
      designVersionId: d.head.id,
      document: { ...v.head.document, code: 'REPORT zold.' },
    });
    const s = (await req('POST', 'development/agent/conversations', { selection: {} })).json();
    const reset = await req('POST', 'development/agent/reset', {});
    assert.equal(reset.statusCode, 200, reset.body);
    for (const stage of ['design', 'development']) {
      const state = (await req('GET', stage)).json();
      assert.equal(state.head, null);
      assert.equal(state.versions.length, 0);
      assert.equal((await req('GET', stage + '/sessions')).json().items.length, 0);
    }
    assert.equal((await req('GET', 'design/versions/' + d.head.id)).statusCode, 404);
    assert.equal((await req('GET', 'design/legacy')).json().versions.length, 0);
    assert.deepEqual(
      (await f.db.query('SELECT sections FROM app.fs_draft WHERE item_id=$1', [f.scope.itemId]))
        .rows[0].sections,
      {},
    );
    assert.equal(
      (await req('GET', 'design/sessions/' + s.conversationId + '/files')).statusCode,
      404,
    );
    const clean = (await req('POST', 'design', {})).json();
    assert.equal(clean.item.id, d.item.id);
    assert.equal(clean.head.document.notes, '');
    assert.equal(
      (
        await f.db.query("SELECT id FROM app.fsd_agent_session WHERE selection->>'itemId'=$1", [
          otherItem,
        ])
      ).rowCount,
      1,
    );
  } finally {
    await f.close();
  }
});

test('reset cancels active work and prevents delayed output from recreating a version', async () => {
  let entered;
  const started = new Promise((resolve) => (entered = resolve));
  const f = await apiFixture({
    agentStream: async (_c, _k, _p, o) => {
      assert.equal(o.context.manifest.task, 'development');
      assert.match(o.context.messages.at(-1).content, /生成结构化候选/);
      entered();
      await new Promise((resolve, reject) =>
        o.signal.addEventListener('abort', () => reject(o.signal.reason), { once: true }),
      );
    },
  });
  const base = f.base.replace('/fs-workspace', '/work/');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    const design = (await req('POST', 'design', {})).json();
    await f.db.query("UPDATE app.development_item SET kind='interface' WHERE id=$1", [
      f.scope.itemId,
    ]);
    const dev = (await req('POST', 'development', {})).json();
    await req('PATCH', 'development', {
      baseVersionId: dev.head.id,
      document: dev.head.document,
      designVersionId: design.head.id,
    });
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'Cancel fixture',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'synthetic',
      apiKey: 'synthetic',
      maxOutputTokens: 1000,
      temperature: null,
      timeoutSeconds: 30,
    });
    const r = await req('POST', 'development/agent/runs', {
      modelId: model.id,
      rowVersion: model.rowVersion,
      requestId: randomUUID(),
      prompt: '生成开发内容',
      action: 'auto',
    });
    assert.equal(r.statusCode, 202, r.body);
    await started;
    const live = (
      await req('GET', 'development/agent/runs/' + r.json().runId + '/diagnostics')
    ).json();
    assert.equal(live.state, 'running');
    assert.equal(live.plan.steps.find((s) => s.stepId === 'generate').status, 'running');
    const reset = await req('POST', 'development/agent/reset', {});
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal((await req('GET', 'development/agent/runs/' + r.json().runId)).statusCode, 404);
    assert.equal((await req('GET', 'design')).json().head, null);
  } finally {
    await f.close();
  }
});
