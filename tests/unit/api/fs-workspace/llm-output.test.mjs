import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredPayload, interpretStructured } from '../../../../apps/api/src/modules/models/inference.mjs';
import { requestModel } from '../../../../apps/api/src/modules/models/transport.mjs';
const schema = {
  type: 'object',
  properties: { value: { type: ['string', 'null'] } },
  required: ['value'],
  additionalProperties: false,
};
test('Responses structured output uses strict schema and refuses truncation before parsing', () => {
  const payload = structuredPayload(
    {
      protocol: 'openai_responses',
      modelId: 'configured-model',
      maxOutputTokens: 1000,
      temperature: null,
    },
    schema,
    'trusted policy',
    'untrusted material',
  );
  assert.equal(payload.text.format.type, 'json_schema');
  assert.equal(payload.text.format.strict, true);
  assert.equal(payload.tools, undefined);
  assert.throws(
    () =>
      interpretStructured(
        'openai_responses',
        {
          status: 'incomplete',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: '{"value":"invented"}' }] },
          ],
        },
        schema,
      ),
    /OUTPUT_TRUNCATED/,
  );
  assert.throws(
    () =>
      interpretStructured(
        'openai_responses',
        {
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
        },
        schema,
      ),
    /MODEL_REFUSAL/,
  );
  assert.deepEqual(
    interpretStructured(
      'openai_responses',
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"value":null}' }] }],
      },
      schema,
    ),
    { value: null },
  );
});
test('cancelled inference aborts before DNS or external requests', async () => {
  const prior = process.env.LLM_ALLOWED_HOSTS;
  process.env.LLM_ALLOWED_HOSTS = 'api.example.com';
  try {
    const controller = new AbortController();
    controller.abort(new Error('CANCELLED'));
    await assert.rejects(
      requestModel(
        { baseUrl: 'https://api.example.com', timeoutSeconds: 1, protocol: 'openai_chat' },
        'synthetic',
        {},
        { signal: controller.signal },
      ),
      /CANCELLED/,
    );
  } finally {
    if (prior === undefined) delete process.env.LLM_ALLOWED_HOSTS;
    else process.env.LLM_ALLOWED_HOSTS = prior;
  }
});
test('Chat structured output rejects authority additions and markdown repair', () => {
  const response = (text) => ({ choices: [{ finish_reason: 'stop', message: { content: text } }] });
  assert.throws(
    () => interpretStructured('openai_chat', response('{"value":"ok","approved":true}'), schema),
    /SCHEMA_INVALID/,
  );
  assert.throws(
    () => interpretStructured('openai_chat', response('```json\n{"value":"ok"}\n```'), schema),
    /JSON_INVALID/,
  );
  assert.throws(
    () => structuredPayload({ protocol: 'anthropic_messages' }, schema, 'policy', 'data'),
    /PROTOCOL_NOT_VERIFIED/,
  );
});
