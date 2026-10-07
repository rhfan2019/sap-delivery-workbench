import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
import { sha256 } from '../../../apps/api/src/abap-fsd-agent/specification.mjs';
const base = '/api/admin/abap-fsd-agent';
test('S04-S08 owned session: draft publication, provenance, attachment isolation and legacy preservation', async () => {
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  let output = readFileSync(
      new URL('../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
      'utf8',
    ),
    received;
  const f = await apiFixture({
    agentStream: async (c, k, p, o) => {
      if (o.context?.manifest?.task === 'plan') {
        o.onDelta(
          JSON.stringify({
            tasks: [
              {
                id: 'T1',
                goal: '设计报表',
                dependsOn: [],
                doneWhen: '字段与测试明确',
                entityIds: [],
                needsEvidence: false,
              },
            ],
            scenario: { editable: false, objectFeedback: false },
          }),
        );
        return { modelId: c.modelId };
      }
      if (o.context?.manifest?.task === 'clarification') {
        o.onDelta('{"kind":"ready"}');
        return { modelId: c.modelId };
      }
      received = o.context;
      let payload = output;
      try {
        const draft = JSON.parse(output);
        draft.sources = o.context.manifest.sources;
        payload = JSON.stringify(draft);
      } catch {}
      o.onDelta(payload);
      return { modelId: c.modelId };
    },
  });
  try {
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    const m = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'S08',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'test',
      apiKey: 'synthetic',
      maxOutputTokens: 20000,
      temperature: null,
      timeoutSeconds: 30,
    });
    const req = (method, url, payload, headers = {}) =>
      f.app.inject({ method, url: base + url, payload, headers: { ...f.headers, ...headers } });
    const selection = { projectId: f.scope.projectId, itemId: f.scope.itemId, itemRowVersion: '1' };
    const old = (
      await f.db.query('SELECT sections FROM app.fs_draft WHERE item_id=$1', [f.scope.itemId])
    ).rows;
    const session = await req('POST', '/conversations', { selection });
    assert.equal(session.statusCode, 200, session.body);
    const id = session.json().conversationId;
    const boundary = 'fsd-test';
    const file = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="unique.csv"\r\nContent-Type: text/csv\r\n\r\nid,value\nA,UNIQUE-S08-813\r\n--${boundary}--\r\n`,
    );
    const uploaded = await req('POST', `/conversations/${id}/attachments`, file, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const a = uploaded.json();
    assert.equal(a.state, 'ready');
    const body = {
      modelId: m.id,
      rowVersion: m.rowVersion,
      requestId: randomUUID(),
      selection,
      conversationId: id,
      prompt: '采购申请报表',
      riceType: 'R',
      action: 'draft',
      attachmentIds: [a.id],
    };
    const [created, replayed] = await Promise.all([
      req('POST', '/runs', body),
      req('POST', '/runs', body),
    ]);
    assert.equal(created.statusCode, 202, created.body);
    assert.equal(replayed.statusCode, 202, replayed.body);
    assert.equal(created.json().runId, replayed.json().runId);
    const events = await req('GET', `/runs/${created.json().runId}/events`);
    assert.match(events.body, /artifact.ready/);
    assert.match(events.body, /run.completed/);
    assert.match(JSON.stringify(received), /UNIQUE-S08-813/);
    const {
      rows: [rev],
    } = await f.db.query('SELECT * FROM app.fsd_agent_revision WHERE run_id=$1', [
      created.json().runId,
    ]);
    assert.ok(rev);
    assert.equal(sha256(rev.spec), rev.content_hash);
    const got = await req('GET', '/artifacts/' + rev.id);
    assert.equal(got.statusCode, 200);
    assert.equal(got.json().contentHash, rev.content_hash);
    const ordinary = await req('POST', '/runs', {
      ...body,
      requestId: randomUUID(),
      prompt: '说明附件中的需求范围',
      action: 'dialogue',
      attachmentIds: [],
    });
    assert.equal(ordinary.statusCode, 202, ordinary.body);
    await req('GET', `/runs/${ordinary.json().runId}/events`);
    assert.match(
      JSON.stringify(received),
      /UNIQUE-S08-813/,
      'ordinary follow-up after refresh inherits the session attachment',
    );
    const wrong = await req('POST', '/runs', {
      ...body,
      requestId: randomUUID(),
      conversationId: randomUUID(),
    });
    assert.equal(
      wrong.statusCode,
      404,
      'session ownership is checked before reading attachments or history',
    );
    await req('DELETE', `/conversations/${id}/attachments/${a.id}`);
    assert.equal(
      (await req('POST', '/runs', { ...body, requestId: randomUUID() })).statusCode,
      409,
    );
    output = '{"riceType":"R"';
    const workflow = (await req('GET', `/conversations/${id}/workflow`)).json();
    assert.equal(
      (
        await req('POST', `/conversations/${id}/workflow`, {
          command: 'revise',
          expectedVersion: workflow.version,
          requestId: randomUUID(),
        })
      ).statusCode,
      200,
    );
    const invalid = await req('POST', '/runs', {
      ...body,
      requestId: randomUUID(),
      attachmentIds: [],
    });
    assert.equal(invalid.statusCode, 202);
    const bad = await req('GET', `/runs/${invalid.json().runId}/events`);
    assert.match(bad.body, /run.failed/);
    assert.doesNotMatch(bad.body, /artifact.ready/);
    const failedState = (await req('GET', `/runs/${invalid.json().runId}`)).json();
    assert.equal(failedState.artifact, null);
    assert.equal(failedState.latestArtifact.id, rev.id);
    assert.equal(failedState.artifacts.length, 1);
    assert.equal(
      (
        await f.db.query(
          'SELECT count(*)::int AS n FROM app.fsd_agent_revision WHERE conversation_id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    );
    assert.deepEqual(
      (await f.db.query('SELECT sections FROM app.fs_draft WHERE item_id=$1', [f.scope.itemId]))
        .rows,
      old,
    );
  } finally {
    await f.close();
  }
});
