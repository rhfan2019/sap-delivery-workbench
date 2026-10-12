import { streamChat } from '../models/public.mjs';
import { openSap } from './tools/sap.mjs';
import { WORKSPACE_TOOLS, createWorkspace } from './tools/workspace.mjs';
import { compareDeclarations } from './document.mjs';
import { loadSystemPrompt, sessionFacts, historyMessages } from './context.mjs';
import * as repo from './repository.mjs';

export const LIMITS = {
  steps: 30, // model calls per turn
  toolCalls: 60,
  sapBudgetMs: 30 * 60 * 1000,
};
const TABLE_CACHE_MS = 60 * 60 * 1000;
const tableCache = new Map();

const env = () => ({
  maxOutputTokens: Number(process.env.ABAP_FSD_AGENT_MAX_OUTPUT_TOKENS) || undefined,
  thinking: process.env.ABAP_FSD_AGENT_THINKING === 'off' ? false : undefined,
});

// A busy or rate-limited provider rejects the request before any output, so it is safe to resend.
export const BUSY_RETRY_MS = [3000, 8000, 15000];
const BUSY_CODES = new Set(['PROVIDER_BUSY', 'RATE_LIMITED']);
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
    try {
      return await call();
    } catch (e) {
      if (!BUSY_CODES.has(e.code) || retry >= BUSY_RETRY_MS.length || signal?.aborted) throw e;
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

// Runs one turn to its natural end (answer, questions, document written) or a limit.
// Never throws: failures end the turn with a status the user can see.
export async function runTurn({ pool, scope, sessionId, turnId, model, emit, signal, deps = {} }) {
  const chat = deps.streamChat ?? streamChat;
  const sap = await (deps.openSap ?? openSap)(pool, scope, { budgetMs: LIMITS.sapBudgetMs });
  const document = await repo.latestDocument(pool, sessionId);
  const comments = await repo.listComments(pool, sessionId, { openOnly: true });
  const attachments = await repo.listAttachments(pool, sessionId, { withText: true });
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  let status = 'completed',
    stopReason = 'answered',
    error = null,
    version = null;

  const verifyTable = sap.available
    ? async (table) => {
        const key = `${sap.target.systemCode}:${sap.target.client}:${table}`;
        const hit = tableCache.get(key);
        if (hit && hit.at > Date.now() - TABLE_CACHE_MS) return hit.value;
        const result = await sap.call('ddicElement', { path: table });
        // An unknown name comes back as success with no fields: treat it as missing.
        const value =
          result.status === 'ok' && /个字段/.test(result.content) ? result.content : null;
        tableCache.set(key, { at: Date.now(), value });
        return value;
      }
    : undefined;
  const workspace = createWorkspace({
    markdown: document?.markdown ?? '',
    comments,
    verifyTable,
    onDocument: (markdown) => emit('document.draft', { markdown }),
    onReply: async (commentId, body) => {
      const reply = { body, by: 'assistant', at: new Date().toISOString() };
      await repo.replyComment(pool, sessionId, commentId, reply);
      emit('comment.reply', { commentId, reply });
    },
  });
  const tools = [...WORKSPACE_TOOLS, ...(sap.available ? sap.tools : [])];
  const handlers = workspace.handlers;

  try {
    const messages = [
      { role: 'system', content: await loadSystemPrompt() },
      {
        role: 'system',
        content: sessionFacts({
          scope,
          sap,
          document,
          comments,
          attachments,
          today: new Date().toISOString().slice(0, 10),
        }),
      },
      ...historyMessages(await repo.listMessages(pool, sessionId)),
    ];
    let toolCalls = 0;
    const seen = new Map();
    for (let step = 0; ; step++) {
      if (step >= LIMITS.steps || toolCalls >= LIMITS.toolCalls) {
        stopReason = 'step_limit';
        const note = '本轮已达到步骤上限，当前进度已保存。请告诉我是否继续。';
        await repo.appendMessage(pool, sessionId, { turnId, role: 'assistant', content: note });
        emit('delta', { type: 'text', text: '\n\n' + note });
        break;
      }
      emit('step', { step: step + 1 });
      const result = await withBusyRetry(
        () =>
          chat(model.config, model.key, {
            messages,
            tools,
            signal,
            ...env(),
            onDelta: (delta) => emit('delta', delta),
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
      await repo.appendMessage(pool, sessionId, {
        turnId,
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
          else if (sap.available && sap.tools.some((t) => t.function.name === call.name))
            outcome = await sap.call(call.name, args);
          else outcome = { status: 'denied', content: `没有名为 ${call.name} 的工具。` };
        } catch (e) {
          if (signal?.aborted) throw e;
          outcome = {
            status: 'error',
            content:
              result.finishReason === 'length'
                ? '输出被截断，工具参数不完整。请把内容拆小，用 write_document 的 append 模式分章续写。'
                : '调用失败：' + e.message,
          };
        }
        const durationMs = Date.now() - started;
        await repo.recordToolCall(pool, sessionId, turnId, {
          name: call.name,
          arguments: call.name.endsWith('_document')
            ? { ...args, content: undefined, new_text: undefined }
            : args,
          status: outcome.status,
          // The audit page and log exports read this; keep enough to diagnose failures.
          summary: String(outcome.content).slice(0, 2000),
          durationMs,
        });
        await repo.appendMessage(pool, sessionId, {
          turnId,
          role: 'tool',
          content: outcome.content,
          payload: {
            toolCallId: call.id,
            name: call.name,
            status: outcome.status,
            ...(call.name === 'ask_user' && outcome.status === 'ok'
              ? { questions: args.questions }
              : {}),
          },
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.content });
        emit('tool.end', {
          id: call.id,
          name: call.name,
          status: outcome.status,
          summary: summarize(outcome.content),
          durationMs,
          ...(call.name === 'ask_user' && outcome.status === 'ok'
            ? { questions: args.questions }
            : {}),
        });
      }
      if (workspace.state.questions) {
        stopReason = 'asked';
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
      await repo
        .appendMessage(pool, sessionId, {
          turnId,
          role: 'assistant',
          content: `本轮出错：${error.message}。已保存的进度不受影响，可以重新发送消息继续。`,
          payload: { error },
        })
        .catch(() => {});
    }
  } finally {
    await sap.close?.();
    // Whatever happened, keep the document work done so far and release the session.
    try {
      if (workspace.state.changed) {
        const comparison = compareDeclarations(
          document?.markdown ?? '',
          workspace.state.markdown,
          workspace.state.declarations,
        );
        version = await repo.saveDocument(pool, sessionId, {
          turnId,
          markdown: workspace.state.markdown,
          changes: workspace.state.declarations,
          comparison,
          actorId: scope.actorId,
        });
        emit('document.saved', { version, comparison });
      }
    } catch (e) {
      status = 'failed';
      error = { code: 'DOCUMENT_SAVE_FAILED', message: String(e.message).slice(0, 500) };
    }
    await repo
      .finishTurn(pool, sessionId, turnId, { status, stopReason, usage, error })
      .catch(() => {});
    emit('turn.end', { status, stopReason, version, usage, error });
  }
  return { status, stopReason, version };
}
