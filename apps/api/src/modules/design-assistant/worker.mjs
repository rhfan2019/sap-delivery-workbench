import { Command } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { transaction } from '../../platform/auth.mjs';
import {
  claim,
  guard,
  renew,
  event,
  saveTask,
  chargeActive,
  stopUnauthorized,
} from './repository.mjs';
import { buildGraph } from './graph.mjs';
import { durableSaver } from './checkpointer.mjs';
import { compatible } from './assets.mjs';
import { fault, safeError } from './policy.mjs';
import { createTelemetry } from './telemetry.mjs';
import { configuredModel, configuredStreamingModel } from './model.mjs';
import { appendChatEvent } from './chat-events.mjs';
import { chatArtifact, chatDecision } from './chat-workflow.mjs';
import { syntheticModel, syntheticTool } from './simulation.mjs';
import { configuredTool } from './sap.mjs';

// Shown in the chat for a failed turn; only fixed texts keyed by allowlisted codes.
const failureMessages = {
  MODEL_AUTH_FAILED:
    '模型服务拒绝认证（API Key 无效或无权访问该模型），请在后台管理检查模型凭据后重试。',
  RATE_LIMIT: '模型服务限流，请稍后重试。',
  TIMEOUT: '模型响应超时，请稍后重试。',
  CONNECTION_ERROR: '无法连接模型服务或连接中断，请检查网络与模型地址后重试。',
  MODEL_RESPONSE_ERROR: '模型服务返回错误或格式无效，请查看日志后重试。',
  MODEL_NOT_CONFIGURED: '模型配置不可用（地址、模型名或能力不符），请在后台管理检查模型配置。',
  OUTPUT_TRUNCATED: '模型回复超过长度上限，请缩小问题范围后重试。',
  COMPATIBILITY: '模型配置已变更，请新建对话后重试。',
  BUDGET_EXHAUSTED: '本任务的调用预算已用完，请新建对话。',
};

export async function executeRun(
  pool,
  lease,
  {
    model,
    streamModel = configuredStreamingModel,
    tool,
    telemetry,
    onBoundary,
    checkpointerFactory = durableSaver,
    authorize = async () => {},
  } = {},
) {
  const ownsTelemetry = !telemetry;
  telemetry ??= createTelemetry();
  const controller = new AbortController();
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      await transaction(pool, async (db) => {
        await authorize(db, lease);
        await renew(db, lease);
      });
    } catch (e) {
      controller.abort(e);
    } finally {
      renewing = false;
    }
  }, 10000);
  heartbeat.unref();
  const attrs = {
    task_id: lease.task_id,
    logical_run_id: lease.id,
    attempt_id: lease.attempt_id,
    thread_id: lease.thread_id,
  };
  const finish = async (error = null) =>
    transaction(pool, async (db) => {
      const { t, r } = await guard(db, lease, { allowWaiting: true });
      await chargeActive(db, t, r);
      if (r.state.chat_turn_id) {
        const turn = (
          await db.query('SELECT terminal FROM app.fsd_v1_chat_turn WHERE id=$1', [
            r.state.chat_turn_id,
          ])
        ).rows[0];
        if (turn && !turn.terminal) {
          const artifact =
            r.snapshot.chat_action === 'draft' ? chatArtifact(t.artifacts.at(-1)) : null;
          const decision = error ? null : chatDecision(t);
          if (artifact)
            await appendChatEvent(db, lease, r.state.chat_turn_id, 'artifact.ready', artifact);
          await appendChatEvent(
            db,
            lease,
            r.state.chat_turn_id,
            error ? 'run.failed' : decision ? 'run.waiting_user' : 'run.completed',
            error
              ? (({ code }) => ({
                  code,
                  message: failureMessages[code] ?? '本轮执行失败，请重试。',
                }))(
                  // An absolute deadline rejects with a DOMException that carries no code.
                  safeError(
                    error?.name === 'TimeoutError'
                      ? { code: 'TIMEOUT', error_origin: 'MODEL' }
                      : error,
                  ),
                )
              : decision
                ? { decision }
                : {},
          );
          if (!t.messages.some((m) => m.id === r.state.chat_turn_id + ':assistant')) {
            const text = (
              await db.query(
                "SELECT data->>'text' AS text FROM app.fsd_v1_chat_event WHERE turn_id=$1 AND type='message.delta' ORDER BY seq",
                [r.state.chat_turn_id],
              )
            ).rows
              .map((r) => r.text)
              .join('');
            t.messages.push({
              id: r.state.chat_turn_id + ':assistant',
              runId: r.state.chat_turn_id,
              role: 'assistant',
              content: decision ? '' : text || artifact?.markdown || '',
              status: error ? 'failed' : decision ? 'waiting_user' : 'completed',
              decision,
              artifact,
              action: r.snapshot.chat_action,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
      if (error) {
        error = safeError(error);
        t.status = 'WAITING';
        t.wait_reason =
          error.code === 'COMPATIBILITY'
            ? 'COMPATIBILITY'
            : error.code === 'BUDGET_EXHAUSTED'
              ? 'BUDGET'
              : 'TECHNICAL';
        r.state.error = error;
        t.revision++;
      } else delete r.state.error;
      const status =
        t.status === 'DELIVERED' ? 'COMPLETED' : t.status === 'WAITING' ? 'WAITING' : 'FAILED';
      await saveTask(db, t);
      await db.query(
        'UPDATE app.fsd_v1_run SET status=$2,state=$3,lease_until=NULL,expected_revision=$4 WHERE id=$1',
        [r.id, status, r.state, t.revision],
      );
      await db.query(
        "UPDATE app.fsd_v1_event SET dispatch_status='DONE' WHERE run_id=$1 AND dispatch_status='CLAIMED'",
        [r.id],
      );
      await db.query(
        'UPDATE app.fsd_v1_attempt SET ended_at=clock_timestamp(),state=state || $2::jsonb WHERE id=$1',
        [lease.attempt_id, { status, error: r.state.error ?? null }],
      );
      await event(db, t.id, r.id, error ? 'recovery.blocked' : 'execution.finished', {
        attempt_id: lease.attempt_id,
        status,
        error_code: error?.code ?? null,
        error_origin: error?.error_origin ?? null,
      });
      if (r.snapshot.chat_action === 'dialogue' && t.chat?.pendingDesign) {
        Object.assign(t, t.chat.pendingDesign);
        delete t.chat.pendingDesign;
        await saveTask(db, t);
        await db.query('UPDATE app.fsd_v1_run SET expected_revision=$2 WHERE id=$1', [
          t.active_run_id,
          t.revision,
        ]);
      }
    });
  try {
    const predecessor = (
      await pool.query(
        'SELECT trace_id,state FROM app.fsd_v1_attempt WHERE run_id=$1 AND id<>$2 AND trace_id IS NOT NULL ORDER BY started_at DESC LIMIT 1',
        [lease.id, lease.attempt_id],
      )
    ).rows[0];
    const dispatch = (
      await pool.query(
        "SELECT data->'trace_context' AS context FROM app.fsd_v1_event WHERE run_id=$1 AND data->'trace_context'->>'trace_id' IS NOT NULL AND dispatch_status IN ('PENDING','CLAIMED','DONE') ORDER BY sequence DESC LIMIT 1",
        [lease.id],
      )
    ).rows[0]?.context;
    const linked = [
      predecessor?.trace_id
        ? { traceId: predecessor.trace_id, spanId: predecessor.state.span_id, traceFlags: 1 }
        : null,
      dispatch ? { traceId: dispatch.trace_id, spanId: dispatch.span_id, traceFlags: 1 } : null,
    ].filter((c) => c?.spanId);
    await telemetry.span(
      'worker.execution',
      attrs,
      async (ids) => {
        await pool.query(
          'UPDATE app.fsd_v1_attempt SET trace_id=$2,state=state || $3::jsonb WHERE id=$1',
          [
            lease.attempt_id,
            ids.trace_id,
            { span_id: ids.span_id, recovery_of_trace_id: predecessor?.trace_id ?? null },
          ],
        );
        if (!compatible(lease.assets)) throw fault('COMPATIBILITY', 'CHECKPOINT');
        const { t } = await transaction(pool, async (db) => {
          await authorize(db, lease);
          return guard(db, lease, { allowWaiting: true });
        });
        const remaining = Math.min(
          lease.assets.budget.run_active_time - lease.state.budget.active_ms,
          lease.assets.budget.task_active_time - t.budget.active_ms,
        );
        if (remaining <= 0) throw fault('BUDGET_EXHAUSTED', 'BUSINESS_COMMIT');
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(Math.min(lease.assets.budget.run_active_time, remaining)),
        ]);
        const saver = checkpointerFactory(pool, lease);
        const replay = lease.state.processing_kind === 'FIXED_REPLAY';
        const graph = buildGraph(pool, lease, {
          checkpointer: saver,
          streamModel,
          model: replay
            ? fixedReplayModel(pool, lease)
            : (model ?? (t.mode === 'SYNTHETIC' ? syntheticModel : configuredModel)),
          tool: replay
            ? fixedReplayTool(pool, lease)
            : (tool ??
              (t.mode === 'SYNTHETIC' ? syntheticTool : configuredTool(pool, lease.scope))),
          telemetry,
          signal,
          onBoundary,
        });
        const config = {
          configurable: { thread_id: lease.thread_id },
          durability: 'sync',
          recursionLimit: lease.assets.budget.max_graph_steps_per_run,
          signal,
        };
        const previous = await telemetry.span('checkpoint.load', attrs, () =>
          saver.getTuple(config),
        );
        if (previous) {
          const values = previous.checkpoint.channel_values;
          if (!values || (values.run_id ?? values.__start__?.run_id) !== lease.id)
            throw fault('CHECKPOINT_CORRUPT', 'CHECKPOINT');
          // An FSD round needs the plan approval: committed by this run (N09), or — for a retried
          // final generation (FSD_RETRY) — already recorded on the task before the run started.
          if (
            (values.cycle === 1 ||
              previous.pendingWrites?.some(
                ([, channel, value]) => channel === 'cycle' && value === 1,
              )) &&
            !(lease.state.fsd_round && t.confirmations.some((c) => c.kind === 'PLAN_CONFIRM')) &&
            !(
              await pool.query(
                "SELECT 1 FROM app.fsd_v1_commit WHERE run_id=$1 AND step_id='N09:plan-confirmed'",
                [lease.id],
              )
            ).rowCount
          )
            throw fault('CHECKPOINT_CORRUPT', 'CHECKPOINT');
          if (values.proposal_ref && !lease.state.proposal)
            throw fault('CHECKPOINT_CORRUPT', 'CHECKPOINT');
          // LangGraph may reuse durable pending writes without re-entering a
          // committed node. Reconcile the ledger at the recovery boundary too.
          await transaction(pool, async (db) => {
            const { t: current, r } = await guard(db, lease, { allowWaiting: true });
            const commits = (
              await db.query(
                'SELECT commit_key,input_snapshot_id,after_revision FROM app.fsd_v1_commit WHERE run_id=$1',
                [lease.id],
              )
            ).rows;
            if (
              commits.some(
                (c) =>
                  c.input_snapshot_id !== r.input_snapshot_id ||
                  Number(c.after_revision) > current.revision,
              )
            )
              throw fault('CHECKPOINT_CORRUPT', 'CHECKPOINT');
            await event(db, lease.task_id, lease.id, 'recovery.reconciled', {
              attempt_id: lease.attempt_id,
              checkpoint_from: previous.checkpoint.id,
              result: 'LEDGER_VALIDATED',
              commit_keys: commits.map((c) => c.commit_key),
            });
          });
        }
        await transaction(pool, (db) =>
          event(db, lease.task_id, lease.id, 'recovery.started', {
            attempt_id: lease.attempt_id,
            checkpoint_from: previous?.checkpoint.id ?? null,
            thread_id: lease.thread_id,
          }),
        );
        const input = previous
          ? t.wait?.status === 'RESOLVED' && lease.state.resume_decision
            ? new Command({ resume: { decision_id: lease.state.resume_decision } })
            : null
          : { run_id: lease.id, round: 0 };
        await graph.invoke(input, config);
        const latest = await telemetry.span('checkpoint.persist', attrs, () =>
          saver.getTuple(config),
        );
        if (!latest) throw fault('CHECKPOINT_MISSING', 'CHECKPOINT');
        await transaction(pool, async (db) => {
          const { r } = await guard(db, lease, { allowWaiting: true });
          r.state.checkpoint_id = latest.checkpoint.id;
          await db.query('UPDATE app.fsd_v1_run SET state=$2 WHERE id=$1', [r.id, r.state]);
          await event(db, lease.task_id, lease.id, 'checkpoint.ack', {
            checkpoint_id: latest.checkpoint.id,
            thread_id: lease.thread_id,
          });
          await event(db, lease.task_id, lease.id, 'recovery.completed', {
            attempt_id: lease.attempt_id,
            checkpoint_from: previous?.checkpoint.id ?? null,
            checkpoint_to: latest.checkpoint.id,
          });
        });
        await onBoundary?.('after_interrupt', {
          run_id: lease.id,
          checkpoint_id: latest.checkpoint.id,
        });
        await finish();
      },
      linked.map((context) => ({ context })),
    );
  } catch (e) {
    if (e.code === 'AUTH_DENIED') await transaction(pool, (db) => stopUnauthorized(db, lease));
    else await finish(e).catch(() => {});
    if (['LEASE_LOST', 'USER_PAUSED', 'RUN_CANCELLED'].includes(e.code)) return;
    throw e;
  } finally {
    clearInterval(heartbeat);
    if (ownsTelemetry) await telemetry.shutdown();
  }
}
export function startDesignWorker(pool, { intervalMs = 1000, ...options } = {}) {
  const ownsTelemetry = !options.telemetry;
  options.telemetry ??= createTelemetry();
  let stopping = false,
    pending;
  const owner = 'fsd-' + process.pid;
  const loop = async () => {
    while (!stopping) {
      let lease;
      try {
        lease = await transaction(pool, (db) => claim(db, owner));
      } catch {
        options.telemetry.count('dispatcher_failures_total', {
          error_code: 'PERSISTENCE_ERROR',
          error_origin: 'CHECKPOINT',
        });
        await new Promise((r) => setTimeout(r, Math.max(100, intervalMs)));
        continue;
      }
      if (lease) {
        try {
          await executeRun(pool, lease, options);
        } catch (e) {
          options.telemetry?.count('worker_failures_total', { error_code: e.code ?? 'UNKNOWN' });
        }
      } else await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  pending = loop();
  return async () => {
    stopping = true;
    await pending;
    if (ownsTelemetry) await options.telemetry.shutdown();
  };
}
export async function checkpointState(pool, threadId) {
  return new PostgresSaver(pool, undefined, { schema: 'fsd_checkpoint' }).getTuple({
    configurable: { thread_id: threadId },
  });
}
function fixedReplayModel(pool, lease) {
  return async ({ kind, context }) => {
    const prior = (
      await pool.query(
        "SELECT count(*)::int AS n FROM app.fsd_v1_operation WHERE run_id=$1 AND status='SETTLED' AND result->>'kind'=$2",
        [lease.id, kind],
      )
    ).rows[0].n;
    const source = (
      await pool.query(
        "SELECT result FROM app.fsd_v1_operation WHERE run_id=$1 AND status='SETTLED' AND result->>'kind'=$2 ORDER BY created_at OFFSET $3 LIMIT 1",
        [lease.state.replay_of_run_id, kind, prior],
      )
    ).rows[0];
    if (!source) throw fault('REPLAY_DATA_MISSING', 'RETRIEVAL');
    const references = new Map(
      context.t.evidence
        .filter((e) => e.replay_source_evidence_id)
        .map((e) => [e.replay_source_evidence_id, e.id]),
    );
    const rebound = JSON.parse(JSON.stringify(source.result), (_key, value) =>
      typeof value === 'string' ? (references.get(value) ?? value) : value,
    );
    const output = {
      ...rebound,
      input_snapshot_id: context.r.input_snapshot_id,
      base_artifact_version: context.t.artifact_version,
    };
    return { output, usage: { total_tokens: 0 }, cost: 0 };
  };
}
function fixedReplayTool(pool, lease) {
  return async (_item, { read_generation }) => {
    const prior = (
      await pool.query(
        "SELECT count(*)::int AS n FROM app.fsd_v1_operation WHERE run_id=$1 AND kind='tool' AND status='SETTLED' AND result ? 'data'",
        [lease.id],
      )
    ).rows[0].n;
    const source = (
      await pool.query(
        "SELECT result FROM app.fsd_v1_operation WHERE run_id=$1 AND kind='tool' AND status='SETTLED' AND result ? 'data' ORDER BY created_at OFFSET $2 LIMIT 1",
        [lease.state.replay_of_run_id, prior],
      )
    ).rows[0];
    if (!source) throw fault('REPLAY_DATA_MISSING', 'RETRIEVAL');
    return { ...source.result, replay_source_evidence_id: source.result.id, read_generation };
  };
}
