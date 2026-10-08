import { randomUUID } from 'node:crypto';
import { requestModel } from './transport.mjs';
import { structuredPayload, interpretStructured } from './inference.mjs';

export async function probeStructured(config, key, transport = requestModel) {
  const started = Date.now();
  const challenge = randomUUID();
  const schema = {
    type: 'object',
    properties: {
      challenge: { type: 'string', enum: [challenge] },
      value: { type: ['string', 'null'] },
    },
    required: ['challenge', 'value'],
    additionalProperties: false,
  };
  try {
    const payload = structuredPayload(
      config,
      schema,
      'Return the challenge unchanged and value null using the supplied schema.',
      JSON.stringify({ challenge }),
    );
    const response = await transport(config, key, payload);
    if (response.status < 200 || response.status >= 300) throw new Error('PROVIDER_ERROR');
    const value = interpretStructured(config.protocol, response.data, schema);
    if (value.value !== null) throw new Error('CHALLENGE_FAILED');
    return {
      status: 'passed',
      code: 'OK',
      message: '结构化输出验证通过；不代表工具或视觉能力已验证。',
      latencyMs: Date.now() - started,
    };
  } catch {
    return {
      status: 'failed',
      code: 'STRUCTURED_CAPABILITY_FAILED',
      message: '结构化输出未通过严格验证，请检查协议、模型和连接配置。',
      latencyMs: Date.now() - started,
    };
  }
}
