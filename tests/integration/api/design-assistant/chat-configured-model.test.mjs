import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../../scripts/testing/run-tests.mjs';
import { saveModel, getModel } from '../../../../apps/api/src/modules/models/store.mjs';
import { configuredStreamingModel } from '../../../../apps/api/src/modules/design-assistant/model.mjs';
import { hash } from '../../../../apps/api/src/modules/design-assistant/policy.mjs';

test('configured chat provider decrypts frozen model and forwards real incremental protocol with authoritative history', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  const previous = process.env.LLM_CREDENTIAL_KEY;
  process.env.LLM_CREDENTIAL_KEY = 'd'.repeat(64);
  try {
    const scope = await transaction(pool, fixture);
    const saved = await transaction(pool, (db) =>
      saveModel(db, scope.organizationId, scope.actorId, {
        name: 'Chat fixture',
        provider: 'Synthetic',
        protocol: 'openai_chat',
        baseUrl: 'https://example.test/v1',
        modelId: 'chat-fixture',
        apiKey: 'synthetic-chat-secret',
      }),
    );
    const model = await getModel(pool, scope.organizationId, saved.id);
    const history = [
      { role: 'user', content: '采购订单' },
      { role: 'assistant', content: '请确认范围' },
      { role: 'user', content: '只考虑未关闭订单' },
    ];
    const context = {
      pool,
      t: { organization_id: scope.organizationId },
      r: {
        assets: {
          model: { mode: 'REAL', version_id: model.versionId, config_hash: hash(model.config) },
          budget: { model_output_limit: 512 },
        },
        snapshot: {
          text: '只考虑未关闭订单',
          chat_messages: history,
          materials: [{ name: 'scope.txt', text: '固定公司代码' }],
        },
      },
    };
    const chunks = [],
      payloads = [];
    const signal = new AbortController().signal;
    let providerFinished = false;
    const transport = async function* (config, key, payload, options) {
      assert.equal(config.modelId, 'chat-fixture');
      assert.equal(key, 'synthetic-chat-secret');
      assert.equal(options.signal, signal);
      payloads.push(payload);
      yield new TextEncoder().encode(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: '第一段' }, finish_reason: null }] }) +
          '\n\n',
      );
      assert.deepEqual(
        chunks,
        ['第一段'],
        'first delta must reach caller before provider continues',
      );
      yield new TextEncoder().encode(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: '第二段' }, finish_reason: 'stop' }],
            usage: { total_tokens: 17 },
          }) +
          '\n\ndata: [DONE]\n\n',
      );
      providerFinished = true;
    };
    const result = await configuredStreamingModel({
      context,
      signal,
      transport,
      onDelta: async (delta) => {
        assert.equal(providerFinished, false);
        chunks.push(delta);
      },
    });
    assert.equal(result.text, '第一段第二段');
    assert.deepEqual(chunks, ['第一段', '第二段']);
    assert.equal(result.usage.total_tokens, 17);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].stream, true);
    assert.equal(payloads[0].max_completion_tokens, 512);
    assert.equal(payloads[0].messages[0].role, 'system');
    assert.deepEqual(payloads[0].messages.slice(1, 4), history);
    assert.ok(payloads[0].messages.at(-1).content.includes('固定公司代码'));
    let requested = false;
    await assert.rejects(
      () =>
        configuredStreamingModel({
          context: {
            ...context,
            r: {
              ...context.r,
              assets: {
                ...context.r.assets,
                model: { ...context.r.assets.model, config_hash: 'tampered' },
              },
            },
          },
          signal,
          onDelta: () => {},
          transport: async function* () {
            requested = true;
          },
        }),
      (error) => error.code === 'COMPATIBILITY',
    );
    assert.equal(
      requested,
      false,
      'changed frozen configuration must fail before provider transport',
    );
  } finally {
    if (previous === undefined) delete process.env.LLM_CREDENTIAL_KEY;
    else process.env.LLM_CREDENTIAL_KEY = previous;
    await pool.end();
  }
});
