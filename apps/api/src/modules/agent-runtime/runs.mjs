import { abortable } from './cancellation.mjs';
import { randomUUID } from 'node:crypto';
import { failure } from '../../platform/auth.mjs';
import { streamAssistant } from './generation.mjs';
import { classifyFailure } from './errors.mjs';

// S01 uses a bounded, short-lived in-process store behind a replaceable service boundary.
export function createRunStore({ generate = streamAssistant, persistTimeoutMs = 5000 } = {}) {
  const runs = new Map(),
    active = new Set();
  function prune() {
    for (const [id, run] of runs)
      if (run.status !== 'running' && Date.now() - run.finishedAt > 300000) runs.delete(id);
  }
  const cleanup = setInterval(prune, 30000);
  cleanup.unref();
  function emit(run, type, data) {
    const event = { version: 1, runId: run.id, seq: run.events.length + 1, type, data };
    const size = Buffer.byteLength(JSON.stringify(event));
    if (type === 'message.delta' && (run.eventBytes + size > 2097152 || run.events.length > 8190))
      throw failure(502, '流式回复超过缓冲上限。');
    run.eventBytes += size;
    run.events.push(event);
    if (!['message.delta', 'technical.delta', 'generation.progress'].includes(type))
      run.recorder?.write(type, data);
    for (const listener of run.listeners) listener(event);
  }
  function finish(run, status, data = {}) {
    if (run.status !== 'running') return;
    run.status = status;
    run.finishedAt = Date.now();
    emit(run, 'run.' + status, data);
  }
  function cancel(run) {
    if (run.status !== 'running' || run.commitStarted) return;
    for (const s of run.metadata.plan?.steps ?? []) {
      if (['queued', 'running', 'waiting_user'].includes(s.status)) {
        s.status = s.status === 'running' ? 'cancelled' : 'skipped';
        s.summary = '运行已停止';
        s.finishedAt = new Date().toISOString();
        emit(run, 'step.updated', structuredClone(s));
      }
    }
    finish(run, 'cancelled', { message: '已停止，保留已收到的内容。' });
    run.controller.abort(new Error('USER_CANCELLED'));
  }
  function get(id, owner) {
    const run = runs.get(id);
    if (!run || run.owner.userId !== owner.userId || run.owner.sessionId !== owner.sessionId)
      throw failure(404, '运行不存在或已过期，请重新发送。');
    return run;
  }
  function reuse(owner, requestId, requestHash) {
    for (const run of runs.values())
      if (run.owner.sessionId === owner.sessionId && run.requestId === requestId) {
        if (run.requestHash !== requestHash) throw failure(409, '同一请求标识不能用于不同内容。');
        return run;
      }
    return null;
  }
  let admission = Promise.resolve();
  async function withAdmission(operation) {
    const previous = admission;
    let unlock;
    admission = new Promise((r) => (unlock = r));
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
    }
  }
  function assertAvailable(modelId) {
    prune();
    if (active.has(modelId)) throw failure(409, '此模型正在调用，请等待当前请求完成。');
    if (runs.size >= 32 || active.size >= 8) throw failure(429, '当前运行较多，请稍后再试。');
  }
  function start({
    owner,
    model,
    key,
    prompt,
    requestId,
    requestHash,
    context,
    metadata = {},
    execute,
    runId,
    persistTerminal,
    recorder,
  }) {
    prune();
    if (active.has(model.id)) throw failure(409, '此模型正在调用，请等待当前请求完成。');
    if (runs.size >= 32 || active.size >= 8) throw failure(429, '当前运行较多，请稍后再试。');
    if (recorder) {
      const sink = recorder;
      recorder = {
        get error() {
          return metadata.telemetryError;
        },
        write(type, data) {
          if (metadata.telemetryError) return;
          try {
            sink.write(type, data);
          } catch {
            metadata.telemetryError = {
              code: 'TRACE_WRITE_FAILED',
              message: '结构化日志写入失败，请检查磁盘空间与权限。',
            };
          }
        },
      };
    }
    const requireTrace = () => {
      if (metadata.telemetryError)
        throw Object.assign(new Error(metadata.telemetryError.message), metadata.telemetryError);
    };
    const run = {
      id: runId ?? randomUUID(),
      owner,
      metadata,
      requestId,
      requestHash,
      modelId: model.config.modelId,
      status: 'running',
      events: [],
      eventBytes: 0,
      listeners: new Set(),
      controller: new AbortController(),
      finishedAt: null,
      recorder,
    };
    active.add(model.id);
    runs.set(run.id, run);
    emit(run, 'run.accepted', { modelId: run.modelId, ...metadata });
    // An abandoned create response must not leave an expensive generation running.
    const unattached = setTimeout(() => {
      if (!run.listeners.size) cancel(run);
    }, 15000);
    unattached.unref();
    run.task = Promise.resolve().then(async () => {
      try {
        requireTrace();
        let callSequence = 0;
        const invoke = async (options = {}) => {
          const callId = ++callSequence;
          const activeContext = options.context ?? context;
          const stage = metadata.plan?.steps.find((s) => s.status === 'running')?.stepId ?? null;
          const task = activeContext?.manifest?.task ?? 'dialogue';
          const started = Date.now();
          let output = '';
          recorder?.write('model.started', {
            callId,
            stage,
            task,
            modelId: model.config.modelId,
            messages: activeContext?.messages ?? [{ role: 'user', content: prompt }],
            manifest: activeContext?.manifest,
          });
          requireTrace();
          try {
            const result = await abortable(
              () =>
                generate(model.config, key, prompt, {
                  signal: run.controller.signal,
                  context,
                  onProgress: (data) => {
                    if (run.status === 'running') emit(run, 'generation.progress', data);
                  },
                  onDelta: (text) => {
                    if (run.status === 'running') emit(run, 'message.delta', { text });
                  },
                  ...options,
                  onAttempt: (type, data) => {
                    recorder?.write('provider.' + type, { callId, stage, task, ...data });
                    requireTrace();
                  },
                  onDelta: async (delta) => {
                    output += delta;
                    // Persist streaming content so process failure retains partial output.
                    recorder?.write('model.delta', { callId, text: delta });
                    requireTrace();
                    if (options.onDelta) await options.onDelta(delta);
                    else if (run.status === 'running') emit(run, 'message.delta', { text: delta });
                  },
                }),
              run.controller.signal,
            );
            recorder?.write('model.completed', {
              callId,
              stage,
              task,
              durationMs: Date.now() - started,
              result,
              output,
            });
            requireTrace();
            return result;
          } catch (error) {
            recorder?.write('model.failed', {
              callId,
              stage,
              task,
              durationMs: Date.now() - started,
              output,
              error: {
                ...classifyFailure(error, stage),
                usage: error.usage,
                attempts: error.attempts,
                diagnostics: error.diagnostics,
              },
            });
            throw error;
          }
        };
        const result = await abortable(
          async () =>
            execute
              ? await execute({
                  run,
                  invoke,
                  signal: run.controller.signal,
                  emit: (type, data) => {
                    if (run.status === 'running') emit(run, type, data);
                  },
                })
              : await invoke(),
          run.controller.signal,
        );
        finish(run, result?.waitingUser ? 'waiting_user' : 'completed', result);
      } catch (error) {
        const classified = classifyFailure(error, 'generate');
        const state = classified.code === 'CANCELLED' ? 'cancelled' : 'failed';
        for (const s of run.metadata.plan?.steps ?? []) {
          if (['queued', 'running', 'waiting_user'].includes(s.status)) {
            s.status = s.status === 'running' ? state : 'skipped';
            s.summary = classified.message;
            s.finishedAt = new Date().toISOString();
            emit(run, 'step.updated', structuredClone(s));
          }
        }
        if (persistTerminal) {
          try {
            await abortable(
              () =>
                persistTerminal(
                  run.id,
                  {
                    failure: {
                      ...classified,
                      diagnostics: error.diagnostics ?? null,
                      attempts: error.attempts ?? [],
                    },
                    ...(run.metadata.plan ? { plan: run.metadata.plan } : {}),
                  },
                  state,
                ),
              AbortSignal.timeout(persistTimeoutMs),
            );
          } catch {
            // A database outage cannot keep the browser and model reservation alive.
            // Stop renewing this run; persisted recovery will use the expired lease.
            run.metadata.terminalPersistenceFailed = true;
          }
        }
        if (run.status === 'running')
          finish(run, 'failed', {
            ...classified,
            finishReason: error.finishReason ?? null,
            outputLimit: error.outputLimit ?? null,
            attempts: error.attempts ?? [],
          });
      } finally {
        clearTimeout(unattached);
        active.delete(model.id);
      }
    });
    return run;
  }
  function close() {
    clearInterval(cleanup);
    for (const run of runs.values()) cancel(run);
  }
  async function resetItem(itemId) {
    const selected = [...runs.values()].filter((r) => r.metadata.association?.itemId === itemId);
    for (const r of selected) cancel(r);
    await Promise.all(selected.map((r) => r.task));
    for (const r of selected) runs.delete(r.id);
  }
  const runningIds = () =>
    [...runs.values()]
      .filter((r) => r.status === 'running' && !r.controller.signal.aborted)
      .map((r) => r.id);
  return {
    start,
    get,
    reuse,
    cancel,
    close,
    withAdmission,
    assertAvailable,
    resetItem,
    runningIds,
  };
}
