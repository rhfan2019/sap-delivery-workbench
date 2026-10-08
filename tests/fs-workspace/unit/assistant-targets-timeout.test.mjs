import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunStore } from '../../../apps/api/src/abap-fsd-agent/runs.mjs';
import { streamText } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';
import { createProfileResolver } from '../../../apps/api/src/abap-fsd-agent/selection.mjs';
import { buildContext } from '../../../apps/api/src/item-workspace/development-context.mjs';
test('assistant invocation does not require model timeout parameters', async () => {
  let config;
  const store = createRunStore({
    generate: async (c) => {
      config = c;
      return {};
    },
  });
  try {
    const run = store.start({
      owner: { userId: 'u', sessionId: 's' },
      model: { id: 'm', config: {} },
      prompt: 'hi',
      requestId: 'r',
    });
    await run.task;
    assert.equal(Object.hasOwn(config, 'timeoutSeconds'), false);
  } finally {
    store.close();
  }
  await streamText({ protocol: 'openai_chat' }, 'key', 'hi', {
    onDelta() {},
    transport: async function* (c) {
      assert.equal(Object.hasOwn(c, 'timeoutSeconds'), false);
      yield Buffer.from(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
});
test('configured SAP version avoids MCP and preserves its source', async () => {
  const resolve = createProfileResolver({
    pool: {
      query: async () => ({
        rows: [{ id: 'dev', status: 'active', backend_version: 'S4CORE 105 · SAP_BASIS 755' }],
      }),
    },
    org: 'org',
    connect: async () => {
      throw Error('must not connect');
    },
  });
  const result = await resolve(
    null,
    { user: { id: 'u' } },
    { systemId: 'dev', environment: 'DEV' },
  );
  assert.equal(result.identificationSource, 'configuration');
  assert.equal(result.profile.abapRelease, '755');
  assert.equal(result.profile.product, 'SAP S/4HANA');
  assert.equal(result.question, null);
});
test('DEV metadata and QAS business targets remain distinct in context and manifest', () => {
  const systemTargets = {
    DEV: { systemId: 'dev', purpose: 'metadata' },
    QAS: { systemId: 'qas', purpose: 'test_cases' },
  };
  const result = buildContext({ currentMessage: '生成测试案例', systemTargets });
  assert.deepEqual(result.manifest.systemTargets, systemTargets);
  assert.match(result.messages[0].content, /qas/);
});
import { resolveTargetSelection } from '../../../apps/api/src/abap-fsd-agent/selection.mjs';
test('project defaults fill DEV/QAS, overrides stay local and unauthorized systems fail', async () => {
  const db = {
    query: async (sql) => ({
      rows: sql.includes('project_sap_config')
        ? [
            { environment: 'DEV', systemId: 'dev' },
            { environment: 'QAS', systemId: 'qas' },
          ]
        : [{ id: 'dev' }, { id: 'qas' }, { id: 'other' }],
    }),
  };
  const delivery = { access: async () => ({ id: 'p', customer_id: 'c' }) };
  const resolve = (s) =>
    resolveTargetSelection(db, 'o', { user: { id: 'u' } }, { projectId: 'p', ...s }, delivery);
  assert.deepEqual(await resolve({}), {
    projectId: 'p',
    environment: 'DEV',
    systemId: 'dev',
    qasSystemId: 'qas',
  });
  assert.equal((await resolve({ qasSystemId: 'other' })).qasSystemId, 'other');
  await assert.rejects(resolve({ qasSystemId: 'foreign' }), /未授权/);
});
test('missing configured version automatically reads MCP using the selected QAS environment', async () => {
  const { seal } = await import('../../../apps/api/src/sap/crypto.mjs');
  const { binding } = await import('../../../apps/api/src/sap/resolve.mjs');
  const prior = process.env.SAP_CREDENTIAL_KEY;
  process.env.SAP_CREDENTIAL_KEY = 'a'.repeat(64);
  const id = '00000000-0000-4000-8000-000000000001';
  const base = { systemId: id, sapUrl: 'https://sap.example', client: '200', username: 'qa' };
  const row = {
    ...base,
    environment: 'QAS',
    passwordMode: 'override',
    credentialBinding: binding(base),
    passwordCipher: seal('synthetic', JSON.stringify(['o', 'p', 'project', 'QAS'])),
  };
  let calls = 0;
  const pool = {
    query: async (sql) => ({
      rows: sql.includes('SELECT id,status')
        ? [{ id, status: 'active', backend_version: null }]
        : sql.includes('FROM app.sap_system s')
          ? [{ id, sapUrl: base.sapUrl, name: 'QAS' }]
          : sql.includes('app.project_sap_config')
            ? [row]
            : [],
    }),
  };
  try {
    const resolve = createProfileResolver({
      pool,
      org: 'o',
      connect: async (env) => {
        calls++;
        assert.equal(env.SAP_CLIENT, '200');
        return {
          tools: [{ name: 'tableContents' }],
          call: async () => ({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'success',
                  result: [{ COMPONENT: 'SAP_BASIS', RELEASE: '755' }],
                }),
              },
            ],
          }),
          close: async () => {},
        };
      },
    });
    const profile = await resolve(
      { id: 'p', customer_id: 'c' },
      { user: { id: 'u' } },
      { systemId: id, environment: 'QAS' },
    );
    assert.equal(profile.identificationSource, 'mcp');
    assert.equal(profile.profile.abapRelease, '755');
    assert.equal(calls, 1);
  } finally {
    if (prior === undefined) delete process.env.SAP_CREDENTIAL_KEY;
    else process.env.SAP_CREDENTIAL_KEY = prior;
  }
});
test('active assistant survives elapsed wall time and releases reservation on cancel', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const store = createRunStore({
    generate: async (c, k, p, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  });
  try {
    const run = store.start({
      owner: { userId: 'u', sessionId: 's' },
      model: { id: 'm', config: {} },
      prompt: 'hi',
      requestId: 'long',
    });
    run.listeners.add(() => {});
    for (let i = 0; i < 5; i++) await Promise.resolve();
    t.mock.timers.tick(31 * 60 * 1000);
    assert.equal(run.controller.signal.aborted, false);
    store.cancel(run);
    await run.task;
    assert.equal(run.status, 'cancelled');
    store.assertAvailable('m');
  } finally {
    store.close();
    t.mock.timers.reset();
  }
});
