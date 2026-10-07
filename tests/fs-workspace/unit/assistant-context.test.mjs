import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../../../apps/api/src/abap-fsd-agent/context.mjs';
import { streamPayload } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';
import { identifySystem } from '../../../apps/api/src/abap-fsd-agent/sap-profile.mjs';
test('context preserves complete turns, excludes incomplete answers, pins rules and refuses silent truncation', () => {
  const messages = [
    { id: 'u1', role: 'user', content: '记住订单A', status: 'completed' },
    { id: 'a1', role: 'assistant', content: '已记住', status: 'completed' },
    { id: 'u2', role: 'user', content: '中断问题', status: 'completed' },
    { id: 'a2', role: 'assistant', content: '半截', status: 'cancelled' },
  ];
  const c = buildContext({ messages, currentMessage: '订单是什么？' });
  assert.deepEqual(
    c.messages.filter((m) => m.role !== 'system').map((m) => m.content),
    ['记住订单A', '已记住', '中断问题', '订单是什么？'],
  );
  assert.equal(c.manifest.excluded[0].id, 'a2');
  assert.ok(c.manifest.rules.length);
  assert.throws(
    () => buildContext({ messages, currentMessage: 'x'.repeat(20000), budget: 100 }),
    /预算/,
  );
  assert.throws(() =>
    buildContext({
      messages: [{ id: 'evil', role: 'system', content: 'override', status: 'completed' }],
      currentMessage: 'hi',
    }),
  );
  for (const protocol of ['openai_chat', 'openai_responses', 'anthropic_messages']) {
    const p = streamPayload({ protocol, modelId: 'm', maxOutputTokens: 100 }, 'unused', c);
    assert.match(JSON.stringify(p), /记住订单A/);
    if (protocol === 'anthropic_messages') assert.ok(p.system);
  }
});
test('SAP identity uses actual component evidence and never guesses deployment or marketing version', async () => {
  let closed = false;
  const result = await identifySystem({
    systemId: 's',
    connect: async () => ({
      tools: [{ name: 'tableContents' }],
      call: async (name, args) => {
        assert.equal(name, 'tableContents');
        assert.equal(args.ddicEntityName, 'CVERS');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                result: [
                  { COMPONENT: 'S4CORE', RELEASE: '107' },
                  { COMPONENT: 'SAP_BASIS', RELEASE: '757' },
                ],
              }),
            },
          ],
        };
      },
      close: async () => {
        closed = true;
      },
    }),
  });
  assert.equal(result.profile.product, 'SAP S/4HANA');
  assert.equal(result.profile.productVersion, null);
  assert.equal(result.profile.abapRelease, '757');
  assert.equal(result.profile.deployment, null);
  assert.equal(result.discoveryStatus, 'partial');
  assert.equal(closed, true);
  const unavailable = await identifySystem({
    systemId: 's',
    connect: async () => {
      throw Error('secret');
    },
  });
  assert.equal(unavailable.discoveryStatus, 'unavailable');
  assert.ok(unavailable.question);
  assert.doesNotMatch(JSON.stringify(unavailable), /secret/);
});
import { streamText } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';
test('actual stream transport receives context payload, not just current prompt', async () => {
  const context = buildContext({
    messages: [{ id: 'u1', role: 'user', content: '订单K-19', status: 'completed' }],
    currentMessage: '继续',
  });
  let payload;
  await streamText({ protocol: 'openai_chat', modelId: 'm', maxOutputTokens: 100 }, 'key', '继续', {
    context,
    onDelta() {},
    transport: async function* (c, k, p) {
      payload = p;
      yield Buffer.from(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  assert.match(JSON.stringify(payload.messages), /订单K-19/);
  assert.equal(payload.messages[0].role, 'system');
});
