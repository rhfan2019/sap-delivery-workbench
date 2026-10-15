import { runAgentLoop, openSap, historyMessages, LIMITS } from '../agent-core/public.mjs';
import { WORKSPACE_TOOLS, createWorkspace } from './tools/workspace.mjs';
import { compareDeclarations } from './document.mjs';
import { loadSystemPrompt, sessionFacts } from './context.mjs';
import * as repo from './repository.mjs';

const TABLE_CACHE_MS = 60 * 60 * 1000;
const tableCache = new Map();

const env = () => ({
  maxOutputTokens: Number(process.env.ABAP_FSD_AGENT_MAX_OUTPUT_TOKENS) || undefined,
  thinking: process.env.ABAP_FSD_AGENT_THINKING === 'off' ? false : undefined,
});

// Runs one turn to its natural end (answer, questions, document written) or a limit.
// Never throws: failures end the turn with a status the user can see.
export async function runTurn({ pool, scope, sessionId, turnId, model, emit, signal, deps = {} }) {
  const sap = await (deps.openSap ?? openSap)(pool, scope, { budgetMs: LIMITS.sapBudgetMs });
  const document = await repo.latestDocument(pool, sessionId);
  const comments = await repo.listComments(pool, sessionId, { openOnly: true });
  const attachments = await repo.listAttachments(pool, sessionId, { withText: true });
  let status = 'completed',
    stopReason = 'answered',
    error = null,
    usage = { prompt_tokens: 0, completion_tokens: 0 },
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
    ({ status, stopReason, usage, error } = await runAgentLoop({
      model,
      messages,
      tools: [...WORKSPACE_TOOLS, ...(sap.available ? sap.tools : [])],
      handlers: workspace.handlers,
      sap,
      emit,
      signal,
      env: env(),
      deps,
      persist: {
        appendMessage: (message) => repo.appendMessage(pool, sessionId, { turnId, ...message }),
        recordToolCall: (call) => repo.recordToolCall(pool, sessionId, turnId, call),
      },
      shouldStop: () => (workspace.state.questions ? 'asked' : null),
      logArguments: (name, args) =>
        name.endsWith('_document') ? { ...args, content: undefined, new_text: undefined } : args,
      truncatedHint:
        '输出被截断，工具参数不完整。请把内容拆小，用 write_document 的 append 模式分章续写。',
    }));
  } catch (e) {
    // Building the context failed before the loop started.
    status = 'failed';
    stopReason = 'error';
    error = { code: e.code ?? 'ERROR', message: String(e.message).slice(0, 500) };
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
