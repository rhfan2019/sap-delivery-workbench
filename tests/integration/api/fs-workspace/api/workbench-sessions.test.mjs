import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../../../fixtures/fs-workspace/api.mjs';

test('workbench sessions expose scoped files and bounded handoff without copying history', async () => {
  const f = await apiFixture();
  const base = f.base.replace('/fs-workspace', '/work/development');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    assert.equal((await req('POST', '', {})).statusCode, 200);
    const created = await req('POST', '/agent/conversations', { selection: {} });
    assert.equal(created.statusCode, 200, created.body);
    const id = created.json().conversationId;
    const run = randomUUID();
    await f.db.query(
      "INSERT INTO app.fsd_agent_run(id,organization_id,actor_id,conversation_id,request_id,request_hash,state,snapshot) VALUES($1,$2,$3,$4,$5,'test','completed',$6)",
      [
        run,
        f.scope.organizationId,
        f.scope.actorId,
        id,
        randomUUID(),
        {
          prompt: '库存冻结时不要自动清账',
          text: '不应该复制到新会话的全文',
          answer: [{ question: '范围', label: '本工厂' }],
        },
      ],
    );
    const a = randomUUID();
    await f.db.query(
      "INSERT INTO app.fsd_agent_attachment(id,organization_id,actor_id,conversation_id,name,bytes,content_hash,state,extraction) VALUES($1,$2,$3,$4,'需求.txt',12,'x','ready',$5)",
      [a, f.scope.organizationId, f.scope.actorId, id, { text: '需求文件内容', warnings: [] }],
    );
    let r = await req('GET', `/sessions/${id}/files`);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().inputs[0].name, '需求.txt');
    r = await req('GET', `/sessions/${id}/files/${a}`);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().extraction.text, '需求文件内容');
    r = await req('POST', '/agent/conversations', { selection: {}, handoffFrom: id });
    assert.equal(r.statusCode, 200, r.body);
    const next = r.json().conversationId;
    const s = (await req('GET', '/sessions')).json().items.find((x) => x.id === next);
    assert.equal(s.context.sourceConversationId, id);
    assert.match(s.context.summary, /库存冻结/);
    assert.doesNotMatch(s.context.summary, /不应该复制/);
    assert.equal((await req('GET', `/sessions/${next}/files`)).json().inputs.length, 0);
    assert.equal(
      (
        await f.db.query('SELECT count(*)::int n FROM app.fsd_agent_run WHERE conversation_id=$1', [
          next,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal((await req('GET', `/sessions/${next}/files/${a}`)).statusCode, 404);
    assert.equal(
      (await req('POST', '/agent/conversations', { selection: {}, handoffFrom: randomUUID() }))
        .statusCode,
      404,
    );
    const other = randomUUID(),
      foreign = randomUUID();
    await f.db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$2)', [
      other,
      'foreign-' + other,
    ]);
    await f.db.query(
      'INSERT INTO app.fsd_agent_session(id,organization_id,actor_id,selection) VALUES($1,$2,$3,$4)',
      [
        foreign,
        f.scope.organizationId,
        other,
        { projectId: f.scope.projectId, itemId: f.scope.itemId, workspaceStage: 'design' },
      ],
    );
    assert.equal((await req('GET', `/sessions/${foreign}/files`)).statusCode, 404);
    assert.equal(
      (await req('POST', '/agent/conversations', { selection: {}, handoffFrom: foreign }))
        .statusCode,
      404,
    );
    const otherStage = f.base.replace('/fs-workspace', '/work/design');
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: otherStage + `/sessions/${id}/files`,
          headers: f.headers,
        })
      ).statusCode,
      404,
    );
  } finally {
    await f.close();
  }
});
