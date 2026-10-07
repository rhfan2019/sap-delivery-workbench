import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
test('durable decisions resume original inputs once, carry consultant answers and publish only real artifacts', async () => {
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  let calls = 0,
    received;
  const f = await apiFixture({
    agentStream: async (c, k, p, o) => {
      if (o.context.manifest.task === 'plan') {
        o.onDelta(
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

      if (o.context?.manifest?.task === 'clarification') {
        o.onDelta('{"kind":"ready"}');
        return { modelId: c.modelId };
      }
      calls++;
      received = { p, context: o.context };
      if (calls === 1) {
        o.onDelta(
          '我需要先确认业务口径。\n' +
            JSON.stringify({
              kind: 'clarification',
              questions: [
                {
                  title: '不同单位怎样合计？',
                  options: [
                    { label: '按单位分别合计（建议）', description: '不跨单位相加' },
                    { label: '暂不确定', description: '保留待确认' },
                  ],
                },
              ],
            }),
        );
      } else {
        const spec = JSON.parse(
          readFileSync(
            new URL(
              '../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json',
              import.meta.url,
            ),
            'utf8',
          ),
        );
        spec.sources = o.context.manifest.sources;
        o.onDelta(JSON.stringify(spec));
      }
      return { modelId: c.modelId };
    },
  });
  try {
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    const m = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'decision-test',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'test',
      apiKey: 'synthetic',
      maxOutputTokens: 20000,
      temperature: null,
      timeoutSeconds: 30,
    });
    const req = (method, url, payload) =>
      f.app.inject({ method, url: '/api/admin/abap-fsd-agent' + url, payload, headers: f.headers });
    const body = {
      modelId: m.id,
      rowVersion: m.rowVersion,
      requestId: randomUUID(),
      selection: { projectId: f.scope.projectId, itemId: f.scope.itemId, itemRowVersion: '1' },
      prompt: '请梳理采购订单执行情况',
      riceType: 'I',
      action: 'draft',
    };
    const r = await req('POST', '/runs', body);
    assert.equal(r.statusCode, 202, r.body);
    const id = r.json().runId;
    const events = await req('GET', `/runs/${id}/events`);
    assert.match(events.body, /run.waiting_user/);
    assert.doesNotMatch(events.body, /run.completed|artifact.ready/);
    assert.equal(calls, 0);
    const saved = await req('GET', `/runs/${id}`);
    assert.equal(saved.json().state, 'waiting_user');
    assert.equal(saved.json().artifact, null);
    assert.equal(saved.json().snapshot.plan.steps[1].status, 'queued');
    const answer = {
      resumeRunId: id,
      requestId: randomUUID(),
      decisionAnswer: { decisionId: saved.json().snapshot.decision.id, values: { type: 'R' } },
    };
    const [a, b] = await Promise.all([req('POST', '/runs', answer), req('POST', '/runs', answer)]);
    assert.equal(a.statusCode, 202, a.body);
    assert.equal(b.statusCode, 202, b.body);
    assert.equal(a.json().runId, b.json().runId);
    const second = a.json().runId;
    const ev = await req('GET', `/runs/${second}/events`);
    assert.match(ev.body, /run.waiting_user/);
    assert.equal(calls, 1);
    const raw = (await req('GET', `/runs/${second}`)).json().snapshot.rawOutput;
    assert.match(raw, /我需要先确认业务口径/);
    const again = await req('POST', '/runs', { ...answer, requestId: randomUUID() });
    assert.equal(again.statusCode, 409);
    const q = (await req('GET', `/runs/${second}`)).json();
    const bad = await req('POST', '/runs', {
      resumeRunId: second,
      requestId: randomUUID(),
      decisionAnswer: { decisionId: q.snapshot.decision.id, values: { q1: 'not-an-option' } },
    });
    assert.equal(bad.statusCode, 400);
    const final = await req('POST', '/runs', {
      resumeRunId: second,
      requestId: randomUUID(),
      decisionAnswer: { decisionId: q.snapshot.decision.id, values: { q1: 'o1' } },
    });
    assert.equal(final.statusCode, 202, final.body);
    const done = await req('GET', `/runs/${final.json().runId}/events`);
    assert.match(done.body, /artifact.ready/);
    assert.match(done.body, /run.completed/);
    assert.equal(calls, 2);
    assert.equal(received.p, body.prompt);
    assert.match(JSON.stringify(received.context), /按单位分别合计/);
    assert.equal(final.json().conversationId, r.json().conversationId);
    const restored = (await req('GET', `/runs/${final.json().runId}`)).json();
    assert.ok(restored.artifact?.id);
    assert.equal(restored.snapshot.decisions.length, 2);
    assert.equal(
      restored.artifact.spec.sources.filter((s) => s.reference.startsWith('decision:')).length,
      2,
    );
    assert.equal((await req('GET', `/runs/${id}`)).json().snapshot.resolvedRunId, second);
    const workflowUrl = `/conversations/${r.json().conversationId}/workflow`;
    const revise = async () => {
      const state = (await req('GET', workflowUrl)).json();
      const result = await req('POST', workflowUrl, {
        command: 'revise',
        expectedVersion: state.version,
        requestId: randomUUID(),
      });
      assert.equal(result.statusCode, 200, result.body);
    };
    await revise();
    const retried = await req('POST', '/runs', {
      retryRunId: final.json().runId,
      requestId: randomUUID(),
    });
    assert.equal(retried.statusCode, 202, retried.body);
    const repeatEvents = await req('GET', `/runs/${retried.json().runId}/events`);
    assert.match(repeatEvents.body, /artifact.ready/);
    assert.match(JSON.stringify(received.context), /按单位分别合计/);
    assert.equal(received.context.manifest.consultantDecisions.length, 2);
    await revise();
    const followup = await req('POST', '/runs', {
      ...body,
      riceType: 'R',
      conversationId: r.json().conversationId,
      prompt: '补充工厂字段说明',
      requestId: randomUUID(),
    });
    assert.equal(followup.statusCode, 202, followup.body);
    await req('GET', `/runs/${followup.json().runId}/events`);
    assert.equal(
      received.context.manifest.consultantDecisions.length,
      2,
      'ordinary follow-up inherits answers',
    );
    const beforeAck = calls;
    const ack = await req('POST', '/runs', {
      ...body,
      riceType: 'R',
      conversationId: r.json().conversationId,
      prompt: '确认，请继续',
      requestId: randomUUID(),
    });
    assert.equal(ack.statusCode, 409, 'natural-language acknowledgement cannot approve a revision');
    assert.equal(calls, beforeAck);
    const workflow = (await req('GET', workflowUrl)).json();
    const approval = await req('POST', workflowUrl, {
      command: 'approve_draft',
      expectedVersion: workflow.version,
      requestId: randomUUID(),
      revisionId: workflow.activeRevisionId,
      contentHash: workflow.activeContentHash,
    });
    assert.equal(approval.statusCode, 200, approval.body);
    assert.equal(approval.json().phase, 'refining');
    const state = (await req('GET', `/runs/${followup.json().runId}`)).json();
    assert.ok(state.latestArtifact?.id);
    assert.equal(state.artifacts.length, 3);
    assert.equal(state.history.filter((m) => m.decision).length, 2);
    assert.ok(state.history.some((m) => m.content.includes('按单位分别合计')));
  } finally {
    await f.close();
  }
});
