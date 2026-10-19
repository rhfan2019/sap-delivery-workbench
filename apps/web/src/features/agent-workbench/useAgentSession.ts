import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type {
  AgentAttachment,
  AgentDecision,
  AgentMessage,
  AgentStep,
} from '@sap-delivery-workbench/contracts/agent-core/types';
import { createSseParser } from '@sap-delivery-workbench/contracts/agent-core/sse';
import { api, ApiError, identity } from '../../services/session';
import { reconnectingChatStream } from './chatStream.mjs';
import {
  answersFromValues,
  buildTimeline,
  decisionFromQuestions,
  pendingQuestions,
  pendingTestData,
  preparingText,
  reasoningHeading,
  runningText,
  stepFromToolCall,
  type AskedQuestion,
  type TestDataRequest,
} from './session-model.mjs';

type Status =
  | 'idle'
  | 'waiting'
  | 'streaming'
  | 'stopping'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';
// One agent conversation: history, the live turn, its files and comments. What the agent
// produces (an FSD, a plan and code) stays in `detail` and `drafts` for the agent's panel.
export function useAgentSession(base: string) {
  // The project SAP system the next message reads (contract 3.4); empty means the agent's
  // default. Remembered per assistant and item.
  const sapKey = 'sap-system:' + base;
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(sapKey);
  } catch {}
  const sapSystemId = ref(remembered ?? '');
  watch(sapSystemId, (value) => {
    try {
      localStorage.setItem(sapKey, value);
    } catch {}
  });
  // The model the next message runs on (spec 4.3); empty means the organization default.
  // Remembered per organization, user and assistant, like the SAP system.
  const modelKey = `agent-model:${identity.value?.organization.id}:${identity.value?.user.id}:${base.split('/').pop()}`;
  let rememberedModel: string | null = null;
  try {
    rememberedModel = localStorage.getItem(modelKey);
  } catch {}
  const modelId = ref(rememberedModel ?? '');
  watch(modelId, (value) => {
    try {
      localStorage.setItem(modelKey, value);
    } catch {}
  });
  // A picked model the organization removed: forget it, so the next message uses the default.
  async function post<T>(url: string, body: Record<string, unknown>) {
    try {
      return await api<T>(url, { ...body, modelId: modelId.value || undefined }, 'POST');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MODEL_UNAVAILABLE') modelId.value = '';
      throw e;
    }
  }
  const sessionId = ref('');
  const messages = ref<AgentMessage[]>([]);
  const steps = ref<AgentStep[]>([]);
  const decision = ref<AgentDecision | null>(null);
  // A test data request awaiting the user's authorization (contract 3.4).
  const testData = ref<TestDataRequest | null>(null);
  const status = ref<Status>('idle');
  const error = ref('');
  // The live status line: what the agent is doing now, and when anything last arrived.
  const liveNote = ref({ text: '', at: Date.now() });
  const note = (text: string) => (liveNote.value = { text, at: Date.now() });
  let reasoning = '';
  // Most SAP lookups take a fraction of a second; naming them would make the line flicker
  // between "正在查阅…" and "正在思考下一步…". Only a call still running after a moment is named.
  let toolNote: ReturnType<typeof setTimeout> | undefined;
  const TOOL_NOTE_DELAY_MS = 800;
  // The session as the API returned it, and the live text of artifacts being written.
  const detail = shallowRef<any>(null);
  const drafts = ref<Record<string, string>>({});
  const comments = ref<any[]>([]);
  // A comment on a selection in the artifact panel goes into the conversation, the way Claude
  // quotes a selection into a reply: the composer appends it to the draft for the user to send.
  const quoted = ref<{ text: string; at: number } | null>(null);
  function quote(source: string, anchor: string, body: string) {
    const lines = anchor
      .trim()
      .split('\n')
      .map((line) => '> ' + line);
    quoted.value = {
      text: `关于${source}的这段：\n${lines.join('\n')}\n\n${body}`,
      at: Date.now(),
    };
  }
  const attachments = ref<AgentAttachment[]>([]);
  const canEdit = ref(false);
  // Marking a version final needs agent.<stage>:finalize (contract 3.5).
  const canFinalize = ref(false);
  const busy = computed(() => ['waiting', 'streaming', 'stopping'].includes(status.value));
  let questions: AskedQuestion[] = [];
  let reader: AbortController | null = null;
  let disposed = false;

  function adopt(data: any) {
    detail.value = data;
    canEdit.value = !!data.canEdit;
    canFinalize.value = !!data.canFinalize;
    messages.value = buildTimeline(data);
    const pending = pendingQuestions(data);
    questions = pending?.questions ?? [];
    decision.value = pending ? decisionFromQuestions(pending.id, pending.questions) : null;
    testData.value = pendingTestData(data);
    comments.value = data.comments ?? [];
    attachments.value = data.attachments ?? [];
    drafts.value = {};
    steps.value = [];
  }

  async function refresh() {
    if (!sessionId.value) return null;
    const detail = await api<any>(`${base}/sessions/${sessionId.value}`);
    if (disposed) return detail;
    adopt(detail);
    return detail;
  }

  async function load(id: string) {
    reader?.abort();
    sessionId.value = id;
    status.value = 'idle';
    error.value = '';
    messages.value = [];
    if (!id) {
      adopt({});
      return;
    }
    const detail = await refresh();
    if (detail?.session?.activeTurnId) void follow(detail.session.activeTurnId, true);
    else if (decision.value || testData.value) status.value = 'waiting_user';
  }

  async function create(title = '') {
    const created = await api<{ id: string }>(base + '/sessions', { title }, 'POST');
    await load(created.id);
    return created.id;
  }

  function live(turnId: string): AgentMessage {
    let message = messages.value.find((m) => m.runId === turnId && m.role === 'assistant');
    if (!message) {
      messages.value.push({
        id: 'turn-' + turnId,
        role: 'assistant',
        runId: turnId,
        content: '',
        status: 'completed',
        createdAt: new Date().toISOString(),
      });
      message = messages.value.at(-1)!;
    }
    return message;
  }

  // Follows one turn's events until it ends; `replay` rebuilds a turn already in progress.
  async function follow(turnId: string, replay = false) {
    reader = new AbortController();
    status.value = 'waiting';
    const message = live(turnId);
    if (replay) message.content = '';
    steps.value = [];
    reasoning = '';
    note('正在理解需求…');
    try {
      const response = await reconnectingChatStream(
        `/api${base}/sessions/${sessionId.value}/turns/${turnId}/events`,
        { signal: reader.signal },
      );
      if (!response.ok || !response.body) throw new Error('无法订阅助手回复，请刷新后重试。');
      const parser = createSseParser(),
        decoder = new TextDecoder();
      const stream = response.body.getReader();
      for (;;) {
        const { value, done } = await stream.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true })))
          apply(message, JSON.parse(frame.data));
      }
    } catch (cause) {
      if (reader?.signal.aborted || disposed) return;
      status.value = 'failed';
      error.value = cause instanceof Error ? cause.message : '连接中断。';
    } finally {
      reader = null;
      clearTimeout(toolNote);
      note('');
      if (!disposed && sessionId.value) {
        const final = status.value;
        await refresh().catch(() => {});
        if (decision.value || testData.value) status.value = 'waiting_user';
        else if (['waiting', 'streaming', 'stopping'].includes(final)) status.value = 'completed';
        else status.value = final;
      }
    }
  }

  function apply(message: AgentMessage, event: { type: string; data: any }) {
    const d = event.data ?? {};
    if (event.type === 'delta' && d.type === 'text') {
      message.content += d.text;
      if (status.value !== 'stopping') status.value = 'streaming';
      note('正在输出回复…');
    } else if (event.type === 'delta' && d.type === 'reasoning') {
      reasoning += d.text;
      const heading = reasoningHeading(reasoning.slice(-2000));
      note(heading ? `正在思考：${heading}` : '正在思考…');
    } else if (event.type === 'step') {
      reasoning = '';
      note(
        d.retry
          ? `模型服务繁忙，${Math.round(d.waitMs / 1000)} 秒后第 ${d.retry} 次重试…`
          : d.step > 1
            ? '正在思考下一步…'
            : '正在理解需求…',
      );
    } else if (event.type === 'tool.prepare') note(preparingText(d));
    else if (event.type === 'tool.start') {
      const step = stepFromToolCall({
        id: d.id,
        name: d.name,
        status: 'running',
        arguments: d.arguments,
      });
      steps.value.push({ ...step, summary: '执行中…' });
      clearTimeout(toolNote);
      toolNote = setTimeout(() => note(runningText(step)), TOOL_NOTE_DELAY_MS);
    } else if (event.type === 'tool.end') {
      clearTimeout(toolNote);
      const index = steps.value.findIndex((s) => s.stepId === d.id);
      const step = stepFromToolCall({
        id: d.id,
        name: d.name,
        status: d.status,
        summary: d.summary,
        // tool.end does not repeat the arguments; keep those tool.start brought.
        arguments: index >= 0 ? steps.value[index].input : undefined,
        preview: d.preview,
        durationMs: d.durationMs,
      });
      if (index >= 0) steps.value[index] = step;
      else steps.value.push(step);
      if (d.questions) {
        questions = d.questions;
        decision.value = decisionFromQuestions(d.id, d.questions);
      }
      if (d.testDataRequest) testData.value = d.testDataRequest;
    } else if (event.type === 'document.draft')
      drafts.value = { ...drafts.value, document: d.markdown };
    else if (event.type === 'artifact.draft')
      drafts.value = { ...drafts.value, [d.target]: d.text };
    else if (event.type === 'document.saved' || event.type === 'version.saved')
      message.artifact = { id: 'v' + d.version, revision: d.version, comparison: d.comparison };
    else if (event.type === 'turn.end') {
      message.status =
        d.status === 'completed' ? 'completed' : d.status === 'cancelled' ? 'cancelled' : 'failed';
      if (d.error) message.error = d.error.message;
      status.value =
        d.status === 'completed' ? 'completed' : d.status === 'cancelled' ? 'cancelled' : 'failed';
      if (d.error) error.value = d.error.message;
    }
  }

  async function send(
    content: string,
    answers?: { question: string; choice: string; note?: string }[],
  ) {
    if (busy.value || (!content.trim() && !answers?.length)) return false;
    if (!sessionId.value) await create(content.slice(0, 60));
    error.value = '';
    decision.value = null;
    // A new message supersedes an open test data request.
    testData.value = null;
    const started = await post<{ turnId: string }>(`${base}/sessions/${sessionId.value}/messages`, {
      content,
      sapSystemId: sapSystemId.value || undefined,
      ...(answers ? { answers } : {}),
    });
    messages.value.push({
      id: 'local-' + started.turnId,
      role: 'user',
      content: answers?.length
        ? answers
            .map((a) => `${a.question}：${a.choice}${a.note ? '（' + a.note + '）' : ''}`)
            .join('\n') + (content.trim() ? '\n' + content : '')
        : content,
      status: 'completed',
      createdAt: new Date().toISOString(),
      authorName: identity.value?.user.displayName,
      ...(answers?.length ? { answered: answers.length } : {}),
    });
    void follow(started.turnId);
    return true;
  }

  // Approves or rejects the pending test data request; the next turn runs it.
  async function authorize(decision: 'approve' | 'reject', note = '') {
    const request = testData.value;
    if (busy.value || !request || !sessionId.value) return false;
    error.value = '';
    const started = await post<{ turnId: string }>(`${base}/sessions/${sessionId.value}/messages`, {
      authorization: { requestId: request.id, decision, note },
      sapSystemId: sapSystemId.value || undefined,
    });
    testData.value = null;
    messages.value.push({
      id: 'local-' + started.turnId,
      role: 'user',
      content:
        decision === 'approve'
          ? `同意在 QAS 建立测试数据（${request.dataId} ${request.object}）。`
          : `不同意建立测试数据（${request.dataId} ${request.object}）${note ? '：' + note : '。'}`,
      status: 'completed',
      createdAt: new Date().toISOString(),
      authorName: identity.value?.user.displayName,
    });
    void follow(started.turnId);
    return true;
  }

  async function answer(values: Record<string, string>, note = '') {
    if (!questions.length) return;
    await send(note, answersFromValues(questions, values));
  }

  async function stop() {
    if (!busy.value || !sessionId.value) return;
    status.value = 'stopping';
    try {
      await api(`${base}/sessions/${sessionId.value}/cancel`, {}, 'POST');
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '停止失败，请重试。';
      status.value = 'streaming';
    }
  }

  onScopeDispose(() => {
    disposed = true;
    reader?.abort();
  });

  return {
    sessionId,
    messages,
    steps,
    decision,
    testData,
    sapSystemId,
    modelId,
    status,
    busy,
    error,
    liveNote,
    detail,
    drafts,
    comments,
    quoted,
    quote,
    attachments,
    canEdit,
    canFinalize,
    load,
    refresh,
    create,
    send,
    answer,
    authorize,
    stop,
  };
}
