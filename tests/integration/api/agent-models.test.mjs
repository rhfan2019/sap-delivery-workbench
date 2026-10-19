import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/modules/models/store.mjs';

// docs/specs/agent-workspace-start-and-composer.md 4.3: the composer lists the organization's
// models (default first) and each message runs on the model the user picked.
test('each message runs on the picked model; an unknown model is refused', async () => {
  const seen = [];
  const f = await apiFixture({
    abapFsdAgent: {
      loop: {
        streamChat: async (config, _key, { onDelta }) => {
          seen.push(config.name);
          onDelta?.({ type: 'text', text: '好的。' });
          return {
            content: '好的。',
            reasoning: '',
            toolCalls: [],
            finishReason: 'stop',
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          };
        },
        openSap: async () => ({ available: false, reason: '测试环境不连接 SAP' }),
        wait: async () => {},
      },
    },
  });
  try {
    const { organizationId: org, actorId } = f.scope;
    const model = (name) =>
      saveModel(f.db, org, actorId, {
        name,
        provider: 'Test',
        protocol: 'openai_chat',
        baseUrl: 'https://models.example.com/v1',
        modelId: name.toLowerCase(),
        apiKey: 'test-key-' + name,
      });
    const zeta = await model('Zeta');
    const alpha = await model('Alpha');
    await f.db.query(
      'INSERT INTO app.llm_default(organization_id,model_id,version_id) VALUES($1,$2,$3)',
      [org, zeta.id, zeta.versionId],
    );
    const base = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/abap-fsd-agent`;
    const call = async (method, url, payload) => {
      const res = await f.app.inject({ method, url: base + url, payload, headers: f.headers });
      return { status: res.statusCode, body: res.body, json: () => res.json() };
    };
    const listed = (await call('GET', '/models')).json();
    assert.deepEqual(
      listed.map((m) => [m.name, m.isDefault]),
      [
        ['Zeta', true],
        ['Alpha', false],
      ],
    );
    assert.equal(JSON.stringify(listed).includes('test-key'), false);
    assert.equal('baseUrl' in listed[0], false);

    const sid = (await call('POST', '/sessions', {})).json().id;
    const run = async (payload) => {
      const r = await call('POST', `/sessions/${sid}/messages`, payload);
      assert.equal(r.status, 202, r.body);
      await call('GET', `/sessions/${sid}/turns/${r.json().turnId}/events`);
    };
    await run({ content: '你好' });
    await run({ content: '换个模型', modelId: alpha.id });
    assert.deepEqual(seen, ['Zeta', 'Alpha']);
    const turns = (await call('GET', `/sessions/${sid}`)).json().turns;
    assert.deepEqual(
      turns.map((t) => t.model.name),
      ['Zeta', 'Alpha'],
    );
    const unknown = await call('POST', `/sessions/${sid}/messages`, {
      content: '用不存在的模型',
      modelId: '00000000-0000-4000-8000-000000000000',
    });
    assert.equal(unknown.status, 422);
    assert.equal(unknown.json().code, 'MODEL_UNAVAILABLE');
  } finally {
    await f.close();
  }
});
