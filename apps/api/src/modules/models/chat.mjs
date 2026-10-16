import { createSseParser } from '@sap-delivery-workbench/contracts/agent-core/sse';
import { failure } from '../../platform/auth.mjs';
import { requestModelStream } from './transport.mjs';
import { openKey } from './crypto.mjs';

// The organization's default model with its decrypted key, for server-side agents.
// Unlike resolveDefaultModel this does not require a fresh capability probe: tool calling
// is not probed, and the agent reports provider errors itself.
export async function resolveAgentModel(db, organizationId) {
  const row = (
    await db.query(
      `SELECT v.id AS "versionId",v.model_id AS "modelId",v.config,v.credential_id AS "credentialId",c.secret_cipher AS "secret"
       FROM app.llm_default d
       JOIN app.llm_model_version v ON v.id=d.version_id AND v.organization_id=d.organization_id
       JOIN app.llm_model m ON m.id=d.model_id AND m.deleted_at IS NULL
       JOIN app.llm_credential c ON c.id=v.credential_id AND c.organization_id=v.organization_id
       WHERE d.organization_id=$1`,
      [organizationId],
    )
  ).rows[0];
  if (!row) throw failure(409, '尚未配置默认模型，请联系组织管理员。');
  return {
    versionId: row.versionId,
    modelId: row.modelId,
    config: row.config,
    key: openKey(row.secret, organizationId, row.credentialId),
  };
}

export function chatPayload(config, { messages, tools, maxOutputTokens, thinking }) {
  return {
    model: config.modelId,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    ...(Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0
      ? { max_tokens: maxOutputTokens }
      : {}),
    // Vendor extension honoured by DeepSeek/Qwen deployments; only sent when asked for.
    ...(thinking === false ? { enable_thinking: false } : {}),
  };
}

// One streamed chat completion with tool calling (OpenAI chat protocol).
// Resolves with the assembled assistant message; onDelta receives text and reasoning as they arrive.
// `firstByteTimeoutMs` overrides how long to wait for the first data: some providers send a tool
// call only once its arguments are complete, so a long document arrives after minutes.
export async function streamChat(
  config,
  key,
  { messages, tools, maxOutputTokens, thinking, signal, onDelta, firstByteTimeoutMs },
  { transport = requestModelStream } = {},
) {
  if (config.protocol !== 'openai_chat')
    throw Object.assign(
      failure(409, '默认模型的协议暂不支持工具调用，请使用 OpenAI 兼容协议的模型。'),
      {
        code: 'MODEL_PROTOCOL_UNSUPPORTED',
      },
    );
  const parser = createSseParser(),
    decoder = new TextDecoder('utf-8');
  let content = '',
    reasoning = '',
    finishReason = null,
    usage = null,
    done = false;
  const calls = [];
  for await (const chunk of transport(
    config,
    key,
    chatPayload(config, { messages, tools, maxOutputTokens, thinking }),
    { signal, ...(firstByteTimeoutMs ? { connectionTimeoutMs: firstByteTimeoutMs } : {}) },
  )) {
    for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
      if (frame.data === '[DONE]') {
        done = true;
        continue;
      }
      let value;
      try {
        value = JSON.parse(frame.data);
      } catch {
        throw Object.assign(failure(502, '模型流式数据格式无效。'), { code: 'OUTPUT_PROTOCOL' });
      }
      if (value.error)
        throw Object.assign(
          failure(502, '模型服务返回错误：' + String(value.error.message ?? '').slice(0, 200)),
          {
            code: 'PROVIDER_ERROR',
          },
        );
      if (value.usage) usage = value.usage;
      const choice = value.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        onDelta?.({ type: 'reasoning', text: delta.reasoning_content });
      }
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onDelta?.({ type: 'text', text: delta.content });
      }
      for (const part of delta.tool_calls ?? []) {
        const index = Number.isInteger(part.index) ? part.index : calls.length;
        const call = (calls[index] ??= { id: '', name: '', arguments: '' });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  if (!done && !finishReason)
    throw Object.assign(failure(502, '模型未正常完成，回复可能截断。'), {
      code: 'STREAM_INTERRUPTED',
    });
  return {
    content,
    reasoning,
    toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` })),
    finishReason,
    usage,
  };
}
