import { transaction } from '../../platform/auth.mjs';
import { guard, reserve, settle, stepCommit } from './repository.mjs';
import { appendChatEvent } from './chat-events.mjs';
import { hash, fault, safeError, modelOutputLimit } from './policy.mjs';

// Transport/stream codes are outside the allowlisted run error set; without this
// mapping a rejected key or rate limit is recorded and shown only as UNKNOWN.
const providerCodes = {
  AUTH_FAILED: 'MODEL_AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMIT',
  MODEL_TIMEOUT: 'TIMEOUT',
  STREAM_IDLE_TIMEOUT: 'TIMEOUT',
  CONNECTION_FAILED: 'CONNECTION_ERROR',
  CONNECTION_INTERRUPTED: 'CONNECTION_ERROR',
  STREAM_INTERRUPTED: 'CONNECTION_ERROR',
  PROVIDER_ERROR: 'MODEL_RESPONSE_ERROR',
  INVALID_RESPONSE: 'MODEL_RESPONSE_ERROR',
  OUTPUT_PROTOCOL: 'MODEL_RESPONSE_ERROR',
  MODEL_NOT_FOUND: 'MODEL_NOT_CONFIGURED',
  MODEL_CAPABILITY_REQUIRED: 'MODEL_NOT_CONFIGURED',
  MODEL_ENDPOINT_NOT_ALLOWED: 'MODEL_NOT_CONFIGURED',
  ENDPOINT_BLOCKED: 'MODEL_NOT_CONFIGURED',
  REDIRECT_BLOCKED: 'MODEL_NOT_CONFIGURED',
  RESPONSE_LIMIT: 'OUTPUT_TRUNCATED',
  TEXT_LIMIT: 'OUTPUT_TRUNCATED',
  OUTPUT_LIMIT: 'OUTPUT_TRUNCATED',
};
function providerFault(error) {
  const code = providerCodes[error?.code];
  return code ? fault(code, 'MODEL', error.statusCode ?? 502) : error;
}

export async function executeChatNode(
  pool,
  lease,
  { streamModel, signal, telemetry, onBoundary = async () => {} },
) {
  const tx = (fn) => transaction(pool, fn);
  const { t, r } = await tx((db) => guard(db, lease, { allowWaiting: true }));
  const turnId = r.state.chat_turn_id;
  if (!turnId) throw fault('INVALID_CHAT_TURN');
  const op = hash([r.id, 'CHAT']);
  let result = (
    await pool.query('SELECT status,result FROM app.fsd_v1_operation WHERE id=$1', [op])
  ).rows[0];
  if (result && result.status !== 'SETTLED') throw fault('OUTCOME_UNKNOWN', 'MODEL');
  if (!result) {
    await tx((db) =>
      reserve(
        db,
        lease,
        op,
        'model',
        JSON.stringify(r.snapshot).length +
          r.assets.chat_prompt_text.length +
          modelOutputLimit('CHAT', r.assets.budget),
      ),
    );
    let text = '';
    const boundedSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(r.assets.budget.model_call_timeout),
    ]);
    let abort;
    const timeout = new Promise((_, reject) => {
      abort = () => reject(boundedSignal.reason);
      boundedSignal.addEventListener('abort', abort, { once: true });
    });
    try {
      boundedSignal.throwIfAborted();
      const invoke = () =>
        Promise.race([
          streamModel({
            context: { pool, t, r },
            signal: boundedSignal,
            onDelta: async (delta) => {
              boundedSignal.throwIfAborted();
              if (typeof delta !== 'string' || text.length + delta.length > 262144)
                throw fault('OUTPUT_TRUNCATED', 'MODEL');
              if (!delta) return;
              await tx((db) =>
                appendChatEvent(db, lease, turnId, 'message.delta', { text: delta }),
              );
              text += delta;
            },
          }),
          timeout,
        ]);
      const output = telemetry
        ? await telemetry.span(
            'model.attempt',
            {
              task_id: t.id,
              logical_run_id: r.id,
              attempt_id: lease.attempt_id,
              thread_id: r.thread_id,
              operation_id: op,
              prompt_hash: r.assets.chat_prompt_hash,
            },
            invoke,
          )
        : await invoke();
      if (!text || output.text !== text) throw fault('INVALID_OUTPUT', 'MODEL');
      await tx((db) => settle(db, lease, op, { text }, null, output.usage));
      result = { result: { text } };
      await onBoundary('after_operation_result_before_checkpoint', {
        run_id: r.id,
        operation_id: op,
        step_id: 'CHAT',
      });
    } catch (cause) {
      const error = providerFault(cause);
      await tx((db) => settle(db, lease, op, null, safeError(error))).catch(() => {});
      throw error;
    } finally {
      boundedSignal.removeEventListener('abort', abort);
    }
  }
  await tx(async (db) => {
    await stepCommit(db, lease, 'CHAT:reply', result.result, (task) => {
      task.messages.push({
        id: turnId + ':assistant',
        runId: turnId,
        role: 'assistant',
        content: result.result.text,
        status: 'completed',
        action: 'dialogue',
        createdAt: new Date().toISOString(),
      });
      task.status = 'WAITING';
      task.wait_reason = 'CHAT_READY';
      return { turn_id: turnId };
    });
  });
  await onBoundary('after_business_commit_before_checkpoint', {
    run_id: r.id,
    step_id: 'CHAT:reply',
  });
}
