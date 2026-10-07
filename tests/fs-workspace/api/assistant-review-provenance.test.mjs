import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
const base = '/api/admin/abap-fsd-agent';

test('re-answering an earlier type question stores its own answer and idempotent replay keeps the same run', async () => {
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  let calls = 0;
  const f = await apiFixture({
    agentStream: async (config, key, prompt, options) => {
      if (options.context.manifest.task === 'plan') {
        options.onDelta(
          JSON.stringify({
            tasks: [
              {
                id: 'T1',
                goal: '验证设计',
                dependsOn: [],
                doneWhen: '口径与测试明确',
                entityIds: [],
                needsEvidence: false,
              },
            ],
            scenario: { editable: false, objectFeedback: false },
          }),
        );
        return { modelId: 'test' };
      }

      if (options.context.manifest.task === 'clarification') {
        options.onDelta('{"kind":"ready"}');
        return { modelId: 'test' };
      }
      calls++;
      if (calls === 1)
        options.onDelta(
          JSON.stringify({
            kind: 'clarification',
            questions: [
              {
                title: '业务单位如何展示？',
                options: [
                  { label: '按单位分别展示', description: '保持单位区别' },
                  { label: '暂不确定', description: '保留问题' },
                ],
              },
            ],
          }),
        );
      else if (options.context.manifest.task === 'draft') {
        const spec = JSON.parse(
          readFileSync(
            new URL(
              '../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json',
              import.meta.url,
            ),
            'utf8',
          ),
        );
        spec.sources = options.context.manifest.sources;
        options.onDelta(JSON.stringify(spec));
      } else options.onDelta('继续讨论实际业务要求');
      return { modelId: 'test' };
    },
  });
  try {
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'review-provenance',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'test',
      apiKey: 'synthetic',
      maxOutputTokens: 20000,
      temperature: null,
      timeoutSeconds: 30,
    });
    const request = (method, url, payload) =>
      f.app.inject({ method, url: base + url, payload, headers: f.headers });
    const execute = async (payload) => {
      const res = await request('POST', '/runs', payload);
      assert.equal(res.statusCode, 202, res.body);
      await request('GET', `/runs/${res.json().runId}/events`);
      return (await request('GET', `/runs/${res.json().runId}`)).json();
    };
    const input = {
      modelId: model.id,
      rowVersion: model.rowVersion,
      selection: { projectId: f.scope.projectId, itemId: f.scope.itemId, itemRowVersion: '1' },
      prompt: '梳理业务清单',
      riceType: 'I',
      action: 'draft',
      requestId: randomUUID(),
    };
    const type1 = await execute(input);
    const answer = async (run, values, requestId = randomUUID()) =>
      execute({
        resumeRunId: run.runId,
        requestId,
        decisionAnswer: { decisionId: run.snapshot.decision.id, values },
      });
    const business = await answer(type1, { type: 'R' });
    const saved = await answer(business, { q1: 'o1' });
    assert.ok(saved.artifact);
    const workflowUrl = `/conversations/${saved.conversationId}/workflow`;
    const workflow = (await request('GET', workflowUrl)).json();
    const revision = await request('POST', workflowUrl, {
      command: 'revise',
      expectedVersion: workflow.version,
      requestId: randomUUID(),
    });
    assert.equal(revision.statusCode, 200, revision.body);
    const type2 = await execute({
      ...input,
      conversationId: saved.conversationId,
      requestId: randomUUID(),
    });
    const requestId = randomUUID();
    const dialogue = await answer(type2, { type: 'dialogue' }, requestId);
    const original = (await request('GET', `/runs/${type2.runId}`)).json();
    assert.equal(original.snapshot.answer.length, 1);
    assert.equal(original.snapshot.answer[0].question, '接下来怎样处理？');
    assert.equal(original.snapshot.answer[0].value, 'dialogue');
    const card = original.history.find(
      (message) => message.runId === type2.runId && message.decision,
    );
    assert.equal(card.answers[0].label, '继续需求讨论');
    const before = calls;
    const replay = await answer(type2, { type: 'dialogue' }, requestId);
    assert.equal(replay.runId, dialogue.runId);
    assert.equal(calls, before);
    const conflict = await request('POST', '/runs', {
      resumeRunId: type2.runId,
      requestId,
      decisionAnswer: { decisionId: type2.snapshot.decision.id, values: { type: 'R' } },
    });
    assert.equal(conflict.statusCode, 409);
  } finally {
    await f.close();
  }
});
