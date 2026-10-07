import test from 'node:test';
import assert from 'node:assert/strict';
import { probeStructured } from '../../../apps/api/src/models/capabilities.mjs';

test('structured capability requires a validated response to its random challenge', async () => {
  const config = {
    protocol: 'openai_chat',
    modelId: 'synthetic',
    maxOutputTokens: 256,
    timeoutSeconds: 5,
    temperature: null,
  };
  const transport = async (_config, _key, payload) => ({
    status: 200,
    data: {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              challenge: JSON.parse(payload.messages[1].content).challenge,
              value: null,
            }),
          },
        },
      ],
    },
  });
  assert.equal((await probeStructured(config, 'never-real', transport)).status, 'passed');
  const textOnly = async () => ({
    status: 200,
    data: { choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] },
  });
  assert.equal((await probeStructured(config, 'never-real', textOnly)).status, 'failed');
  const forged = async () => ({
    status: 200,
    data: {
      choices: [
        { finish_reason: 'stop', message: { content: '{"challenge":"invented","value":null}' } },
      ],
    },
  });
  assert.equal((await probeStructured(config, 'never-real', forged)).status, 'failed');
});
