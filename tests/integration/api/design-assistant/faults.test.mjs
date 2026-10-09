import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../../scripts/testing/run-tests.mjs';
import {
  createTask,
  loadTask,
  claim,
  command,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import {
  setupCheckpoints,
  durableSaver,
} from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../../apps/api/src/modules/design-assistant/worker.mjs';
import {
  syntheticModel,
  syntheticTool,
} from '../../../../apps/api/src/modules/design-assistant/simulation.mjs';
import { fault } from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
import {
  collectPages,
  normalizeToolResult,
} from '../../../../apps/api/src/modules/design-assistant/sap.mjs';
import { createTelemetry } from '../../../../apps/api/src/modules/design-assistant/telemetry.mjs';
async function setup(budget = {}) {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  await setupCheckpoints(pool);
  const scope = await transaction(pool, fixture);
  const assets = await assetManifest();
  assets.budget = { ...assets.budget, ...budget };
  const task = await transaction(pool, (db) =>
    createTask(
      db,
      scope,
      {
        request_id: randomUUID(),
        text: 'ZPOC fault fixture',
        mode: 'SYNTHETIC',
        target: { target_ref: 'synthetic', client: '000' },
      },
      assets,
    ),
  );
  return {
    pool,
    scope,
    task,
    lease: await transaction(pool, (db) => claim(db, 'fault-worker', task.active_run_id)),
  };
}
test('TOOL-04 physical pages settle separately with linked spans and exact result hashes', async () => {
  const f = await setup(),
    spans = [],
    telemetry = createTelemetry({
      log: false,
      spanExporter: {
        export: (batch, done) => {
          spans.push(...batch);
          done({ code: 0 });
        },
        shutdown: async () => {},
      },
    });
  try {
    await executeRun(f.pool, f.lease, {
      telemetry,
      tool: async (item, options) => {
        const body = JSON.stringify(await syntheticTool(item, options));
        const envelope = (x) => ({ content: [{ type: 'text', text: JSON.stringify(x) }] });
        return collectPages(
          envelope({
            status: 'paged',
            resultId: 'r',
            totalCharacters: body.length,
            offset: 0,
            page: body.slice(0, 20),
            nextOffset: 20,
          }),
          async () =>
            envelope({ resultId: 'r', offset: 20, page: body.slice(20), nextOffset: null }),
          { readGeneration: options.read_generation, onPage: options.onPage },
        );
      },
    });
    const ops = (
      await f.pool.query("SELECT * FROM app.fsd_v1_operation WHERE run_id=$1 AND kind='tool'", [
        f.lease.id,
      ])
    ).rows;
    assert.equal(ops.length, 2);
    assert.ok(ops.every((o) => o.status === 'SETTLED'));
    const page = ops.find((o) => o.result.parent_operation_id);
    assert.equal(page.result.offset, 20);
    assert.match(page.result.result_hash, /^[a-f0-9]{64}$/);
    assert.equal((await loadTask(f.pool, f.scope, f.task.id)).budget.tool_calls, 2);
    await new Promise((r) => setTimeout(r, 10));
    const span = spans.find((s) => s.name === 'result.page'),
      parent = spans.find((s) => s.name === 'tool.attempt');
    assert.ok(span);
    assert.equal(span.parentSpanContext.spanId, parent.spanContext().spanId);
  } finally {
    await telemetry.shutdown();
    await f.pool.end();
  }
});
test('TOOL-04 missing page range survives a complete reread under a new generation', async () => {
  const f = await setup(),
    generations = [];
  try {
    await executeRun(f.pool, f.lease, {
      tool: async (item, options) => {
        generations.push(options.read_generation);
        const body = JSON.stringify(await syntheticTool(item, options));
        const env = (x) => ({ content: [{ type: 'text', text: JSON.stringify(x) }] });
        return collectPages(
          env({
            status: 'paged',
            resultId: 'r',
            totalCharacters: body.length,
            offset: 0,
            page: body.slice(0, 20),
            nextOffset: 20,
          }),
          async () =>
            env({
              resultId: generations.length === 1 ? 'foreign' : 'r',
              offset: 20,
              page: body.slice(20),
              nextOffset: null,
            }),
          { readGeneration: options.read_generation, onPage: options.onPage },
        );
      },
    });
    assert.equal(generations.length, 2);
    assert.notEqual(generations[0], generations[1]);
    const failed = (
      await f.pool.query(
        "SELECT error FROM app.fsd_v1_operation WHERE run_id=$1 AND error->>'code'='RESULT_EXPIRED'",
        [f.lease.id],
      )
    ).rows[0].error;
    assert.equal(failed.read_progress.received_characters, 20);
    assert.ok(failed.read_progress.expected_characters > 20);
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.evidence.length, 1);
    assert.equal(t.evidence[0].read_generation, generations[1]);
    assert.equal(t.budget.tool_calls, 4);
  } finally {
    await f.pool.end();
  }
});
test('MODEL-01 invalid model output has exactly one repair and no authoritative artifact', async () => {
  const f = await setup();
  let calls = 0;
  try {
    await assert.rejects(
      () =>
        executeRun(f.pool, f.lease, {
          model: async () => {
            calls++;
            return { output: { kind: 'AnalysisResult', goto: 'DELIVERED' } };
          },
        }),
      /INVALID_OUTPUT/,
    );
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(calls, 2);
    assert.equal(t.budget.model_calls, 2);
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.status, 'WAITING');
    const events = (
      await f.pool.query(
        "SELECT data FROM app.fsd_v1_event WHERE task_id=$1 AND event_type='operation.failed'",
        [t.id],
      )
    ).rows;
    assert.equal(events.length, 2);
    assert.equal(events[0].data.error_origin, 'OUTPUT_VALIDATION');
  } finally {
    await f.pool.end();
  }
});
test('MODEL-01b invented evidence reference gets one repair that names the reason', async () => {
  const f = await setup();
  const repairs = [];
  try {
    await executeRun(f.pool, f.lease, {
      tool: syntheticTool,
      model: async (input) => {
        repairs.push(input.repair);
        const result = await syntheticModel(input);
        if (repairs.length === 1)
          result.output = { ...result.output, evidence_refs: ['chat:user:invented'] };
        return result;
      },
    }).catch(() => {});
    assert.deepEqual(repairs.slice(0, 2), [null, 'UNKNOWN_REFERENCE']);
    const failed = (
      await f.pool.query(
        "SELECT data FROM app.fsd_v1_event WHERE task_id=$1 AND event_type='operation.failed'",
        [f.task.id],
      )
    ).rows;
    assert.equal(failed.length, 1);
    assert.equal(failed[0].data.error_code, 'UNKNOWN_REFERENCE');
  } finally {
    await f.pool.end();
  }
});
test('MODEL-02 absolute timeout rejects never-completing transport and prevents late publication', async () => {
  const f = await setup({ model_call_timeout: 60 });
  let chunks = 0,
    closed = false;
  try {
    await assert.rejects(() =>
      executeRun(f.pool, f.lease, {
        model: async ({ signal }) =>
          new Promise((_, reject) => {
            const ticker = setInterval(() => chunks++, 5);
            signal.addEventListener(
              'abort',
              () => {
                clearInterval(ticker);
                closed = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      }),
    );
    assert.ok(chunks >= 2);
    assert.equal(closed, true);
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.budget.model_calls, 1);
    assert.equal(t.status, 'WAITING');
    assert.equal(
      (await f.pool.query('SELECT status FROM app.fsd_v1_operation WHERE run_id=$1', [f.lease.id]))
        .rows[0].status,
      'UNKNOWN',
    );
  } finally {
    await f.pool.end();
  }
});
test('MODEL-02 provider truncation cannot publish fragments or trigger unlimited continuation', async () => {
  const f = await setup();
  let calls = 0;
  try {
    await assert.rejects(
      () =>
        executeRun(f.pool, f.lease, {
          model: async () => {
            calls++;
            throw fault('OUTPUT_TRUNCATED', 'MODEL');
          },
        }),
      /OUTPUT_TRUNCATED/,
    );
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(calls, 1);
    assert.equal(t.budget.model_calls, 1);
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.wait_reason, 'TECHNICAL');
    assert.ok(t.budget.tokens > 0);
  } finally {
    await f.pool.end();
  }
});
test('REC-06 remote success followed by lost response retains UNKNOWN and re-reads a new generation', async () => {
  const f = await setup();
  const remote = new Map();
  try {
    await executeRun(f.pool, f.lease, {
      model: syntheticModel,
      tool: async (item, ctx) => {
        remote.set(ctx.read_generation, 'SUCCEEDED');
        if (remote.size === 1) throw fault('OUTCOME_UNKNOWN', 'SAP_ADAPTER');
        return syntheticTool(item, ctx);
      },
    });
    const operations = (
      await f.pool.query(
        "SELECT status,result,error FROM app.fsd_v1_operation WHERE run_id=$1 AND kind='tool' ORDER BY created_at",
        [f.lease.id],
      )
    ).rows;
    assert.equal(remote.size, 2);
    assert.equal(operations[0].status, 'UNKNOWN');
    assert.equal(operations[1].status, 'SETTLED');
    assert.equal(operations[1].result.read_generation, [...remote.keys()][1]);
    assert.equal((await loadTask(f.pool, f.scope, f.task.id)).budget.tool_calls, 2);
  } finally {
    await f.pool.end();
  }
});
test('MODEL-03 repeated semantic query with renamed gap stops before a second SAP call', async () => {
  const f = await setup();
  let query = 0;
  try {
    await assert.rejects(
      () =>
        executeRun(f.pool, f.lease, {
          model: async (args) => {
            const out = await syntheticModel(args);
            if (args.kind === 'EvidenceAssessment') out.output.decision = 'NEED_QUERY';
            if (args.kind === 'QueryPlan') out.output.items[0].gap_id = 'renamed-' + ++query;
            return out;
          },
          tool: syntheticTool,
        }),
      /NO_PROGRESS/,
    );
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.budget.tool_calls, 1);
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.status, 'WAITING');
  } finally {
    await f.pool.end();
  }
});
test('REC-07 incompatible pinned assets wait without model calls or silent upgrades', async () => {
  const f = await setup();
  try {
    f.lease.assets.graph = 'future-incompatible';
    await f.pool.query('UPDATE app.fsd_v1_run SET assets=$2 WHERE id=$1', [
      f.lease.id,
      f.lease.assets,
    ]);
    await assert.rejects(() => executeRun(f.pool, f.lease), /COMPATIBILITY/);
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.wait_reason, 'COMPATIBILITY');
    assert.equal(t.budget.model_calls, 0);
    assert.equal(
      (await f.pool.query('SELECT assets FROM app.fsd_v1_run WHERE id=$1', [f.lease.id])).rows[0]
        .assets.graph,
      'future-incompatible',
    );
  } finally {
    await f.pool.end();
  }
});
test('REC-08 checkpoint cursor ahead of business ledger stops in technical wait', async () => {
  const f = await setup();
  try {
    await assert.rejects(
      () =>
        executeRun(f.pool, f.lease, {
          checkpointerFactory: () => ({
            getTuple: async () => ({
              checkpoint: { id: 'corrupt', channel_values: { run_id: f.lease.id, cycle: 1 } },
            }),
          }),
        }),
      /CHECKPOINT_CORRUPT/,
    );
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.wait_reason, 'TECHNICAL');
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.budget.model_calls, 0);
  } finally {
    await f.pool.end();
  }
});
test('REC-08 pending checkpoint writes cannot skip a missing plan-confirmation commit', async () => {
  const f = await setup();
  try {
    await assert.rejects(
      () =>
        executeRun(f.pool, f.lease, {
          checkpointerFactory: () => ({
            getTuple: async () => ({
              checkpoint: {
                id: 'pending-corrupt',
                channel_values: { run_id: f.lease.id, cycle: 0 },
              },
              pendingWrites: [
                ['node-task', 'cycle', 1],
                ['node-task', 'route', 'N07'],
              ],
            }),
          }),
        }),
      { code: 'CHECKPOINT_CORRUPT' },
    );
    assert.equal((await loadTask(f.pool, f.scope, f.task.id)).budget.model_calls, 0);
  } finally {
    await f.pool.end();
  }
});
test('REC-08 saver write failure retains committed business facts and reports technical wait', async () => {
  const f = await setup();
  let fail = false;
  try {
    await assert.rejects(
      () =>
        executeRun(f.pool, f.lease, {
          model: syntheticModel,
          tool: syntheticTool,
          onBoundary: async (point) => {
            if (point === 'after_business_commit_before_checkpoint') fail = true;
          },
          checkpointerFactory: (pool, lease) => {
            const saver = durableSaver(pool, lease),
              put = saver.put.bind(saver);
            saver.put = async (...args) => {
              if (fail) throw fault('PERSISTENCE_ERROR', 'CHECKPOINT');
              return put(...args);
            };
            return saver;
          },
        }),
      /PERSISTENCE_ERROR/,
    );
    assert.ok(
      (await f.pool.query('SELECT 1 FROM app.fsd_v1_commit WHERE run_id=$1', [f.lease.id]))
        .rowCount > 0,
    );
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.wait_reason, 'TECHNICAL');
    const run = (await f.pool.query('SELECT state FROM app.fsd_v1_run WHERE id=$1', [f.lease.id]))
      .rows[0];
    assert.equal(run.state.error.code, 'PERSISTENCE_ERROR');
    await transaction(f.pool, (db) =>
      command(db, f.scope, t.id, {
        request_id: randomUUID(),
        revision: t.revision,
        command: 'recover',
      }),
    );
    const recovered = await transaction(f.pool, (db) => claim(db, 'repaired-saver', f.lease.id));
    assert.equal(recovered.thread_id, f.lease.thread_id);
    await executeRun(f.pool, recovered);
    assert.equal((await loadTask(f.pool, f.scope, t.id)).wait_reason, 'CLARIFICATION');
    assert.ok(
      (
        await f.pool.query(
          "SELECT 1 FROM app.fsd_v1_event WHERE run_id=$1 AND event_type='recovery.reconciled'",
          [f.lease.id],
        )
      ).rowCount > 0,
    );
  } finally {
    await f.pool.end();
  }
});
test('OBS-08 revoked authorization stops late model result and expired-worker reclaims', async () => {
  const f = await setup();
  let release, arrive;
  const gate = new Promise((r) => (release = r)),
    started = new Promise((r) => (arrive = r));
  try {
    const execution = executeRun(f.pool, f.lease, {
      model: async (args) => {
        arrive();
        await gate;
        return syntheticModel(args);
      },
    });
    const rejected = assert.rejects(() => execution, /AUTH_DENIED/);
    await started;
    await f.pool.query(
      "UPDATE app.project SET status='archived',archived_at=clock_timestamp() WHERE id=$1",
      [f.scope.projectId],
    );
    release();
    await rejected;
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.wait_reason, 'AUTHORIZATION');
    assert.equal(t.artifacts.length, 0);
    assert.equal(await transaction(f.pool, (db) => claim(db, 'later', f.lease.id)), null);
  } finally {
    release?.();
    await f.pool.end();
  }
});
test('TOOL-05 wrong-client evidence is retained as a gap but excluded before model invocation', async () => {
  const f = await setup();
  let seen = false;
  try {
    await executeRun(f.pool, f.lease, {
      model: async (args) => {
        if (args.kind === 'EvidenceAssessment') {
          seen = true;
          assert.equal(args.context.t.evidence.length, 0);
        }
        return syntheticModel(args);
      },
      tool: async (item, ctx) => ({
        ...(await syntheticTool(item, ctx)),
        client: '999',
        data: { secret: 'WRONG-CLIENT-MARKER' },
      }),
    });
    assert.equal(seen, true);
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.wait_reason, 'CLARIFICATION');
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.evidence[0].validity, 'PENDING_REVIEW');
  } finally {
    await f.pool.end();
  }
});
test('TOOL-02 explicit denial, unsupported and unconfirmed empty search each stop without retry', async () => {
  for (const code of ['AUTH_DENIED', 'UNSUPPORTED', 'NOT_FOUND_UNCONFIRMED']) {
    const f = await setup();
    let calls = 0;
    try {
      await executeRun(f.pool, f.lease, {
        tool: async () => {
          calls++;
          throw fault(code, 'SAP_REMOTE');
        },
      });
      const t = await loadTask(f.pool, f.scope, f.task.id);
      assert.equal(calls, 1);
      assert.equal(t.wait_reason, 'CLARIFICATION');
      assert.equal(t.artifacts.length, 0);
      assert.equal(t.budget.tool_calls, 1);
      const failure = (
        await f.pool.query(
          "SELECT error FROM app.fsd_v1_operation WHERE run_id=$1 AND kind='tool'",
          [f.lease.id],
        )
      ).rows[0].error;
      assert.equal(failure.code, code);
      assert.equal(failure.retryable, false);
      assert.ok(failure.next_actions.includes('SUPPLY_MATERIAL'));
    } finally {
      await f.pool.end();
    }
  }
});
test('TOOL-03 missing unit metadata is excluded from model facts and prevents artifacts', async () => {
  const f = await setup();
  try {
    await executeRun(f.pool, f.lease, {
      tool: async (item, ctx) =>
        normalizeToolResult(
          {
            status: 'success',
            source_version: 'v1',
            result: { type: 'QUAN', quantity: 1, status: 'OPEN' },
          },
          { ...item, tool_name: 'ddicElement' },
          ctx.target,
          ctx.read_generation,
        ),
      model: async (args) => {
        if (args.kind === 'EvidenceAssessment') assert.equal(args.context.t.evidence.length, 0);
        return syntheticModel(args);
      },
    });
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.deepEqual(t.evidence[0].missing_properties, ['unit']);
    assert.equal(t.evidence[0].status, 'PARTIAL');
    assert.equal(t.evidence[0].validity, 'PENDING_REVIEW');
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.wait_reason, 'CLARIFICATION');
  } finally {
    await f.pool.end();
  }
});
test('TOOL-06 version-unknown evidence is reread on successor input and remains blocked', async () => {
  const f = await setup();
  let calls = 0;
  const tool = async (item, ctx) => {
    calls++;
    return {
      ...(await syntheticTool(item, ctx)),
      source_version: null,
      coverage: {
        complete: true,
        properties: ['type', 'quantity', 'unit', 'status'],
        version_kind: 'UNKNOWN',
      },
    };
  };
  try {
    await executeRun(f.pool, f.lease, { tool });
    let t = await loadTask(f.pool, f.scope, f.task.id);
    assert.ok(t.evidence[0].limitations.includes('VERSION_UNKNOWN'));
    const oldId = t.evidence[0].id;
    t = await transaction(f.pool, (db) =>
      command(db, f.scope, t.id, {
        request_id: randomUUID(),
        revision: t.revision,
        command: 'answer',
        question_id: t.wait.questions[0].id,
        option_id: 'remaining',
      }),
    );
    t = await transaction(f.pool, (db) =>
      command(db, f.scope, t.id, {
        request_id: randomUUID(),
        revision: t.revision,
        command: 'complete_batch',
      }),
    );
    const next = await transaction(f.pool, (db) => claim(db, 'reread-version', t.active_run_id));
    await executeRun(f.pool, next, { tool });
    t = await loadTask(f.pool, f.scope, t.id);
    assert.equal(calls, 2);
    assert.notEqual(t.evidence[0].id, oldId);
    assert.ok(t.evidence[0].limitations.includes('VERSION_UNKNOWN'));
    assert.equal(t.evidence[0].validity, 'PENDING_REVIEW');
    assert.equal(t.artifacts.length, 0);
    assert.equal(t.wait_reason, 'CLARIFICATION');
  } finally {
    await f.pool.end();
  }
});
test('TOOL-07 explicit BUSY and rate limit retries remain serial and under shared budget', async () => {
  const f = await setup();
  let calls = 0,
    active = 0,
    maxActive = 0;
  try {
    await executeRun(f.pool, f.lease, {
      tool: async (item, ctx) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          calls++;
          if (calls < 3)
            throw Object.assign(fault(calls === 1 ? 'BUSY' : 'RATE_LIMIT', 'SAP_REMOTE'), {
              retry_after_ms: 20,
            });
          return syntheticTool(item, ctx);
        } finally {
          active--;
        }
      },
    });
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(calls, 3);
    assert.equal(maxActive, 1);
    assert.equal(t.budget.tool_calls, 3);
    assert.equal(t.wait_reason, 'CLARIFICATION');
    assert.equal(
      (
        await f.pool.query(
          "SELECT 1 FROM app.fsd_v1_event WHERE run_id=$1 AND event_type='tool.retry'",
          [f.lease.id],
        )
      ).rowCount,
      2,
    );
  } finally {
    await f.pool.end();
  }
});
test('STATE-02 input change wins barrier against an old in-flight model response', async () => {
  const f = await setup();
  let arrive, release;
  const arrived = new Promise((r) => (arrive = r)),
    gate = new Promise((r) => (release = r));
  try {
    const pending = executeRun(f.pool, f.lease, {
      model: async (args) => {
        arrive();
        await gate;
        return syntheticModel(args);
      },
    });
    await arrived;
    let task = await loadTask(f.pool, f.scope, f.task.id);
    task = await transaction(f.pool, (db) =>
      command(db, f.scope, task.id, {
        request_id: randomUUID(),
        revision: task.revision,
        command: 'supplement',
        text: 'NEW-INPUT',
      }),
    );
    release();
    await pending;
    assert.notEqual(task.active_run_id, f.lease.id);
    const old = (await f.pool.query('SELECT * FROM app.fsd_v1_run WHERE id=$1', [f.lease.id]))
      .rows[0];
    assert.equal(old.state.commit_status, 'STALE');
    assert.equal(old.snapshot.text, 'ZPOC fault fixture');
    const current = await loadTask(f.pool, f.scope, task.id);
    assert.equal(current.artifacts.length, 0);
    assert.equal(current.input.supplements[0].text, 'NEW-INPUT');
  } finally {
    release?.();
    await f.pool.end();
  }
});
test('MODEL-04/06 run and task call ceilings survive recovery and explicit successor input', async () => {
  const f = await setup({ run_model_calls: 1, task_model_calls: 1 });
  try {
    await assert.rejects(() => executeRun(f.pool, f.lease), /BUDGET_EXHAUSTED/);
    let task = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(task.wait_reason, 'BUDGET');
    assert.equal(task.budget.model_calls, 1);
    assert.equal(task.budget.tool_calls, 0);
    task = await transaction(f.pool, (db) =>
      command(db, f.scope, task.id, {
        request_id: randomUUID(),
        revision: task.revision,
        command: 'supplement',
        text: 'Explicit successor cannot reset cumulative balance',
      }),
    );
    const next = await transaction(f.pool, (db) =>
      claim(db, 'budget-successor', task.active_run_id),
    );
    await assert.rejects(() => executeRun(f.pool, next), /BUDGET_EXHAUSTED/);
    task = await loadTask(f.pool, f.scope, task.id);
    assert.equal(task.budget.model_calls, 1);
    assert.equal(task.artifacts.length, 0);
  } finally {
    await f.pool.end();
  }
});
test('MODEL-06 explicit bounded budget authorization resumes the same thread without erasing usage or assets', async () => {
  const f = await setup({ run_model_calls: 1, task_model_calls: 1 });
  try {
    await assert.rejects(() => executeRun(f.pool, f.lease), /BUDGET_EXHAUSTED/);
    let t = await loadTask(f.pool, f.scope, f.task.id);
    const grant = {
      request_id: randomUUID(),
      revision: t.revision,
      command: 'reopen_budget',
      reason: 'Synthetic approved exploration',
      condition: 'Reviewed previously blocked query plan',
      increments: { run_model_calls: 5, task_model_calls: 5 },
    };
    await assert.rejects(
      () => transaction(f.pool, (db) => command(db, f.scope, t.id, { ...grant, reason: '' })),
      /INVALID_BUDGET_AUTHORIZATION/,
    );
    await assert.rejects(
      () =>
        transaction(f.pool, (db) =>
          command(db, f.scope, t.id, { ...grant, increments: { run_model_calls: 999 } }),
        ),
      /INVALID_BUDGET/,
    );
    t = await transaction(f.pool, (db) => command(db, f.scope, t.id, grant));
    const again = await transaction(f.pool, (db) => command(db, f.scope, t.id, grant));
    assert.equal(again.budget_authorizations.length, 1);
    assert.equal(t.budget.model_calls, 1);
    assert.equal(t.active_run_id, f.lease.id);
    const next = await transaction(f.pool, (db) => claim(db, 'authorized-budget', t.active_run_id));
    assert.equal(next.thread_id, f.lease.thread_id);
    await executeRun(f.pool, next);
    const stored = (
      await f.pool.query('SELECT assets,state FROM app.fsd_v1_run WHERE id=$1', [next.id])
    ).rows[0];
    assert.equal(stored.assets.budget.run_model_calls, 1);
    assert.equal(stored.state.budget_limits.run_model_calls, 6);
    t = await loadTask(f.pool, f.scope, t.id);
    assert.equal(t.wait_reason, 'CLARIFICATION');
    assert.ok(t.budget.model_calls > 1);
    assert.equal(t.budget_authorizations[0].actor_id, f.scope.actorId);
  } finally {
    await f.pool.end();
  }
});
for (const direction of ['STANDARD_SUFFICIENT', 'MIXED', 'AS_IS'])
  test('FLOW-07 explicit direction gate: ' + direction, async () => {
    const f = await setup();
    let calls = 0;
    try {
      await executeRun(f.pool, f.lease, {
        model: async (args) => {
          calls++;
          const value = await syntheticModel(args);
          if (args.kind === 'AnalysisResult') {
            value.output.scope =
              direction === 'MIXED' ? 'mixed' : direction === 'AS_IS' ? 'as_is' : 'report';
            value.output.standard_fit =
              direction === 'STANDARD_SUFFICIENT' ? 'SATISFIES' : 'UNKNOWN';
            value.output.decision = 'PROPOSE';
          }
          return value;
        },
      });
      let t = await loadTask(f.pool, f.scope, f.task.id);
      assert.equal(t.wait_reason, 'CLARIFICATION');
      assert.equal(t.wait.questions[0].id, 'scope-direction');
      assert.equal(t.artifacts.length, 0);
      assert.equal(calls, 1);
      t = await transaction(f.pool, (db) =>
        command(db, f.scope, t.id, {
          request_id: randomUUID(),
          revision: t.revision,
          command: 'answer',
          question_id: 'scope-direction',
          option_id: 'end',
        }),
      );
      t = await transaction(f.pool, (db) =>
        command(db, f.scope, t.id, {
          request_id: randomUUID(),
          revision: t.revision,
          command: 'complete_batch',
        }),
      );
      assert.equal(t.status, 'ENDED');
      assert.equal(t.delivered_artifact_id, undefined);
      assert.equal(t.active_run_id, f.lease.id);
      assert.equal(calls, 1);
    } finally {
      await f.pool.end();
    }
  });
test('FLOW-04 mixed query terminal results are all collected before interpretation and block publication', async () => {
  const f = await setup();
  let calls = 0,
    assessed = false;
  try {
    await executeRun(f.pool, f.lease, {
      model: async (args) => {
        const out = await syntheticModel(args);
        if (args.kind === 'QueryPlan')
          out.output.items = [1, 2, 3].map((n) => ({
            ...out.output.items[0],
            gap_id: 'gap-' + n,
            arguments: { query: 'ZPOC_' + n },
          }));
        if (args.kind === 'EvidenceAssessment') {
          assessed = true;
          assert.equal(calls, 3);
        }
        return out;
      },
      tool: async (item, ctx) => {
        calls++;
        if (item.arguments.query === 'ZPOC_1') throw fault('UNSUPPORTED', 'SAP_REMOTE');
        const out = await syntheticTool(item, ctx);
        return item.arguments.query === 'ZPOC_2'
          ? { ...out, status: 'PARTIAL', coverage: { ...out.coverage, complete: false } }
          : out;
      },
    });
    assert.equal(assessed, true);
    const t = await loadTask(f.pool, f.scope, f.task.id);
    assert.equal(t.wait_reason, 'CLARIFICATION');
    assert.equal(t.artifacts.length, 0);
    const run = (await f.pool.query('SELECT state FROM app.fsd_v1_run WHERE id=$1', [f.lease.id]))
      .rows[0];
    assert.deepEqual(
      run.state.query_results.map((r) => r.status),
      ['FAILED', 'PARTIAL', 'SUCCESS'],
    );
  } finally {
    await f.pool.end();
  }
});
for (const direction of ['mixed', 'as_is', 'standard'])
  test('FLOW-07 confirmed direction survives immutable successor: ' + direction, async () => {
    const f = await setup();
    try {
      const model = async (args) => {
        const v = await syntheticModel(args);
        if (args.kind === 'AnalysisResult') {
          v.output.scope = direction === 'standard' ? 'report' : direction;
          v.output.standard_fit = direction === 'standard' ? 'SATISFIES' : 'UNKNOWN';
        }
        if (args.context.r.snapshot.scope_direction)
          assert.equal(args.context.r.snapshot.scope_direction.direction, direction);
        return v;
      };
      await executeRun(f.pool, f.lease, { model });
      let t = await loadTask(f.pool, f.scope, f.task.id);
      t = await transaction(f.pool, (db) =>
        command(db, f.scope, t.id, {
          request_id: randomUUID(),
          revision: t.revision,
          command: 'answer',
          question_id: 'scope-direction',
          option_id: 'continue',
        }),
      );
      t = await transaction(f.pool, (db) =>
        command(db, f.scope, t.id, {
          request_id: randomUUID(),
          revision: t.revision,
          command: 'complete_batch',
        }),
      );
      const next = await transaction(f.pool, (db) =>
        claim(db, 'direction-successor', t.active_run_id),
      );
      assert.notEqual(next.thread_id, f.lease.thread_id);
      assert.equal(next.snapshot.scope_direction.direction, direction);
      await executeRun(f.pool, next, { model });
      t = await loadTask(f.pool, f.scope, t.id);
      assert.equal(t.wait_reason, 'PLAN_CONFIRM');
      assert.equal(t.wait.kind, 'PLAN_CONFIRM');
      assert.equal(t.delivered_artifact_id, undefined);
    } finally {
      await f.pool.end();
    }
  });
test('FLOW-07 changed scope invalidates previous direction authorization', async () => {
  const f = await setup();
  try {
    const model = async (args) => {
      const v = await syntheticModel(args);
      if (args.kind === 'AnalysisResult') v.output.scope = 'mixed';
      return v;
    };
    await executeRun(f.pool, f.lease, { model });
    let t = await loadTask(f.pool, f.scope, f.task.id);
    for (const input of [
      { command: 'answer', question_id: 'scope-direction', option_id: 'continue' },
      { command: 'complete_batch' },
    ])
      t = await transaction(f.pool, (db) =>
        command(db, f.scope, t.id, { ...input, request_id: randomUUID(), revision: t.revision }),
      );
    await executeRun(
      f.pool,
      await transaction(f.pool, (db) => claim(db, 'scope-first', t.active_run_id)),
      { model },
    );
    t = await loadTask(f.pool, f.scope, t.id);
    t = await transaction(f.pool, (db) =>
      command(db, f.scope, t.id, {
        request_id: randomUUID(),
        revision: t.revision,
        command: 'change_scope',
        text: '改为另一报表并新增操作要求',
      }),
    );
    const next = await transaction(f.pool, (db) => claim(db, 'scope-changed', t.active_run_id));
    assert.equal(next.snapshot.scope_direction, null);
    await executeRun(f.pool, next, { model });
    t = await loadTask(f.pool, f.scope, t.id);
    assert.equal(t.wait_reason, 'CLARIFICATION');
    assert.equal(t.wait.questions[0].id, 'scope-direction');
  } finally {
    await f.pool.end();
  }
});
