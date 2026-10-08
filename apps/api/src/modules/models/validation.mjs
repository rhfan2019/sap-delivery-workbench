import { failure } from '../../platform/auth.mjs';
import { text, choice } from '../admin/validation.mjs';
export function modelInput(body = {}) {
  let url;
  try {
    url = new URL(body.baseUrl);
  } catch {
    throw failure(400, '请输入有效的 HTTPS 接入地址。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw failure(400, '接入地址只支持 HTTPS 默认端口，不得包含凭据、查询或片段。');
  const protocol = choice(
    body.protocol,
    ['openai_chat', 'openai_responses', 'anthropic_messages'],
    'API 协议',
  );
  return {
    name: text(body.name, '模型名称', 100),
    provider: text(body.provider, '提供方', 100),
    protocol,
    baseUrl: url.href.replace(/\/+$/, ''),
    modelId: text(body.modelId, '模型标识', 200),
  };
}
