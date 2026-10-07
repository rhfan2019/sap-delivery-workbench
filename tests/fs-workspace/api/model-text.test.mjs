import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
test('model text endpoint enforces administrator, Origin, input and pinned config checks', async () => {
  const prior = process.env.LLM_CREDENTIAL_KEY;
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  const f = await apiFixture();
  try {
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'Text endpoint test',
      provider: 'Synthetic',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'test',
      apiKey: 'synthetic-not-live',
      maxOutputTokens: 1000,
      temperature: null,
      timeoutSeconds: 5,
    });
    const request = (payload, extra = {}, id = model.id) =>
      f.app.inject({
        method: 'POST',
        url: '/api/admin/models/' + id + '/generate-text',
        headers: { ...f.headers, ...extra },
        payload,
      });
    const input = { rowVersion: model.rowVersion, prompt: '你好，请问你的模型是什么？' };
    assert.equal((await request(input)).statusCode, 403);
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    assert.equal((await request(input, { origin: 'https://untrusted.example' })).statusCode, 403);
    assert.equal((await request({ ...input, prompt: '' })).statusCode, 400);
    assert.equal((await request({ ...input, apiKey: 'forbidden' })).statusCode, 400);
    assert.equal((await request({ ...input, rowVersion: '999' })).statusCode, 409);
    assert.equal((await request(input, {}, randomUUID())).statusCode, 404);
  } finally {
    await f.close();
    if (prior === undefined) delete process.env.LLM_CREDENTIAL_KEY;
    else process.env.LLM_CREDENTIAL_KEY = prior;
  }
});
