import { requestModel, interpretResponse } from './transport.mjs';
import { failure } from '../../platform/auth.mjs';

export async function generateText(config, key, prompt, request = requestModel) {
  const started = Date.now();
  const common = {
    model: config.modelId,
  };
  const payload =
    config.protocol === 'openai_responses'
      ? { ...common, store: false, input: prompt }
      : {
          ...common,
          messages: [{ role: 'user', content: prompt }],
        };
  let response;
  try {
    response = await request(config, key, payload);
  } catch (error) {
    if (error.statusCode === 400) throw error;
    throw failure(
      ['AbortError', 'TimeoutError'].includes(error.name) ? 504 : 502,
      ['AbortError', 'TimeoutError'].includes(error.name)
        ? '模型调用超时，请稍后重试。'
        : '无法连接模型服务，请检查域名、证书及网络配置。',
    );
  }
  const checked = interpretResponse(config.protocol, response.status, response.data);
  if (checked.status !== 'passed') throw failure(502, checked.message);
  const data = response.data;
  if (
    (config.protocol === 'openai_chat' && data.choices?.[0]?.finish_reason !== 'stop') ||
    (config.protocol === 'openai_responses' && data.status !== 'completed') ||
    (config.protocol === 'anthropic_messages' &&
      !['end_turn', 'stop_sequence'].includes(data.stop_reason))
  )
    throw failure(502, '模型返回未完成或已截断，请缩小生成范围或更换模型后重试。');
  const text =
    config.protocol === 'openai_chat'
      ? data.choices[0].message.content
      : config.protocol === 'anthropic_messages'
        ? data.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n')
        : data.output
            .filter((p) => p.type === 'message')
            .flatMap((p) => p.content ?? [])
            .filter((p) => p.type === 'output_text')
            .map((p) => p.text)
            .join('\n');
  return { text, modelId: config.modelId, latencyMs: Date.now() - started };
}
