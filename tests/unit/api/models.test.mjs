import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { modelInput } from '../../../apps/api/src/modules/models/validation.mjs';
test('model input rejects unsafe URL and no longer stores call parameters', () => {
  const base = {
    name: '模型',
    provider: '服务',
    protocol: 'openai_chat',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'test',
  };
  assert.equal(Object.hasOwn(modelInput(base), 'temperature'), false);
  for (const baseUrl of [
    'http://example.com',
    'https://key:secret@example.com',
    'https://example.com/?key=abc',
    'https://example.com:1234',
  ])
    assert.throws(() => modelInput({ ...base, baseUrl }));
});
test('model transport blocks SSRF, validates actual text and hides provider error content', async () => {
  const path = new URL('../../../apps/api/src/modules/models/transport.mjs', import.meta.url);
  assert.ok(existsSync(path), 'safe model transport must exist');
  const { isPublicAddress, allowedEndpoint, probePayload, interpretResponse } = await import(path);
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.100.100.200',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '0.0.0.0',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.throws(() => allowedEndpoint('https://notallowed.example/v1', 'api.example.com'));
  assert.throws(() => allowedEndpoint('https://api.example.com.evil.org/v1', 'api.example.com'));
  assert.equal(
    allowedEndpoint('https://api.example.com/v1', 'api.example.com').hostname,
    'api.example.com',
  );
  const config = {
    modelId: 'test',
    protocol: 'openai_chat',
    maxOutputTokens: 8192,
    temperature: null,
  };
  const payload = probePayload(config);
  assert.ok(!('temperature' in payload));
  assert.equal(Object.hasOwn(payload, 'max_completion_tokens'), false);
  assert.equal(
    interpretResponse('openai_chat', 200, { choices: [{ message: { content: 'OK' } }] }).status,
    'passed',
  );
  assert.equal(interpretResponse('openai_chat', 200, { choices: [] }).status, 'failed');
  assert.equal(
    interpretResponse('openai_responses', 200, {
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    }).status,
    'passed',
  );
  assert.equal(
    interpretResponse('anthropic_messages', 200, { content: [{ type: 'text', text: 'OK' }] })
      .status,
    'passed',
  );
  const failure = interpretResponse('openai_chat', 401, {
    error: { message: 'secret supersecret' },
  });
  assert.equal(failure.code, 'AUTH_FAILED');
  assert.ok(!JSON.stringify(failure).includes('supersecret'));
  assert.equal(interpretResponse('openai_chat', 302, {}).code, 'REDIRECT_BLOCKED');
});
