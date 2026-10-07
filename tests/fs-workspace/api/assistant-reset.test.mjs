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
    assert.equal((await req('POST', 'design/agent/reset', {})).statusCode, 403);
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
    const s = (await req('POST', 'design/agent/conversations', { selection: {} })).json();
    const reset = await req('POST', 'design/agent/reset', {});
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
    const reset = await req('POST', 'design/agent/reset', {});
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal((await req('GET', 'design/agent/runs/' + r.json().runId)).statusCode, 404);
    assert.equal((await req('GET', 'design')).json().head, null);
  } finally {
    await f.close();
  }
});

test('numbered confirmations persist and JSON-to-MD skips provider and preflight with authorized diagnostics', async () => {
  let calls = 0;
  const f = await apiFixture({
    agentStream: async (_c, _k, _p, o) => {
      calls++;
      o.onDelta(
        calls === 1
          ? '1. **审批方式：**\n建议标准方式\n2. **合并规则：**\n依据系统配置'
          : '```json\n{"title":"采购申请点检","scope":{"inScope":["数量和采购组可编辑"]}}\n```',
      );
      return { finishReason: 'stop' };
    },
  });
  const base = f.base.replace('/fs-workspace', '/work/');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    await req('POST', 'design', {});
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'Feedback fixture',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'synthetic',
      apiKey: 'synthetic',
      maxOutputTokens: 20000,
      temperature: null,
      timeoutSeconds: 30,
    });
    let conversationId;
    let run;
    for (const prompt of [
      '采购申请点检需求',
      '问题1：不考虑工作流；\n问题2：依据SAP配置。',
      '请基于JSON生成Markdown格式的FSD',
    ]) {
      const r = await req('POST', 'design/agent/runs', {
        modelId: model.id,
        rowVersion: model.rowVersion,
        requestId: randomUUID(),
        prompt,
        action: 'auto',
        ...(conversationId ? { conversationId } : {}),
      });
      assert.equal(r.statusCode, 202, r.body);
      run = r.json();
      conversationId = run.conversationId;
      await req('GET', 'design/agent/runs/' + run.runId + '/events');
    }
    assert.equal(calls, 2, 'format conversion must never call model');
    const result = (await req('GET', 'design/agent/runs/' + run.runId)).json();
    assert.equal(result.state, 'completed');
    assert.equal(result.snapshot.decisions.length, 2);
    assert.match(JSON.stringify(result.snapshot.decisions), /不考虑工作流/);
    assert.match(result.snapshot.rendered.markdown, /数量和采购组/);
    const md = await req('GET', 'design/agent/runs/' + run.runId + '/markdown');
    assert.equal(md.statusCode, 200);
    assert.match(md.headers['content-type'], /text\/markdown/);
    // Older completed discussion runs have JSON but no persisted reading projection.
    await f.db.query(
      "UPDATE app.fsd_agent_run SET snapshot=(snapshot-'rendered') || jsonb_build_object('text',$2::text) WHERE id=$1",
      [run.runId, JSON.stringify({ title: '历史需求', rules: ['按计划交货日计算'] })],
    );
    const legacyMd = await req('GET', 'design/agent/runs/' + run.runId + '/markdown');
    assert.equal(legacyMd.statusCode, 200, legacyMd.body);
    assert.match(legacyMd.body, /按计划交货日计算/);
    const log = await req('GET', 'design/agent/runs/' + run.runId + '/diagnostics');
    assert.equal(log.statusCode, 200);
    assert.equal(log.json().context.decisions.length, 2);
    assert.equal(
      (await req('GET', 'development/agent/runs/' + run.runId + '/diagnostics')).statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: base + 'design/agent/runs/' + run.runId + '/diagnostics',
        })
      ).statusCode,
      401,
    );
    const reset = await req('POST', 'design/agent/reset', {});
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(
      (await req('GET', 'design/agent/runs/' + run.runId + '/diagnostics')).statusCode,
      404,
    );
  } finally {
    await f.close();
  }
});
