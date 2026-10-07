import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
const base = '/api/admin/abap-fsd-agent/runs';
test('agent API enforces policy and streams cancellable owned runs without plaintext audit', async () => {
  const prior = process.env.LLM_CREDENTIAL_KEY;
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  let upstreamCancelled = false;
  const f = await apiFixture({
    agentStream: async (config, key, prompt, { signal, onDelta }) => {
      assert.equal(key, 'synthetic-key');
      onDelta('真实流接口的合成分块');
      if (prompt === 'cancel-me')
        await new Promise((resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              upstreamCancelled = true;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      return { modelId: config.modelId, latencyMs: 10 };
    },
  });
  try {
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'S01 synthetic',
      provider: 'Synthetic',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'synthetic',
      apiKey: 'synthetic-key',
      maxOutputTokens: 500,
      temperature: null,
      timeoutSeconds: 5,
    });
    const input = {
      modelId: model.id,
      rowVersion: model.rowVersion,
      prompt: 'cancel-me',
      requestId: randomUUID(),
    };
    const post = (body, headers = f.headers) =>
      f.app.inject({ method: 'POST', url: base, headers, payload: body });
    assert.equal((await post(input)).statusCode, 403);
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    assert.equal(
      (await post(input, { ...f.headers, origin: 'https://bad.example' })).statusCode,
      403,
    );
    assert.equal((await post({ ...input, prompt: '' })).statusCode, 400);
    assert.equal((await post({ ...input, rowVersion: '999' })).statusCode, 409);
    assert.equal((await post({ ...input, apiKey: 'forbidden' })).statusCode, 400);
    const created = await post(input);
    assert.equal(created.statusCode, 202, created.body);
    const runId = created.json().runId;
    assert.equal((await post(input)).json().runId, runId);
    assert.equal((await post({ ...input, prompt: 'changed' })).statusCode, 409);
    assert.equal((await post({ ...input, requestId: randomUUID() })).statusCode, 409);
    assert.equal(
      (await f.app.inject({ method: 'GET', url: `${base}/${runId}/events` })).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: `${base}/${runId}/events`,
          headers: { ...f.headers, origin: 'https://bad.example' },
        })
      ).statusCode,
      403,
    );
    const cancel = await f.app.inject({
      method: 'POST',
      url: `${base}/${runId}/cancel`,
      headers: f.headers,
      payload: {},
    });
    assert.equal(cancel.json().status, 'cancelled');
    assert.equal(upstreamCancelled, true);
    const result = await f.app.inject({
      method: 'GET',
      url: `${base}/${runId}/events`,
      headers: f.headers,
    });
    assert.equal(result.statusCode, 200);
    assert.match(result.headers['content-type'], /text\/event-stream/);
    assert.match(result.body, /message.delta/);
    assert.match(result.body, /run.cancelled/);
    assert.doesNotMatch(result.body, /run.completed/);
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: `${base}/${runId}/events?afterSeq=999`,
          headers: f.headers,
        })
      ).statusCode,
      400,
    );
    const done = await post({ ...input, prompt: 'normal', requestId: randomUUID() });
    assert.equal(done.statusCode, 202, done.body);
    const complete = await f.app.inject({
      method: 'GET',
      url: done.json().eventsUrl,
      headers: f.headers,
    });
    assert.match(complete.body, /run.completed/);
    const audit = await f.db.query(
      "SELECT * FROM app.audit_event WHERE organization_id=$1 AND action='abap_fsd_agent.run.start'",
      [f.scope.organizationId],
    );
    assert.ok(audit.rowCount);
    assert.doesNotMatch(JSON.stringify(audit.rows), /cancel-me|synthetic-key|合成分块/);
  } finally {
    await f.close();
    if (prior === undefined) delete process.env.LLM_CREDENTIAL_KEY;
    else process.env.LLM_CREDENTIAL_KEY = prior;
  }
});
