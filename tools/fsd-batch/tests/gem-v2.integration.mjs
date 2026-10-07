import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { apiFixture } from '../../../tests/fs-workspace/fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
import { createRecorder } from '../lib/recorder.mjs';
const document =
  Array.from(
    { length: 9 },
    (_, i) => `## 第${i + 1}章：测试章节\n\n本章描述当前业务范围、有效条件及可核对的预期结果。`,
  ).join('\n\n') + '\n<!-- FSD_V2_END -->';
test('v2 API saves once, scopes access, cancels and preserves legacy documents', async () => {
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  let calls = 0,
    hang = false,
    clarification = 0,
    received;
  const f = await apiFixture({
    agentStream: async (m, k, p, o) => {
      calls++;
      received = o.context;
      if (hang) return new Promise(() => {});
      if (clarification) {
        o.onDelta(
          JSON.stringify({
            kind: 'clarification',
            questions: [
              {
                id: 'q' + clarification,
                question: '第' + clarification + '次业务问题',
                impact: '改变颗粒度',
              },
            ],
          }),
        );
        return {};
      }
      o.onDelta(document);
      return { finishReason: 'stop' };
    },
  });
  const base = f.base.replace('/fs-workspace', '/work/design/gem-fsd-v2');
  const req = (method, path = '', payload, headers = f.headers) =>
    f.app.inject({ method, url: base + path, payload, headers });
  try {
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'v2 test',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'synthetic',
      apiKey: 'synthetic',
      maxOutputTokens: 20000,
      temperature: null,
      timeoutSeconds: 30,
    });
    await f.db.query(
      'INSERT INTO app.llm_default(organization_id,model_id,version_id) VALUES($1,$2,$3)',
      [f.scope.organizationId, model.id, model.versionId],
    );
    const old = (
      await f.db.query('SELECT sections FROM app.fs_draft WHERE item_id=$1', [f.scope.itemId])
    ).rows;
    const body = { requestId: randomUUID(), answers: '测试口径' };
    createRecorder({ runId: body.requestId }).write('legacy.secret', {
      text: 'FOREIGN_LEGACY_DATA',
    });
    let r = await req('POST', '/runs', body);
    assert.equal(r.statusCode, 202, r.body);
    for (let i = 0; i < 100; i++) {
      r = await req('GET', '/runs/' + body.requestId);
      if (r.json().state !== 'running') break;
      await delay(20);
    }
    assert.equal(r.json().state, 'completed', r.body);
    assert.equal(r.json().contentHash.length, 64);
    assert.ok(r.json().markdown);
    assert.ok(
      !(await req('GET', '/runs/' + body.requestId + '/trace')).body.includes(
        'FOREIGN_LEGACY_DATA',
      ),
    );
    assert.equal((await req('POST', '/runs', body)).statusCode, 200);
    assert.equal(calls, 1);
    assert.equal((await req('POST', '/runs', { ...body, answers: 'different' })).statusCode, 409);
    assert.equal(
      (await req('GET', '/runs/' + body.requestId, undefined, { origin: f.headers.origin }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await req('POST', '/runs', {
          requestId: randomUUID(),
          parentId: body.requestId,
          answers: 'foreign',
        })
      ).statusCode,
      409,
    );
    hang = true;
    const stop = { requestId: randomUUID() };
    assert.equal((await req('POST', '/runs', stop)).statusCode, 202);
    assert.equal(
      (await req('POST', '/runs/' + stop.requestId + '/cancel', {})).json().state,
      'cancelled',
    );
    assert.equal(calls, 2);
    hang = false;
    clarification = 1;
    async function round(parentId, answers) {
      const requestId = randomUUID();
      const response = await req('POST', '/runs', { requestId, parentId, answers });
      assert.equal(response.statusCode, 202, response.body);
      for (let i = 0; i < 100; i++) {
        const current = (await req('GET', '/runs/' + requestId)).json();
        if (current.state !== 'running') return current;
        await delay(20);
      }
      throw new Error('round did not settle');
    }
    const first = await round(undefined, '开始');
    assert.equal(first.state, 'waiting_user');
    clarification = 2;
    const second = await round(first.runId, '是');
    assert.equal(second.state, 'waiting_user');
    clarification = 0;
    const third = await round(second.runId, '按第二项');
    assert.equal(third.state, 'completed');
    assert.ok(JSON.stringify(received).includes('第1次业务问题'));
    assert.ok(JSON.stringify(received).includes('第2次业务问题'));
    assert.deepEqual(
      (await f.db.query('SELECT sections FROM app.fs_draft WHERE item_id=$1', [f.scope.itemId]))
        .rows,
      old,
    );
  } finally {
    await f.close();
  }
});
