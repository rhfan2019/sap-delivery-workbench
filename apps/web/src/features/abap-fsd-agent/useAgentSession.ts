import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type {
  AgentArtifact,
  AgentAttachment,
  AgentComment,
  AgentDecision,
  AgentMessage,
  AgentStep,
} from '@sap-delivery-workbench/contracts/abap-fsd-agent/types';
import { createSseParser } from '@sap-delivery-workbench/contracts/abap-fsd-agent/sse';
import { api, identity } from '../../services/session';
import { reconnectingChatStream } from './chatStream.mjs';
import {
  answersFromValues,
  buildTimeline,
  decisionFromQuestions,
  pendingQuestions,
  stepFromToolCall,
  type AskedQuestion,
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
export interface SessionDocument extends AgentArtifact {
  changes?: unknown[];
}

// One abap-fsd-agent conversation: history, the live turn, the document and its comments.
export function useAgentSession(base: string) {
  const sessionId = ref('');
  const messages = ref<AgentMessage[]>([]);
  const steps = ref<AgentStep[]>([]);
  const decision = ref<AgentDecision | null>(null);
  const status = ref<Status>('idle');
  const error = ref('');
  const generationNote = ref('');
  const document = shallowRef<SessionDocument | null>(null);
  const documents = ref<
    { version: number; labels: string[]; createdAt: string; turnId: string | null }[]
  >([]);
  const draftMarkdown = ref('');
  const comments = ref<AgentComment[]>([]);
  const attachments = ref<AgentAttachment[]>([]);
  const canEdit = ref(false);
  const busy = computed(() => ['waiting', 'streaming', 'stopping'].includes(status.value));
  let questions: AskedQuestion[] = [];
  let reader: AbortController | null = null;
  let disposed = false;

  function adopt(detail: any) {
    canEdit.value = !!detail.canEdit;
    messages.value = buildTimeline(detail);
    const pending = pendingQuestions(detail);
    questions = pending?.questions ?? [];
    decision.value = pending ? decisionFromQuestions(pending.id, pending.questions) : null;
    document.value = detail.document
      ? { ...detail.document, id: 'v' + detail.document.version, revision: detail.document.version }
      : null;
    documents.value = detail.documents ?? [];
    comments.value = detail.comments ?? [];
    attachments.value = detail.attachments ?? [];
    draftMarkdown.value = '';
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
    else if (decision.value) status.value = 'waiting_user';
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
      generationNote.value = '';
      if (!disposed && sessionId.value) {
        const final = status.value;
        await refresh().catch(() => {});
        if (decision.value) status.value = 'waiting_user';
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
      generationNote.value = '';
    } else if (event.type === 'delta' && d.type === 'reasoning') generationNote.value = '正在思考…';
    else if (event.type === 'step')
      generationNote.value = d.retry
        ? `模型服务繁忙，${Math.round(d.waitMs / 1000)} 秒后第 ${d.retry} 次重试…`
        : `正在分析（第 ${d.step} 步）…`;
    else if (event.type === 'tool.start') {
      steps.value.push({
        ...stepFromToolCall({ id: d.id, name: d.name, status: 'running' }),
        summary: '执行中…',
      });
      generationNote.value = '';
    } else if (event.type === 'tool.end') {
      const index = steps.value.findIndex((s) => s.stepId === d.id);
      const step = stepFromToolCall({
        id: d.id,
        name: d.name,
        status: d.status,
        summary: d.summary,
      });
      if (index >= 0) steps.value[index] = step;
      else steps.value.push(step);
      if (d.questions) {
        questions = d.questions;
        decision.value = decisionFromQuestions(d.id, d.questions);
      }
    } else if (event.type === 'document.draft') draftMarkdown.value = d.markdown;
    else if (event.type === 'document.saved')
      message.artifact = {
        id: 'v' + d.version,
        revision: d.version,
        markdown: '',
        comparison: d.comparison,
      };
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
    const started = await api<{ turnId: string }>(
      `${base}/sessions/${sessionId.value}/messages`,
      { content, ...(answers ? { answers } : {}) },
      'POST',
    );
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

  async function openVersion(version: number): Promise<SessionDocument> {
    const doc = await api<any>(`${base}/sessions/${sessionId.value}/documents/${version}`);
    return { ...doc, id: 'v' + doc.version, revision: doc.version };
  }

  onScopeDispose(() => {
    disposed = true;
    reader?.abort();
  });

  const statusLabel = computed(
    () =>
      ({
        idle: '',
        waiting: '等待模型回复…',
        streaming: '正在输出…',
        stopping: '正在停止…',
        waiting_user: '请回答问题后继续',
        completed: '回复完成',
        failed: '本轮未完成',
        cancelled: '已停止',
      })[status.value],
  );

  return {
    sessionId,
    messages,
    steps,
    decision,
    status,
    statusLabel,
    busy,
    error,
    generationNote,
    document,
    documents,
    draftMarkdown,
    comments,
    attachments,
    canEdit,
    load,
    refresh,
    create,
    send,
    answer,
    stop,
    openVersion,
  };
}
