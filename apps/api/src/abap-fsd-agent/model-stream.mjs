import { MODEL_CONNECTION_TIMEOUT_MS } from '../models/runtime.mjs';
import { requestModelStream } from '../models/transport.mjs';
import { createSseParser } from '../../../../packages/contracts/abap-fsd-agent/sse.mjs';
import { failure } from '../auth.mjs';

export function streamPayload(config, prompt, context) {
  // Verified QianWen Flash capability: interactive turns request answer text directly.
  // Do not send this vendor extension to unrelated models or protocols.
  const directQwen =
    config.protocol === 'openai_chat' &&
    config.provider?.toLowerCase() === 'qianwen' &&
    config.modelId === 'qwen3.8-flash';
  const common = {
    model: config.modelId,
    stream: true,
    ...(directQwen ? { enable_thinking: false } : {}),
  };
  if (config.protocol === 'openai_responses')
    return {
      ...common,
      store: false,
      input: context?.messages ?? prompt,
    };
  return {
    ...common,
    ...(config.protocol === 'anthropic_messages' && context
      ? {
          system: context.messages
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
            .join('\n'),
        }
      : {}),
    messages: context
      ? context.messages.filter(
          (m) => config.protocol !== 'anthropic_messages' || m.role !== 'system',
        )
      : [{ role: 'user', content: prompt }],
  };
}
export async function streamText(
  config,
  key,
  prompt,
  {
    signal,
    onDelta,
    onProgress,
    context,
    transport = requestModelStream,
    maxResponseBytes = 16 * 1024 * 1024,
  } = {},
) {
  const started = Date.now(),
    parser = createSseParser(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  const diagnostics = {
    startedAt: new Date(started).toISOString(),
    firstByteAt: null,
    lastByteAt: null,
    lastContentAt: null,
    receivedBytes: 0,
    textCharacters: 0,
    reasoningCharacters: 0,
    maxResponseBytes,
    connectionTimeoutMs: MODEL_CONNECTION_TIMEOUT_MS,
  };
  let lastProgress = 0;
  let terminal = false,
    stopped = false,
    text = '',
    totalBytes = 0,
    finishReason = null,
    usage = null;
  const fail = (code, message, reason = finishReason) =>
    Object.assign(failure(502, message), {
      code,
      finishReason: reason,
      outputLimit: null,
      usage,
    });
  try {
    for await (const chunk of transport(config, key, streamPayload(config, prompt, context), {
      signal,
      maxResponseBytes,
      onResponse: (info) => Object.assign(diagnostics, info),
    })) {
      signal?.throwIfAborted();
      totalBytes += chunk.length;
      diagnostics.receivedBytes = totalBytes;
      diagnostics.firstByteAt ??= new Date().toISOString();
      diagnostics.lastByteAt = new Date().toISOString();
      if (totalBytes > maxResponseBytes)
        throw fail('RESPONSE_LIMIT', '模型流响应超过大小上限，未发布不完整成果。');
      for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
        if (terminal) throw fail('OUTPUT_PROTOCOL', '模型在结束后返回了额外事件。');
        if (frame.data === '[DONE]' && config.protocol === 'openai_chat') {
          if (!stopped) throw fail('STREAM_INTERRUPTED', '模型未正常完成，回复可能截断。');
          terminal = true;
          continue;
        }
        let value;
        try {
          value = JSON.parse(frame.data);
        } catch {
          throw fail('OUTPUT_PROTOCOL', '模型流式数据格式无效。');
        }
        if (value.error || value.type === 'error' || value.type === 'response.failed')
          throw fail('PROVIDER_ERROR', '模型服务返回错误或回复未完成，请查看运行日志。');
        if (value.usage) usage = value.usage;
        let delta = '',
          finishError = null;
        if (config.protocol === 'openai_chat') {
          const choice = value.choices?.[0];
          diagnostics.reasoningCharacters +=
            typeof choice?.delta?.reasoning_content === 'string'
              ? choice.delta.reasoning_content.length
              : 0;
          if (choice?.delta?.tool_calls || choice?.delta?.function_call)
            throw fail('OUTPUT_PROTOCOL', '当前单轮测试不支持工具调用。');
          if (choice?.delta?.refusal) throw failure(502, '模型未能回答此次请求。');
          delta = choice?.delta?.content ?? '';
          if (choice?.finish_reason != null) {
            finishReason = choice.finish_reason;
            if (finishReason !== 'stop')
              finishError = fail(
                finishReason === 'length'
                  ? 'OUTPUT_LIMIT'
                  : finishReason === 'content_filter'
                    ? 'CONTENT_FILTER'
                    : 'PROVIDER_STOP',
                finishReason === 'length'
                  ? '达到单次输出额度，回复已截断。'
                  : '提供方停止了生成，未取得完整回复。',
              );
            stopped = true;
          }
        } else if (config.protocol === 'openai_responses') {
          if (value.type === 'response.output_text.delta') delta = value.delta;
          if (value.response?.usage) usage = value.response.usage;
          if (value.type === 'response.incomplete') {
            finishReason = value.response?.incomplete_details?.reason ?? 'incomplete';
            finishError = fail(
              finishReason === 'max_output_tokens' ? 'OUTPUT_LIMIT' : 'PROVIDER_STOP',
              '模型回复未完成或已截断。',
            );
          }
          if (value.type?.includes('refusal')) throw failure(502, '模型未能回答此次请求。');
          if (
            value.type === 'response.output_item.added' &&
            !['message', 'reasoning'].includes(value.item?.type)
          )
            throw fail('OUTPUT_PROTOCOL', '当前单轮测试不支持工具调用。');
          if (value.type === 'response.completed') {
            if (value.response?.status !== 'completed')
              throw failure(502, '模型回复未完成或已截断。');
            terminal = true;
          }
        } else if (config.protocol === 'anthropic_messages') {
          if (value.type === 'content_block_start' && value.content_block?.type === 'tool_use')
            throw fail('OUTPUT_PROTOCOL', '当前单轮测试不支持工具调用。');
          if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta')
            delta = value.delta.text;
          if (value.type === 'message_delta' && value.delta?.stop_reason != null) {
            finishReason = value.delta.stop_reason;
            if (!['end_turn', 'stop_sequence'].includes(finishReason))
              finishError = fail(
                finishReason === 'max_tokens' ? 'OUTPUT_LIMIT' : 'PROVIDER_STOP',
                '模型回复未完成或已截断。',
              );
            stopped = true;
          }
          if (value.type === 'message_stop') {
            if (!stopped) throw failure(502, '模型回复未正常完成。');
            terminal = true;
          }
        } else throw failure(400, '不支持的模型协议。');
        if (typeof delta !== 'string') throw fail('OUTPUT_PROTOCOL', '模型返回了无效文本。');
        if (delta) {
          if (text.length + delta.length > 262144)
            throw fail('TEXT_LIMIT', '模型文本超过大小上限，未发布不完整成果。');
          text += delta;
          diagnostics.lastContentAt = new Date().toISOString();
          diagnostics.textCharacters = text.length;
          await onDelta(delta);
        }
        if (finishError) throw finishError;
      }
      if (terminal) break;
      if (!terminal && Date.now() - lastProgress >= 2000) {
        lastProgress = Date.now();
        await onProgress?.({
          message: text.length
            ? `模型正在生成 JSON/回复，已接收 ${text.length} 字符`
            : diagnostics.reasoningCharacters
              ? '模型正在推理，尚未开始输出正文…'
              : '模型已连接，正在等待正文…',
          phase: text.length ? 'text' : diagnostics.reasoningCharacters ? 'reasoning' : 'waiting',
          reasoningCharacters: diagnostics.reasoningCharacters,
          receivedBytes: totalBytes,
          textCharacters: text.length,
          elapsedMs: Date.now() - started,
          lastContentAt: diagnostics.lastContentAt,
        });
      }
    }
    parser.push(decoder.decode());
    parser.finish();
    if (!terminal) throw fail('STREAM_INTERRUPTED', '连接提前结束，已保留收到的内容。');
    if (!text.trim()) throw fail('OUTPUT_PROTOCOL', '模型未返回有效文本。');
    return {
      modelId: config.modelId,
      latencyMs: Date.now() - started,
      finishReason: finishReason ?? 'stop',
      usage,
      outputLimit: null,
      diagnostics: { ...diagnostics, elapsedMs: Date.now() - started },
    };
  } catch (error) {
    if (signal?.aborted) {
      signal.reason.diagnostics = { ...diagnostics, elapsedMs: Date.now() - started };
      throw signal.reason;
    }
    const safeCode = (v) => (typeof v === 'string' && /^[A-Z0-9_]{1,80}$/.test(v) ? v : null);
    const detail = {
      ...diagnostics,
      ...error.diagnostics,
      elapsedMs: Date.now() - started,
      causeCode: safeCode(error.cause?.code ?? error.code),
      causeName: safeCode(error.name?.toUpperCase()),
    };
    let reported = error;
    if (!error.statusCode) {
      reported =
        error.message === '流式事件超过大小上限。'
          ? fail('RESPONSE_LIMIT', '模型流式事件超过大小上限，未发布不完整成果。')
          : error.message === '流式事件未完整结束。'
            ? fail('STREAM_INTERRUPTED', '模型流式事件未完整结束，已保留收到的内容。')
            : ['AbortError', 'TimeoutError'].includes(error.name)
              ? fail('MODEL_TIMEOUT', '模型请求被外部超时信号中止，已保留运行诊断。')
              : fail('CONNECTION_INTERRUPTED', '模型连接中断或响应无效，已保留收到的内容。');
    }
    reported.diagnostics = detail;
    throw reported;
  }
}
