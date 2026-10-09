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
  stepCommit,
  command,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { fault, hash } from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
import { syntheticTool } from '../../../../apps/api/src/modules/design-assistant/simulation.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../../apps/api/src/modules/design-assistant/worker.mjs';
import {
  createTelemetry,
  currentTrace,
} from '../../../../apps/api/src/modules/design-assistant/telemetry.mjs';
import { diagnostics } from '../../../../apps/api/src/modules/design-assistant/routes.mjs';
async function setup() {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  await setupCheckpoints(pool);
  const scope = await transaction(pool, fixture);
  const t = await transaction(pool, async (db) =>
    createTask(
      db,
      scope,
      {
        request_id: randomUUID(),
        text: 'ZPOC SECRET-BODY-MARKER',
        mode: 'SYNTHETIC',
        target: { target_ref: 'synthetic', client: '000' },
      },
      await assetManifest(),
    ),
  );
  return { pool, scope, t };
}
test('OBS-03 bounded tool retries and user cancellation have distinct causal attempts', async () => {
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
  let arrived;
  const barrier = new Promise((r) => (arrived = r));
  let calls = 0;
  try {
    const lease = await transaction(f.pool, (db) => claim(db, 'cancel-retries', f.t.active_run_id));
    const running = executeRun(f.pool, lease, {
      telemetry,
      tool: async (_item, { signal }) => {
        calls++;
        if (calls < 3) throw fault('BUSY', 'SAP_REMOTE');
        arrived();
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    });
    await barrier;
    const before = await loadTask(f.pool, f.scope, f.t.id);
    await transaction(f.pool, (db) =>
      command(db, f.scope, before.id, {
        request_id: randomUUID(),
        revision: before.revision,
        command: 'cancel',
      }),
    );
    await running;
    const after = await loadTask(f.pool, f.scope, f.t.id);
    assert.equal(after.status, 'PAUSED');
    assert.equal(after.budget.tool_calls, 3);
    assert.equal(after.artifacts.length, 0);
    assert.equal(calls, 3);
    await new Promise((r) => setTimeout(r, 10));
    const attempts = spans.filter((s) => s.name === 'tool.attempt');
    assert.equal(attempts.length, 3);
    assert.equal(new Set(attempts.map((s) => s.spanContext().spanId)).size, 3);
    assert.equal(attempts[1].attributes.retry_reason, 'BUSY');
    assert.equal(attempts[2].attributes.cancel_source, 'USER_COMMAND');
    assert.equal(attempts[2].attributes.remote_outcome, 'UNKNOWN');
    assert.equal(
      (
        await f.pool.query(
          "SELECT 1 FROM app.fsd_v1_commit WHERE run_id=$1 AND step_id LIKE 'N04%'",
          [lease.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await telemetry.shutdown();
    await f.pool.end();
  }
});
test('OBS-07 audit insert failure rolls back business changes and commit while trace remains available', async () => {
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
    const lease = await transaction(f.pool, (db) => claim(db, 'audit-failure', f.t.active_run_id));
    await assert.rejects(
      () =>
        telemetry.span('business.commit', { task_id: f.t.id }, () =>
          transaction(f.pool, async (db) => {
            const failing = {
              query: async (sql, args) => {
                if (sql.startsWith('INSERT INTO app.fsd_v1_event') && args[4] === 'business.commit')
                  throw Object.assign(Error('audit unavailable'), {
                    code: 'PERSISTENCE_ERROR',
                    error_origin: 'BUSINESS_COMMIT',
                  });
                return db.query(sql, args);
              },
            };
            return stepCommit(failing, lease, 'N08:audit-fault', {}, async (t) => {
              t.phase = 6;
              // A real SQL mutation before the failing mandatory audit must also roll back.
              await db.query('UPDATE app.fsd_v1_task SET revision=revision+1 WHERE id=$1', [t.id]);
              return { phase: 6 };
            });
          }),
        ),
      { code: 'PERSISTENCE_ERROR' },
    );
    const t = await loadTask(f.pool, f.scope, f.t.id);
    assert.equal(t.revision, f.t.revision);
    assert.equal(t.phase, f.t.phase);
    assert.equal(
      (
        await f.pool.query('SELECT count(*)::int n FROM app.fsd_v1_commit WHERE run_id=$1', [
          lease.id,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM app.fsd_v1_event WHERE run_id=$1 AND event_type='business.commit'",
          [lease.id],
        )
      ).rows[0].n,
      0,
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(
      spans.some(
        (s) => s.name === 'business.commit' && s.attributes.error_code === 'PERSISTENCE_ERROR',
      ),
    );
  } finally {
    await telemetry.shutdown();
    await f.pool.end();
  }
});
test('OBS-04 failure marker in provider metadata never reaches spans or diagnostic timelines', async () => {
  const f = await setup(),
    spans = [];
  const telemetry = createTelemetry({
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
    const lease = await transaction(f.pool, (db) => claim(db, 'redaction', f.t.active_run_id));
    await assert.rejects(() =>
      executeRun(f.pool, lease, {
        telemetry,
        model: async () => {
          throw Object.assign(Error('SECRET-BODY-MARKER'), {
            code: 'SECRET-BODY-MARKER',
            error_origin: 'SECRET-BODY-MARKER',
            headers: { authorization: 'SECRET-BODY-MARKER' },
          });
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    const t = await loadTask(f.pool, f.scope, f.t.id),
      d = await diagnostics(f.pool, t, telemetry.metrics());
    assert.equal(JSON.stringify(d).includes('SECRET-BODY-MARKER'), false);
    assert.equal(
      JSON.stringify(spans.map((s) => s.attributes)).includes('SECRET-BODY-MARKER'),
      false,
    );
    assert.equal(d.runs[0].error.code, 'UNKNOWN');
    assert.ok(d.runs[0].checkpoint_id);
    assert.ok(d.timeline.some((e) => e.event_type === 'operation.failed'));
  } finally {
    await telemetry.shutdown();
    await f.pool.end();
  }
});
test('OBS-05 unavailable exporter cannot stop graph, persisted audit or checkpoint ACK', async () => {
  let online = false;
  const f = await setup(),
    telemetry = createTelemetry({
      log: false,
      spanExporter: {
        export: (_spans, done) => {
          if (online) done({ code: 0 });
        },
        shutdown: async () => {},
      },
      exportOptions: { capacity: 5, timeoutMs: 2 },
    });
  try {
    const lease = await transaction(f.pool, (db) => claim(db, 'offline-trace', f.t.active_run_id));
    await executeRun(f.pool, lease, { telemetry });
    await new Promise((r) => setTimeout(r, 30));
    const t = await loadTask(f.pool, f.scope, f.t.id),
      d = await diagnostics(f.pool, t, telemetry.metrics());
    assert.equal(t.wait_reason, 'CLARIFICATION');
    assert.ok(d.timeline.some((e) => e.event_type === 'checkpoint.ack'));
    assert.equal(d.observation.degraded, true);
    assert.ok(d.observation.exporter.failed_total > 0);
    assert.ok(d.observation.exporter.dropped_total > 0);
    assert.ok(d.missing_spans);
    online = true;
    await telemetry.span('recovered.export', {}, async () => {});
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(telemetry.metrics().exporter.exported_total > 0);
    assert.equal((await loadTask(f.pool, f.scope, f.t.id)).revision, t.revision);
  } finally {
    await telemetry.shutdown();
    await f.pool.end();
  }
});
test('OBS-08 concurrent async span contexts stay isolated and metrics never label task IDs', async () => {
  const spans = [],
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
    let release;
    const gate = new Promise((r) => (release = r));
    const roots = {};
    const a = telemetry.span('root.a', { task_id: 'task-a' }, async () => {
      roots.a = currentTrace();
      await gate;
      await telemetry.span('child.a', { task_id: 'task-a' }, async () =>
        assert.equal(currentTrace().trace_id, roots.a.trace_id),
      );
    });
    await telemetry.span('root.b', { task_id: 'task-b' }, async () => {
      roots.b = currentTrace();
      await telemetry.span('child.b', { task_id: 'task-b' }, async () =>
        assert.equal(currentTrace().trace_id, roots.b.trace_id),
      );
      release();
    });
    await a;
    await new Promise((r) => setTimeout(r, 10));
    assert.notEqual(roots.a.trace_id, roots.b.trace_id);
    for (const side of ['a', 'b']) {
      const child = spans.find((s) => s.name === 'child.' + side);
      assert.equal(child.parentSpanContext.spanId, roots[side].span_id);
    }
    telemetry.count('failure_total', { task_id: 'task-a', error_code: 'TIMEOUT' });
    assert.equal(JSON.stringify(telemetry.metrics()).includes('task-a'), false);
  } finally {
    await telemetry.shutdown();
  }
});
test('DBG-02 fixed input and evidence compare a single Prompt variable with correctness and usage', async () => {
  const a = await setup(),
    b = await setup(),
    fixedTime = new Date().toISOString();
  try {
    const original = (
      await a.pool.query('SELECT assets,snapshot FROM app.fsd_v1_run WHERE id=$1', [
        a.t.active_run_id,
      ])
    ).rows[0];
    const candidate = structuredClone(original.assets);
    candidate.prompt_text += '\n合成比较：保持相同输出契约。';
    candidate.prompt_hash = hash(candidate.prompt_text);
    await b.pool.query('UPDATE app.fsd_v1_run SET assets=$2 WHERE id=$1', [
      b.t.active_run_id,
      candidate,
    ]);
    const other = (
      await b.pool.query('SELECT snapshot FROM app.fsd_v1_run WHERE id=$1', [b.t.active_run_id])
    ).rows[0];
    assert.deepEqual(original.snapshot, other.snapshot);
    const strip = (x) =>
      Object.fromEntries(
        Object.entries(x).filter(([k]) => !['prompt_text', 'prompt_hash'].includes(k)),
      );
    assert.deepEqual(strip(original.assets), strip(candidate));
    assert.notEqual(original.assets.prompt_hash, candidate.prompt_hash);
    const results = [];
    for (const f of [a, b]) {
      const start = performance.now(),
        lease = await transaction(f.pool, (db) =>
          claim(db, 'prompt-comparison', f.t.active_run_id),
        );
      await executeRun(f.pool, lease, {
        tool: async (item, ctx) => ({
          ...(await syntheticTool(item, ctx)),
          observed_at: fixedTime,
        }),
      });
      const t = await loadTask(f.pool, f.scope, f.t.id);
      const d = await diagnostics(f.pool, t);
      assert.equal(t.wait_reason, 'CLARIFICATION');
      assert.equal(t.artifacts.length, 0);
      assert.ok(t.evidence.every((e) => e.validity === 'VALID'));
      assert.ok(d.operations.filter((o) => o.kind === 'model').every((o) => o.usage_known));
      results.push({
        input_hash: hash(original.snapshot),
        evidence_content_hash: hash(t.evidence.map((e) => e.data)),
        questions: t.wait.questions,
        correctness: 'PASS',
        expert_quality: null,
        modified_object_count: Object.keys(t.objects).length,
        tokens: t.budget.tokens,
        elapsed_ms: performance.now() - start,
        error_count: d.operations.filter((o) => o.error).length,
        cost: null,
      });
    }
    assert.equal(results[0].evidence_content_hash, results[1].evidence_content_hash);
    assert.deepEqual(results[0].questions, results[1].questions);
    assert.ok(
      results.every((r) => r.error_count === 0 && r.tokens > 0 && r.modified_object_count === 0),
    );
    console.log(
      JSON.stringify({
        case_id: 'DBG-02',
        mode: 'SYNTHETIC',
        changed_variable: 'prompt_text',
        results,
      }),
    );
  } finally {
    await a.pool.end();
    await b.pool.end();
  }
});
