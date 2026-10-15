import { runAgentLoop, openSap, historyMessages, LIMITS } from '../agent-core/public.mjs';
import { WORKSPACE_TOOLS, createWorkspace } from './tools/workspace.mjs';
import { compareDeclarations, staleComments } from './artifacts.mjs';
import { loadSystemPrompt, sessionFacts } from './context.mjs';
import { loadFramework, frameworkSection } from './framework.mjs';
import { basisOf, collectMaterials, markChanges, readMaterial } from './materials.mjs';
import * as repo from './repository.mjs';

const TABLE_CACHE_MS = 60 * 60 * 1000;
const tableCache = new Map();
const programUrl = (name) => `/sap/bc/adt/programs/programs/${name.toLowerCase()}/source/main`;

const env = () => ({
  maxOutputTokens: Number(process.env.ABAP_DEV_AGENT_MAX_OUTPUT_TOKENS) || undefined,
  thinking: process.env.ABAP_DEV_AGENT_THINKING === 'off' ? false : undefined,
});

// Runs one turn to its natural end (answer, questions, plan or code written) or a limit.
// Never throws: failures end the turn with a status the user can see. `work` is the
// item-workspace context (objects and files of the item).
export async function runTurn({
  pool,
  work,
  scope,
  sessionId,
  turnId,
  model,
  emit,
  signal,
  deps = {},
}) {
  const sap = await (deps.openSap ?? openSap)(pool, scope, { budgetMs: LIMITS.sapBudgetMs });
  let status = 'completed',
    stopReason = 'answered',
    error = null,
    usage = { prompt_tokens: 0, completion_tokens: 0 },
    version = null,
    workspace = null,
    current = null,
    materials = [];
  const save = async ({ plan, code, source, sourceRef, changes = [], comparison = {} }) => {
    const v = await repo.saveVersion(pool, sessionId, {
      turnId,
      plan,
      code,
      source,
      sourceRef,
      basis: basisOf(materials),
      changes,
      comparison,
      actorId: scope.actorId,
    });
    const open = await repo.listComments(pool, sessionId, { openOnly: true });
    await repo.markStale(pool, sessionId, staleComments(open, { plan, code }));
    emit('version.saved', { version: v, source, comparison });
    version = v;
    return v;
  };

  try {
    current = await repo.latestVersion(pool, sessionId);
    const comments = await repo.listComments(pool, sessionId, { openOnly: true });
    const attachments = await repo.listAttachments(pool, sessionId, { withText: true });
    const objects = await work.itemObjects(pool, scope.itemId);
    const files = await work.itemFiles(pool, scope.itemId);
    const framework = await (deps.loadFramework ?? loadFramework)(sap);
    materials = markChanges(
      await collectMaterials(pool, { scope, objects, files, attachments, framework }),
      current?.basis,
    );
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
    workspace = createWorkspace({
      plan: current?.plan ?? '',
      code: current?.code ?? '',
      comments,
      materials,
      programs: objects.filter((o) => o.objectType === 'PROG').map((o) => o.objectName),
      readMaterial: (key, section) =>
        readMaterial(pool, scope, materials, key, section, { parse: deps.parseFile }),
      readProgram: async (name) => {
        if (!sap.available) throw new Error(sap.reason);
        return (await sap.readSource(programUrl(name))).source;
      },
      verifyTable,
      onDraft: (target, text) => emit('artifact.draft', { target, text }),
      onReply: async (commentId, body) => {
        const reply = { body, by: 'assistant', at: new Date().toISOString() };
        await repo.replyComment(pool, sessionId, commentId, reply);
        emit('comment.reply', { commentId, reply });
      },
      onSave: (v) => save(v),
    });
    const messages = [
      { role: 'system', content: await loadSystemPrompt(scope.itemKind) },
      { role: 'system', content: frameworkSection(framework) },
      {
        role: 'system',
        content: sessionFacts({
          scope,
          sap,
          objects,
          materials,
          version: current,
          comments,
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
        ['write_artifact', 'edit_artifact'].includes(name)
          ? { ...args, content: undefined, old_text: undefined, new_text: undefined }
          : args,
      truncatedHint:
        '输出被截断，工具参数不完整。请把内容拆小，用 write_artifact 的 append 模式分段续写。',
    }));
  } catch (e) {
    // Preparing the turn failed before the loop started.
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
  } finally {
    await sap.close?.();
    // Whatever happened, keep the work done so far and release the session.
    try {
      if (workspace?.state.changed) {
        const { state } = workspace;
        const comparison = compareDeclarations(state.base, state, state.declarations);
        await save({
          plan: state.plan,
          code: state.code,
          source: 'assistant',
          changes: state.declarations,
          comparison,
        });
      }
    } catch (e) {
      status = 'failed';
      error = { code: 'VERSION_SAVE_FAILED', message: String(e.message).slice(0, 500) };
    }
    await repo
      .finishTurn(pool, sessionId, turnId, { status, stopReason, usage, error })
      .catch(() => {});
    emit('turn.end', { status, stopReason, version, usage, error });
  }
  return { status, stopReason, version };
}
