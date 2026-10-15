import { streamChat } from '../models/public.mjs';

export const LIMITS = {
  steps: 30, // model calls per turn
  toolCalls: 60,
  sapBudgetMs: 30 * 60 * 1000,
};

// A busy or rate-limited provider rejects the request before any output, so it is safe to resend.
// A dropped connection is resent too, but only when nothing was streamed yet.
export const BUSY_RETRY_MS = [3000, 8000, 15000];
const BUSY_CODES = new Set(['PROVIDER_BUSY', 'RATE_LIMITED']);
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'UND_ERR_SOCKET',
]);
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

async function withBusyRetry(call, { signal, wait = sleep, onRetry }) {
  for (let retry = 0; ; retry++) {
    const attempt = { streamed: false };
    try {
      return await call(attempt);
    } catch (e) {
      const retryable =
        BUSY_CODES.has(e.code) || (NETWORK_CODES.has(e.code ?? e.cause?.code) && !attempt.streamed);
      if (!retryable || retry >= BUSY_RETRY_MS.length || signal?.aborted) throw e;
      onRetry(retry + 1, BUSY_RETRY_MS[retry]);
      await wait(BUSY_RETRY_MS[retry], signal);
    }
  }
}

function parseArguments(raw) {
  if (!raw || !raw.trim()) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('参数必须是对象');
  return value;
}

function summarize(text) {
  const line = String(text).replace(/\s+/g, ' ').trim();
  return line.length > 160 ? line.slice(0, 160) + '…' : line;
}

// Runs the model/tool loop of one turn to its natural end (answer, questions, a stop the
// agent asks for) or a limit. It knows nothing about artifacts: the agent supplies the
// messages, its own tools and handlers, and where to persist messages and tool calls.
// Never throws: failures end the turn with a status the caller reports.
export async function runAgentLoop({
  model,
  messages,
  tools,
  handlers,
  sap,
  persist,
  emit,
  signal,
  shouldStop = () => null,
  logArguments = (name, args) => args,
  truncatedHint = '输出被截断，工具参数不完整。请把内容拆小，分段续写。',
  limits = LIMITS,
  env = {},
  deps = {},
}) {
  const chat = deps.streamChat ?? streamChat;
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  let status = 'completed',
    stopReason = 'answered',
    error = null;
  try {
    let toolCalls = 0;
    const seen = new Map();
    for (let step = 0; ; step++) {
      if (step >= limits.steps || toolCalls >= limits.toolCalls) {
        stopReason = 'step_limit';
        const note = '本轮已达到步骤上限，当前进度已保存。请告诉我是否继续。';
        await persist.appendMessage({ role: 'assistant', content: note });
        emit('delta', { type: 'text', text: '\n\n' + note });
        break;
      }
      emit('step', { step: step + 1 });
      const result = await withBusyRetry(
        (attempt) =>
          chat(model.config, model.key, {
            messages,
            tools,
            signal,
            ...env,
            onDelta: (delta) => {
              attempt.streamed = true;
              emit('delta', delta);
            },
          }),
        {
          signal,
          wait: deps.wait,
          onRetry: (retry, waitMs) => emit('step', { step: step + 1, retry, waitMs }),
        },
      );
      usage.prompt_tokens += result.usage?.prompt_tokens ?? 0;
      usage.completion_tokens += result.usage?.completion_tokens ?? 0;
      const calls = result.toolCalls;
      await persist.appendMessage({
        role: 'assistant',
        content: result.content,
        payload: calls.length ? { toolCalls: calls } : {},
      });
      messages.push({
        role: 'assistant',
        content: result.content || (calls.length ? null : ''),
        ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      });
      if (!calls.length) {
        if (result.finishReason === 'length') stopReason = 'output_limit';
        break;
      }
      for (const call of calls) {
        signal?.throwIfAborted();
        toolCalls++;
        const started = Date.now();
        emit('tool.start', {
          id: call.id,
          name: call.name,
          arguments: call.arguments.slice(0, 500),
        });
        let args = {},
          outcome;
        try {
          args = parseArguments(call.arguments);
          const key = call.name + ':' + JSON.stringify(args);
          seen.set(key, (seen.get(key) ?? 0) + 1);
          if (seen.get(key) > 2)
            outcome = {
              status: 'denied',
              content: '同样的调用本轮已执行过两次，请使用已有结果或换一种查询。',
            };
          else if (handlers[call.name])
            outcome = { status: 'ok', content: await handlers[call.name](args) };
          else if (sap?.available && sap.tools.some((t) => t.function.name === call.name))
            outcome = await sap.call(call.name, args);
          else outcome = { status: 'denied', content: `没有名为 ${call.name} 的工具。` };
        } catch (e) {
          if (signal?.aborted) throw e;
          outcome = {
            status: 'error',
            content: result.finishReason === 'length' ? truncatedHint : '调用失败：' + e.message,
          };
        }
        const durationMs = Date.now() - started;
        await persist.recordToolCall({
          name: call.name,
          arguments: logArguments(call.name, args),
          status: outcome.status,
          // The audit page and log exports read this; keep enough to diagnose failures.
          summary: String(outcome.content).slice(0, 2000),
          durationMs,
        });
        const questions =
          call.name === 'ask_user' && outcome.status === 'ok' ? { questions: args.questions } : {};
        await persist.appendMessage({
          role: 'tool',
          content: outcome.content,
          payload: { toolCallId: call.id, name: call.name, status: outcome.status, ...questions },
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.content });
        emit('tool.end', {
          id: call.id,
          name: call.name,
          status: outcome.status,
          summary: summarize(outcome.content),
          durationMs,
          ...questions,
        });
      }
      const stop = shouldStop();
      if (stop) {
        stopReason = stop;
        break;
      }
    }
  } catch (e) {
    if (signal?.aborted) {
      status = 'cancelled';
      stopReason = 'cancelled';
    } else {
      status = 'failed';
      stopReason = 'error';
      error = { code: e.code ?? 'ERROR', message: String(e.message).slice(0, 500) };
      await persist
        .appendMessage({
          role: 'assistant',
          content: `本轮出错：${error.message}。已保存的进度不受影响，可以重新发送消息继续。`,
          payload: { error },
        })
        .catch(() => {});
    }
  }
  return { status, stopReason, usage, error };
}
