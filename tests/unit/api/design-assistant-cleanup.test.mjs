import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDesignUnavailable } from '../../../apps/api/src/modules/design-assistant/unavailable.mjs';
import { registerWorkAgent } from '../../../apps/api/src/modules/item-workspace/agent.mjs';
import { buildContext } from '../../../apps/api/src/modules/item-workspace/development-context.mjs';
import { renderPrompt } from '../../../apps/api/src/modules/item-workspace/development-prompts.mjs';
import { createApp } from '../../../apps/api/src/app.mjs';

test('removed design engines cannot execute, while development routes remain available', async () => {
  const app = Fastify();
  registerDesignUnavailable(app);
  let calls = 0;
  for (const url of [
    '/api/admin/abap-fsd-agent/runs',
    '/api/projects/p/development-items/i/work/design/agent/runs',
    '/api/projects/p/development-items/i/work/design/gem-fsd-v2/runs',
    '/api/projects/p/development-items/i/work/development/agent/runs',
    '/api/projects/p/development-items/i/work/design/models',
  ])
    app.post(url, async () => {
      calls++;
      return { ok: true };
    });
  await app.ready();
  for (const url of [
    '/api/admin/abap-fsd-agent/runs',
    '/api/projects/p/development-items/i/work/design/agent/runs',
    '/api/projects/p/development-items/i/work/design/gem-fsd-v2/runs',
  ]) {
    const response = await app.inject({ method: 'POST', url });
    assert.equal(response.statusCode, 410);
    assert.equal(response.json().code, 'DESIGN_ASSISTANT_REMOVED');
  }
  assert.equal(calls, 0);
  for (const url of [
    '/api/projects/p/development-items/i/work/development/agent/runs',
    '/api/projects/p/development-items/i/work/design/models',
  ])
    assert.equal((await app.inject({ method: 'POST', url })).statusCode, 200);
  assert.equal(calls, 2);
  // Even an unregistered old endpoint must not fall back to an engine.
  assert.equal((await app.inject('/api/admin/abap-fsd-agent/anything')).statusCode, 410);
  await app.close();
});

test('real development routes register without any design engine or prompt package', async () => {
  const app = Fastify();
  registerDesignUnavailable(app);
  let selectedStage;
  registerWorkAgent(app, { query: async () => ({ rows: [] }) }, 'org', async (req) => {
    selectedStage = req.params.stage;
    throw Object.assign(new Error('login required'), { statusCode: 401 });
  });
  await app.ready();
  const prefix = '/api/projects/p/development-items/i/work/';
  assert.equal(
    (await app.inject(prefix + 'development/agent/runs/by-request/abc')).statusCode,
    401,
  );
  assert.equal(selectedStage, 'development');
  assert.equal((await app.inject(prefix + 'design/agent/runs/by-request/abc')).statusCode, 410);
  assert.equal(
    (await app.inject({ method: 'POST', url: prefix + 'development/agent/reset' })).statusCode,
    401,
  );
  assert.equal(
    selectedStage,
    'design',
    'shared reset must still check the design owner independently',
  );
  await app.close();
});

test('development context preserves user answers and budget without loading retired prompts', () => {
  const context = buildContext({
    currentMessage: '开发需求',
    consultantDecisions: [{ question: '处理方式', label: '逐条处理' }],
    systemTargets: { metadata: 'DEV', business: 'QAS' },
  });
  assert.match(context.messages.at(-1).content, /逐条处理/);
  assert.equal(context.manifest.sources.at(-1).id, 'SRC-2000');
  assert.equal(context.manifest.systemTargets.business, 'QAS');
  assert.deepEqual(context.manifest.rules, []);
  assert.match(renderPrompt('development-draft', { schema: '{}' }), /JSON 开发候选/);
  assert.throws(() => renderPrompt('repair'), /Unknown development template/);
  assert.throws(() => buildContext({ currentMessage: '开发需求', budget: 1 }), /预算/);
});

test('whole application boots with retired endpoints blocked and model registry still registered', async () => {
  // Creating the app and checking liveness perform no database writes or provider calls.
  const values = {
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '1',
    POSTGRES_DB: 'cleanup_dev',
    APP_DB_USER: 'unused',
    APP_DB_PASSWORD: 'unused',
    NODE_ENV: 'test',
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  let app;
  try {
    app = await createApp({ organizationId: '00000000-0000-4000-8000-000000000000' });
    await app.ready();
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal((await app.inject('/api/admin/abap-fsd-agent/conversations')).statusCode, 410);
    assert.equal(app.hasRoute({ method: 'GET', url: '/api/admin/models' }), true);
  } finally {
    await app?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
