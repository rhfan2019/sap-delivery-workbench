import type {
  AgentStep,
  AgentDecision,
  AgentArtifact,
  AgentSelection,
  AgentMessage,
  RunReceipt,
} from '@sap-delivery-workbench/contracts/agent-runtime/types';
import { computed, onScopeDispose, ref } from 'vue';
import { api, identity } from '../../services/session';
import { createSseParser } from '@sap-delivery-workbench/contracts/agent-runtime/sse';
import type { ModelRecord } from '../models/types';

type SendOptions = {
  action?: 'dialogue' | 'draft' | 'auto';
  riceType?: string | null;
  attachmentIds?: string[];
  resumeRunId?: string;
  retryRunId?: string;
  decisionAnswer?: { decisionId: string; values: Record<string, string> };
};
type RequestSnapshot = {
  model: ModelRecord;
  prompt: string;
  selection: AgentSelection;
  options: SendOptions;
  history: AgentMessage[];
};
type Status =
  | 'waiting_user'
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'streaming'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled';
export function useAssistantRun(
  config: {
    base?: string;
    storageScope?: string | (() => string);
    selection?: AgentSelection | (() => AgentSelection | undefined);
  } = {},
) {
  const base = config.base ?? '/admin/abap-fsd-agent';
  const decision = ref<AgentDecision | null>(null);
  const storageKey = () =>
    'fs-assistant-run:' +
    identity.value?.organization?.id +
    ':' +
    identity.value?.user?.id +
    (config.storageScope
      ? ':' +
        (typeof config.storageScope === 'function' ? config.storageScope() : config.storageScope)
      : '');
  const remember = (id: string) => {
    try {
      localStorage.setItem(storageKey(), id);
    } catch {}
  };
  const status = ref<Status>('idle'),
    promptSent = ref(''),
    responseText = ref(''),
    runModel = ref(''),
    error = ref('');
  const messages = ref<AgentMessage[]>([]);
  const steps = ref<AgentStep[]>([]),
    artifact = ref<AgentArtifact | null>(null),
    artifacts = ref<AgentArtifact[]>([]),
    conversationId = ref('');
  async function ensureConversation(selection: AgentSelection) {
    if (!conversationId.value) {
      const r = await api<{ conversationId: string }>(
        base + '/conversations',
        { selection },
        'POST',
      );
      conversationId.value = r.conversationId;
    }
    return conversationId.value;
  }
  const receipt = ref<RunReceipt | null>(null);
  const generationNote = ref(''),
    diagnosticId = ref(''),
    canRetry = ref(false);
  let lastRequest: RequestSnapshot | null = null;
  let assistantId = '';
  let restorePoll: ReturnType<typeof setTimeout> | undefined;
  let lifecycle = 0;
  const active = ref(false);
  const busy = computed(() => active.value);
  let runId = '',
    disposed = false,
    stopRequested = false,
    readerController: AbortController | null = null;
  let buffered = '',
    frame = 0;
  function pollRestoredRun(epoch: number, id: string) {
    restorePoll = setTimeout(async () => {
      if (disposed || epoch !== lifecycle) return;
      try {
        const saved = await api<any>(base + '/runs/' + id);
        if (disposed || epoch !== lifecycle) return;
        error.value = '';
        steps.value = saved.snapshot?.plan?.steps ?? [];
        messages.value = (saved.history ?? []).map((m: AgentMessage) => ({
          ...m,
          clockOffsetMs: saved.serverTime ? Date.parse(saved.serverTime) - Date.now() : 0,
        }));
        generationNote.value = saved.snapshot?.generationProgress?.message ?? '';
        if (['queued', 'running'].includes(saved.state)) {
          pollRestoredRun(epoch, id);
          return;
        }
        active.value = false;
        status.value = saved.state;
        decision.value = saved.state === 'waiting_user' ? saved.snapshot?.decision : null;
        artifact.value = saved.latestArtifact ?? saved.artifact ?? null;
        artifacts.value = saved.artifacts ?? [];
        canRetry.value = !!lastRequest && saved.state !== 'waiting_user';
        generationNote.value = '';
      } catch {
        if (!disposed && epoch === lifecycle) {
          error.value = '运行状态暂未同步，正在重试；可打开日志查看。';
          pollRestoredRun(epoch, id);
        }
      }
    }, 2000);
  }
  function flush() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    responseText.value += buffered;
    buffered = '';
    const message = messages.value.find((m) => m.id === assistantId);
    if (message) message.content = responseText.value;
  }
  function append(text: string) {
    buffered += text;
    if (!frame) frame = requestAnimationFrame(flush);
  }
  async function cancelRemote(id: string) {
    return api<{ status: string }>(base + '/runs/' + id + '/cancel', {}, 'POST');
  }
  async function refreshHistory(id: string) {
    const epoch = lifecycle;
    const saved = await api<any>(base + '/runs/' + id);
    if (disposed || epoch !== lifecycle || id !== runId) return saved;
    if (Array.isArray(saved.history)) {
      const localTerminal = messages.value.find((m) => m.runId === id && m.role === 'assistant');
      const persistencePending = ['queued', 'running'].includes(saved.state);
      messages.value = saved.history.map((message: AgentMessage) =>
        persistencePending && localTerminal && message.runId === id && message.role === 'assistant'
          ? { ...localTerminal, id: message.id }
          : message,
      );
    }
    if (Array.isArray(saved.artifacts)) artifacts.value = saved.artifacts;
    artifact.value = saved.latestArtifact ?? saved.artifact ?? artifact.value;
    return saved;
  }
  async function stop() {
    if (!busy.value || !['creating', 'waiting', 'streaming'].includes(status.value)) return;
    const stoppedRun = runId;
    stopRequested = true;
    status.value = 'stopping';
    if (runId) {
      try {
        await cancelRemote(runId);
      } catch (cause) {
        if (disposed || runId !== stoppedRun || status.value !== 'stopping') return;
        error.value = cause instanceof Error ? cause.message : '停止请求失败，请重试。';
        stopRequested = false;
        status.value = 'streaming';
      }
    }
  }
  async function send(
    model: ModelRecord,
    prompt: string,
    selection: AgentSelection = {},
    options: SendOptions = {},
    retryHistory?: AgentMessage[],
  ) {
    if (busy.value || !prompt.trim()) return;
    lifecycle++;
    if (conversationId.value && lastRequest) selection = lastRequest.selection;
    flush();
    const history =
      retryHistory ??
      messages.value
        .filter((m) => m.status !== 'waiting_user' && !m.decision)
        .map(({ id, role, content, status }) => ({
          id,
          role,
          content,
          status,
        }));
    lastRequest = JSON.parse(JSON.stringify({ model, prompt, selection, options, history }));
    canRetry.value = false;
    generationNote.value = '';
    diagnosticId.value = '';
    steps.value = [];
    receipt.value = null;
    const userId = crypto.randomUUID();
    assistantId = crypto.randomUUID();
    messages.value.push(
      {
        id: userId,
        role: 'user',
        content: prompt,
        status: 'failed',
        createdAt: new Date().toISOString(),
        authorName: identity.value?.user.displayName,
        authorId: identity.value?.user.id,
      },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        status: 'failed',
        model: model.name,
        createdAt: new Date().toISOString(),
        action: options.action === 'auto' ? 'dialogue' : (options.action ?? 'dialogue'),
      },
    );
    responseText.value = '';
    promptSent.value = prompt;
    runModel.value = model.name;
    error.value = '';
    active.value = true;
    status.value = 'creating';
    runId = options.resumeRunId ?? '';
    stopRequested = false;
    let terminal = false,
      lastSeq = 0;
    try {
      const created = await api<RunReceipt>(
        base + '/runs',
        {
          modelId: model.id,
          rowVersion: model.rowVersion,
          prompt,
          messages: history,
          selection,
          requestId: crypto.randomUUID(),
          ...(conversationId.value ? { conversationId: conversationId.value } : {}),
          ...options,
        },
        'POST',
      );
      runId = created.runId;
      remember(runId);
      decision.value = null;
      diagnosticId.value = runId;
      receipt.value = created;
      conversationId.value = created.conversationId ?? conversationId.value;
      steps.value = created.plan?.steps ?? [];
      const user = messages.value.find((m) => m.id === userId);
      if (user) user.status = 'completed';
      const assistant = messages.value.find((m) => m.id === assistantId);
      if (assistant) {
        assistant.runId = runId;
        assistant.createdAt = created.createdAt ?? assistant.createdAt;
        assistant.clockOffsetMs = created.serverTime
          ? Date.parse(created.serverTime) - Date.now()
          : 0;
        assistant.action = created.action ?? assistant.action;
      }
      if (disposed) {
        await cancelRemote(runId);
        return;
      }
      if (stopRequested) await cancelRemote(runId);
      else status.value = 'waiting';
      readerController = new AbortController();
      const response = await fetch('/api' + base + '/runs/' + runId + '/events', {
        credentials: 'same-origin',
        signal: readerController.signal,
        headers: { Accept: 'text/event-stream' },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '无法订阅模型回复，请重新发送。');
      }
      if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream'))
        throw new Error('服务未返回可读取的流式响应。');
      const reader = response.body.getReader(),
        decoder = new TextDecoder('utf-8', { fatal: true }),
        parser = createSseParser();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of parser.push(decoder.decode(value, { stream: true }))) {
            const event = JSON.parse(item.data);
            if (event.runId !== runId || !Number.isSafeInteger(event.seq))
              throw new Error('流式事件标识异常。');
            if (event.seq <= lastSeq) continue;
            if (event.seq !== lastSeq + 1 || terminal) throw new Error('流式事件顺序异常。');
            lastSeq = event.seq;
            if (event.type === 'message.reset') {
              flush();
              responseText.value = '';
              const message = messages.value.find((m) => m.id === assistantId);
              if (message) message.content = '';
            } else if (event.type === 'message.delta' || event.type === 'technical.delta') {
              if (typeof event.data?.text !== 'string') throw new Error('流式文本无效。');
              append(event.data.text);
              if (!stopRequested) status.value = 'streaming';
            } else if (event.type === 'generation.progress') {
              generationNote.value = event.data?.message ?? '正在继续生成…';
              if (event.data?.lastContentAt)
                generationNote.value +=
                  ' · 最后正文进展 ' +
                  new Date(event.data.lastContentAt).toLocaleTimeString('zh-CN', { hour12: false });
            } else if (event.type === 'step.updated') {
              generationNote.value = '';
              const index = steps.value.findIndex((s) => s.stepId === event.data.stepId);
              if (index >= 0) steps.value[index] = event.data;
              else {
                const successor = steps.value.findIndex((s) =>
                  s.dependencies?.includes(event.data.stepId),
                );
                const prior = steps.value.findIndex((s) =>
                  event.data.dependencies?.includes(s.stepId),
                );
                steps.value.splice(
                  successor >= 0 ? successor : prior >= 0 ? prior + 1 : steps.value.length,
                  0,
                  event.data,
                );
              }
            } else if (event.type === 'artifact.ready') {
              artifact.value = event.data;
              const owner = messages.value.find((m) => m.id === assistantId);
              if (owner) owner.artifact = event.data;
            } else if (event.type === 'run.waiting_user') {
              flush();
              status.value = 'waiting_user';
              decision.value = event.data.decision;
              responseText.value = '';
              const m = messages.value.find((m) => m.id === assistantId);
              if (m) {
                m.content = '';
                m.decision = event.data.decision;
              }
              terminal = true;
            } else if (event.type === 'run.completed') {
              flush();
              status.value = 'completed';
              terminal = true;
            } else if (event.type === 'run.cancelled') {
              flush();
              status.value = 'cancelled';
              terminal = true;
            } else if (event.type === 'run.failed') {
              flush();
              status.value = 'failed';
              error.value = event.data?.message || '调用失败。';
              const failedMessage = messages.value.find((m) => m.id === assistantId);
              if (failedMessage)
                Object.assign(failedMessage, {
                  error: error.value,
                  errorCode: event.data?.code,
                  finishReason: event.data?.finishReason,
                  outputLimit: event.data?.outputLimit,
                });
              terminal = true;
            }
          }
          if (terminal) break;
        }
        parser.push(decoder.decode());
        parser.finish();
        if (!terminal) throw new Error('连接已中断，回复可能不完整。请重新发送。');
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (cause) {
      if (!disposed) {
        flush();
        status.value = 'failed';
        error.value = cause instanceof Error ? cause.message : '调用失败，请重试。';
      }
      if (runId && !terminal && runId !== options.resumeRunId)
        void cancelRemote(runId).catch(() => {});
    } finally {
      flush();
      readerController = null;
      const message = messages.value.find((m) => m.id === assistantId);
      if (message)
        message.finishedAt = new Date(Date.now() + (message.clockOffsetMs ?? 0)).toISOString();
      if (message)
        message.status =
          status.value === 'waiting_user'
            ? 'waiting_user'
            : status.value === 'completed'
              ? 'completed'
              : status.value === 'cancelled'
                ? 'cancelled'
                : 'failed';
      if (message && status.value === 'failed') message.error = error.value;
      canRetry.value =
        !!lastRequest && !disposed && !decision.value && status.value !== 'waiting_user';
      generationNote.value = '';
      if (terminal && !disposed) {
        try {
          await refreshHistory(runId);
        } catch {
          error.value = '运行已结束，历史同步暂不可用；刷新后可重试恢复。';
        }
      }
      active.value = false;
    }
  }
  async function retry() {
    if (busy.value || !lastRequest) return;
    const r = lastRequest;
    const { resumeRunId, decisionAnswer, ...options } = r.options;
    await send(
      r.model,
      r.prompt,
      r.selection,
      { ...options, ...(runId ? { retryRunId: runId } : {}) },
      r.history,
    );
  }
  async function answer(values: Record<string, string>) {
    if (!decision.value || !lastRequest || busy.value) return;
    const r = lastRequest;
    await send(
      r.model,
      r.prompt,
      r.selection,
      {
        ...r.options,
        resumeRunId: runId,
        decisionAnswer: { decisionId: decision.value.id, values },
      },
      r.history,
    );
  }
  async function restore(models: ModelRecord[], id?: string) {
    if (busy.value || messages.value.length) return;
    const epoch = lifecycle;
    try {
      const saved = id ?? localStorage.getItem(storageKey());
      if (!saved) {
        error.value = '当前目标没有可恢复的测试会话，可以直接开始新对话。';
        return;
      }
      const r = await api<any>(base + '/runs/' + saved);
      if (disposed || epoch !== lifecycle) return;
      const expected =
        typeof config.selection === 'function' ? config.selection() : config.selection;
      if (
        expected &&
        ['projectId', 'itemId', 'workspaceStage'].some(
          (key) =>
            (r.snapshot.input?.selection?.[key] ?? null) !==
            (expected[key as keyof AgentSelection] ?? null),
        )
      ) {
        throw new Error('历史会话归属与当前开发项目标不一致，请开始新对话。');
      }
      if ((r.latestRunId && r.latestRunId !== r.runId) || r.snapshot.resolvedRunId) {
        await restore(models, r.latestRunId ?? r.snapshot.resolvedRunId);
        return;
      }
      runId = r.runId;
      remember(runId);
      diagnosticId.value = runId;
      conversationId.value = r.conversationId;
      steps.value = r.snapshot.plan?.steps ?? [];
      receipt.value = { runId, conversationId: r.conversationId, plan: r.snapshot.plan };
      const input = r.snapshot.input;
      const model = models.find((m) => m.id === input?.modelId);
      if (model && input)
        lastRequest = {
          model: { ...model },
          prompt: r.snapshot.prompt,
          selection: input.selection,
          options: {
            action: input.action,
            riceType: input.riceType,
            attachmentIds: input.attachmentIds,
          },
          history: r.snapshot.messages ?? [],
        };
      status.value =
        r.state === 'waiting_user' && r.snapshot.decision
          ? 'waiting_user'
          : r.state === 'completed'
            ? 'completed'
            : r.state === 'cancelled'
              ? 'cancelled'
              : 'failed';
      decision.value = status.value === 'waiting_user' ? r.snapshot.decision : null;
      artifact.value = r.latestArtifact ?? r.artifact;
      artifacts.value = r.artifacts ?? (r.artifact ? [r.artifact] : []);
      assistantId = crypto.randomUUID();
      messages.value = r.history ?? [
        ...(r.snapshot.messages ?? []),
        { id: crypto.randomUUID(), role: 'user', content: r.snapshot.prompt, status: 'completed' },
        {
          id: assistantId,
          role: 'assistant',
          content: decision.value ? '' : (r.snapshot.text ?? ''),
          status:
            status.value === 'waiting_user'
              ? 'waiting_user'
              : status.value === 'completed'
                ? 'completed'
                : 'failed',
          action: input?.action,
          runId,
          artifact: r.artifact ?? undefined,
          error:
            status.value === 'failed'
              ? (r.snapshot.failure?.message ?? '此运行未完整结束；已恢复需求与参数，可重新生成。')
              : undefined,
        },
      ];
      canRetry.value = !!lastRequest && status.value !== 'waiting_user';
      if (['queued', 'running'].includes(r.state)) {
        active.value = true;
        status.value = 'streaming';
        messages.value = messages.value.map((m) => ({
          ...m,
          clockOffsetMs: r.serverTime ? Date.parse(r.serverTime) - Date.now() : 0,
        }));
        generationNote.value = r.snapshot?.generationProgress?.message ?? '正在恢复运行进度…';
        canRetry.value = false;
        pollRestoredRun(epoch, runId);
      }
      if (decision.value && !model)
        error.value = '原模型不可用，请恢复模型配置后刷新；问题和需求已保存。';
    } catch (e) {
      if (!disposed && epoch === lifecycle)
        error.value = e instanceof Error ? e.message : '恢复失败';
    }
  }
  onScopeDispose(() => {
    clearTimeout(restorePoll);
    disposed = true;
    lifecycle++;
    flush();
    readerController?.abort();
    if (runId && busy.value)
      void fetch('/api' + base + '/runs/' + runId + '/cancel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true,
      }).catch(() => {});
  });
  const statusLabel = computed(
    () =>
      ({
        waiting_user: '等待你确认，原需求与附件已保留',
        idle: '',
        creating: '正在校验目标并识别SAP系统…',
        waiting: '等待模型首字…',
        streaming: '正在输出…',
        stopping: '正在停止…',
        completed: '回复完成',
        failed: '本次生成未完成',
        cancelled: '已停止 · 回复不完整',
      })[status.value],
  );
  function reset() {
    if (active.value) return;
    lifecycle++;
    clearTimeout(restorePoll);
    try {
      localStorage.removeItem(storageKey());
    } catch {}
    decision.value = null;
    messages.value = [];
    steps.value = [];
    artifact.value = null;
    artifacts.value = [];
    conversationId.value = '';
    receipt.value = null;
    lastRequest = null;
    canRetry.value = false;
    generationNote.value = '';
    diagnosticId.value = '';
    assistantId = '';
    runId = '';
    promptSent.value = '';
    responseText.value = '';
    error.value = '';
    status.value = 'idle';
  }
  return {
    answer,
    restore,
    decision,
    retry,
    canRetry,
    generationNote,
    diagnosticId,
    messages,
    steps,
    artifact,
    artifacts,
    conversationId,
    ensureConversation,
    receipt,
    reset,
    status,
    statusLabel,
    busy,
    promptSent,
    responseText,
    runModel,
    error,
    send,
    stop,
  };
}
