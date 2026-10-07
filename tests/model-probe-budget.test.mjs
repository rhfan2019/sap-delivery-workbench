import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probePayload, interpretResponse } from '../apps/api/src/models/transport.mjs';
test('connection probe leaves optional output limits to the provider', () => {
  for (const protocol of ['openai_chat', 'openai_responses', 'anthropic_messages']) {
    const payload = probePayload({ protocol, modelId: 'test' });
    for (const key of ['max_tokens', 'max_output_tokens', 'max_completion_tokens', 'temperature'])
      assert.equal(Object.hasOwn(payload, key), false);
  }
});

test('token exhaustion without final text is explicit and is never a pass', () => {
  const result = interpretResponse('openai_chat', 200, {
    choices: [{ finish_reason: 'length', message: { content: '' } }],
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'OUTPUT_LIMIT');
});
