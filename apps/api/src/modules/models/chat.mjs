import { createSseParser } from '@sap-delivery-workbench/contracts/agent-core/sse';
import { failure } from '../../platform/auth.mjs';
import { requestModelStream } from './transport.mjs';
import { openKey } from './crypto.mjs';

// A model with its decrypted key, for server-side agents: the one the user picked for this
// message (docs/modules/agent-start-and-composer.md 4.3), else the organization's
// default. Unlike resolveDefaultModel this does not require a fresh capability probe: tool
// calling is not probed, and the agent reports provider errors itself.
const AGENT_MODEL = `SELECT m.id AS "id",v.id AS "versionId",v.model_id AS "modelId",v.config,v.credential_id AS "credentialId",c.secret_cipher AS "secret"
  FROM app.llm_model m
  JOIN app.llm_model_version v ON v.id=m.latest_version_id AND v.organization_id=m.organization_id
  JOIN app.llm_credential c ON c.id=v.credential_id AND c.organization_id=v.organization_id`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function resolveAgentModel(db, organizationId, pickedModelId) {
  let row;
  if (pickedModelId) {
    row = UUID.test(String(pickedModelId))
      ? (
          await db.query(
            AGENT_MODEL + ' WHERE m.organization_id=$1 AND m.id=$2 AND m.deleted_at IS NULL',
            [organizationId, pickedModelId],
          )
        ).rows[0]
      : null;
    if (!row)
      throw Object.assign(failure(422, '所选模型不可用，请改用默认模型。'), {
        code: 'MODEL_UNAVAILABLE',
      });
  } else {
    row = (
      await db.query(
        `SELECT d.model_id AS "id",v.id AS "versionId",v.model_id AS "modelId",v.config,v.credential_id AS "credentialId",c.secret_cipher AS "secret"
         FROM app.llm_default d
         JOIN app.llm_model_version v ON v.id=d.version_id AND v.organization_id=d.organization_id
         JOIN app.llm_model m ON m.id=d.model_id AND m.deleted_at IS NULL
         JOIN app.llm_credential c ON c.id=v.credential_id AND c.organization_id=v.organization_id
         WHERE d.organization_id=$1`,
        [organizationId],
      )
    ).rows[0];
    if (!row) throw failure(409, '尚未配置默认模型，请联系组织管理员。');
  }
  return {
    versionId: row.versionId,
    modelId: row.modelId,
    config: row.config,
    key: openKey(row.secret, organizationId, row.credentialId),
  };
}

// The models an assistant user may pick, the default first: every model of the organization
// with a key. No secrets and no endpoints, only what the picker shows.
export async function listAgentModels(db, organizationId) {
  const { rows } = await db.query(
    `SELECT m.id,v.config->>'name' AS name,v.config->>'provider' AS provider,(m.id=d.model_id) AS "isDefault"
     FROM app.llm_model m
     JOIN app.llm_model_version v ON v.id=m.latest_version_id AND v.organization_id=m.organization_id
     LEFT JOIN app.llm_default d ON d.organization_id=m.organization_id
     WHERE m.organization_id=$1 AND m.deleted_at IS NULL AND v.credential_id IS NOT NULL
     ORDER BY (m.id=d.model_id) DESC NULLS LAST, v.config->>'name', m.id`,
    [organizationId],
  );
  return rows.map((r) => ({ ...r, isDefault: !!r.isDefault }));
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

// Anthropic Messages request for the same OpenAI-shaped history the agent loop keeps:
// system messages become `system`, assistant tool calls become tool_use blocks, tool results
// become tool_result blocks in a user turn. Reasoning is dropped (thinking is not requested,
// and unsigned thinking blocks cannot be sent back). Same-role neighbours are merged.
export function anthropicPayload(config, { messages, tools, maxOutputTokens }) {
  const system = [],
    turns = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = turns.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  };
  const text = (value) =>
    typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  for (const m of messages ?? []) {
    if (m.role === 'system') system.push(text(m.content));
    else if (m.role === 'tool')
      push('user', [
        { type: 'tool_result', tool_use_id: m.tool_call_id, content: text(m.content) || '（空）' },
      ]);
    else if (m.role === 'assistant')
      push('assistant', [
        ...(text(m.content) ? [{ type: 'text', text: text(m.content) }] : []),
        ...(m.tool_calls ?? []).map((c) => {
          let input = {};
          try {
            input = JSON.parse(c.function?.arguments || '{}');
          } catch {
            // A truncated call: the loop already told the model; keep the turn well-formed.
          }
          return { type: 'tool_use', id: c.id, name: c.function?.name, input };
        }),
      ]);
    else
      push(
        'user',
        Array.isArray(m.content)
          ? m.content
          : text(m.content)
            ? [{ type: 'text', text: text(m.content) }]
            : [],
      );
  }
  return {
    model: config.modelId,
    stream: true,
    ...(system.filter(Boolean).length ? { system: system.filter(Boolean).join('\n\n') } : {}),
    messages: turns,
    ...(tools?.length
      ? {
          tools: tools.map((t) => ({
            name: t.function.name,
            ...(t.function.description ? { description: t.function.description } : {}),
            input_schema: t.function.parameters ?? { type: 'object', properties: {} },
          })),
          tool_choice: { type: 'auto' },
        }
      : {}),
    // Without a limit the transport reads the model's own maximum (Anthropic requires one).
    ...(Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0
      ? { max_tokens: maxOutputTokens }
      : {}),
  };
}

const ANTHROPIC_FINISH = { tool_use: 'tool_calls', max_tokens: 'length', end_turn: 'stop' };

// One streamed chat completion with tool calling (OpenAI chat or Anthropic Messages protocol).
// Resolves with the assembled assistant message; onDelta receives text and reasoning as they arrive,
// onToolCall each tool call as its name and arguments accumulate.
// `firstByteTimeoutMs` overrides how long to wait for the first data: some providers send a tool
// call only once its arguments are complete, so a long document arrives after minutes.
export async function streamChat(
  config,
  key,
  { messages, tools, maxOutputTokens, thinking, signal, onDelta, onToolCall, firstByteTimeoutMs },
  { transport = requestModelStream } = {},
) {
  const anthropic = config.protocol === 'anthropic_messages';
  if (!anthropic && config.protocol !== 'openai_chat')
    throw Object.assign(
      failure(
        409,
        '所选模型的协议暂不支持工具调用，请使用 OpenAI Chat 兼容或 Anthropic Messages 协议的模型。',
      ),
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
  // Anthropic numbers content blocks (text, thinking, tool_use) together; tools get their own index.
  const blockCall = new Map();
  const anthropicFrame = (value) => {
    if (value.type === 'error' || value.error)
      throw Object.assign(
        failure(502, '模型服务返回错误：' + String(value.error?.message ?? '').slice(0, 200)),
        { code: 'PROVIDER_ERROR' },
      );
    if (value.type === 'message_start' && value.message?.usage) {
      const u = value.message.usage;
      usage = {
        prompt_tokens:
          (u.input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0),
        completion_tokens: u.output_tokens ?? 0,
      };
    } else if (value.type === 'content_block_start' && value.content_block?.type === 'tool_use') {
      const index = calls.length;
      calls.push({
        id: value.content_block.id ?? '',
        name: value.content_block.name ?? '',
        arguments: '',
      });
      blockCall.set(value.index, index);
      onToolCall?.({ index, ...calls[index] });
    } else if (value.type === 'content_block_delta') {
      const d = value.delta ?? {};
      if (d.type === 'text_delta' && d.text) {
        content += d.text;
        onDelta?.({ type: 'text', text: d.text });
      } else if (d.type === 'thinking_delta' && d.thinking) {
        reasoning += d.thinking;
        onDelta?.({ type: 'reasoning', text: d.thinking });
      } else if (d.type === 'input_json_delta' && blockCall.has(value.index)) {
        const index = blockCall.get(value.index);
        calls[index].arguments += d.partial_json ?? '';
        onToolCall?.({ index, ...calls[index] });
      }
    } else if (value.type === 'message_delta') {
      const reason = value.delta?.stop_reason;
      if (reason) finishReason = ANTHROPIC_FINISH[reason] ?? reason;
      if (value.usage?.output_tokens != null)
        usage = {
          prompt_tokens: usage?.prompt_tokens ?? 0,
          completion_tokens: value.usage.output_tokens,
        };
    } else if (value.type === 'message_stop') return true;
    return false;
  };
  for await (const chunk of transport(
    config,
    key,
    anthropic
      ? anthropicPayload(config, { messages, tools, maxOutputTokens })
      : chatPayload(config, { messages, tools, maxOutputTokens, thinking }),
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
      if (anthropic) {
        done = anthropicFrame(value) || done;
        continue;
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
        if (call.name) onToolCall?.({ index, ...call });
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
    toolCalls: calls.filter(Boolean).map((c, i) => ({
      ...c,
      id: c.id || `call_${i}`,
      // A tool_use block without input streams no JSON at all.
      ...(anthropic && !c.arguments ? { arguments: '{}' } : {}),
    })),
    finishReason,
    usage,
  };
}
