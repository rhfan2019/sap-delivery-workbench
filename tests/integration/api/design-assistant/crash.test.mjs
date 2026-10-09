import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../../scripts/testing/run-tests.mjs';
import {
  createTask,
  loadTask,
  command,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
const worker = new URL('../../../fixtures/design-assistant/crash-worker.mjs', import.meta.url);
async function child(run, point = '', step = '') {
  const p = fork(worker, [run, point, step], {
    execArgv: [],
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const result = await Promise.race([
    once(p, 'message').then(([m]) => m),
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        reject(Error('child barrier timeout'));
      }, 15000);
      timer.unref();
    }),
  ]);
  return { p, result };
}
for (const [id, point, step] of [
  ['REC-01', 'after_operation_result_before_checkpoint', ''],
  ['REC-02', 'after_business_commit_before_checkpoint', 'N04'],
  ['REC-04', 'after_interrupt', ''],
])
  test(id + ' real independent worker kill/restart preserves run/thread/results', async () => {
    assertIsolatedDatabase(process.env);
    const pool = new pg.Pool(databaseConfig());
    try {
      await setupCheckpoints(pool);
      const scope = await transaction(pool, fixture);
      const task = await transaction(pool, async (db) =>
        createTask(
          db,
          scope,
          {
            request_id: randomUUID(),
            text: 'ZPOC',
            mode: 'SYNTHETIC',
            target: { target_ref: 'synthetic', client: '000' },
          },
          await assetManifest(),
        ),
      );
      const { p, result } = await child(task.active_run_id, point, step);
      assert.equal(result.point, point);
      const exit = once(p, 'exit');
      p.kill('SIGKILL');
      await exit;
      const original = (
        await pool.query('SELECT * FROM app.fsd_v1_run WHERE id=$1', [task.active_run_id])
      ).rows[0];
      await pool.query(
        "UPDATE app.fsd_v1_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [task.active_run_id],
      );
      const next = await child(task.active_run_id);
      assert.equal(next.result.done, true, JSON.stringify(next.result));
      await once(next.p, 'exit');
      const current = (
        await pool.query('SELECT * FROM app.fsd_v1_run WHERE id=$1', [task.active_run_id])
      ).rows[0];
      assert.equal(current.thread_id, original.thread_id);
      assert.equal(current.status, 'WAITING');
      const abandoned = (
        await pool.query(
          'SELECT ended_at,state FROM app.fsd_v1_attempt WHERE run_id=$1 ORDER BY started_at LIMIT 1',
          [task.active_run_id],
        )
      ).rows[0];
      assert.ok(abandoned.ended_at);
      assert.equal(abandoned.state.status, 'ABANDONED');
      assert.equal(abandoned.state.end_reason, 'LEASE_EXPIRED');
      const attempts = (
        await pool.query(
          'SELECT trace_id,state FROM app.fsd_v1_attempt WHERE run_id=$1 ORDER BY started_at',
          [task.active_run_id],
        )
      ).rows;
      assert.notEqual(attempts[0].trace_id, attempts[1].trace_id);
      assert.notEqual(attempts[0].state.span_id, attempts[1].state.span_id);
      assert.equal(attempts[1].state.recovery_of_trace_id, attempts[0].trace_id);
      assert.equal((await loadTask(pool, scope, task.id)).wait_reason, 'CLARIFICATION');
      assert.equal(
        (
          await pool.query('SELECT count(*)::int AS n FROM app.fsd_v1_attempt WHERE run_id=$1', [
            task.active_run_id,
          ])
        ).rows[0].n,
        2,
      );
    } finally {
      await pool.end();
    }
  });
test('REC-02 artifact commit then hard exit does not publish a second artifact', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture);
    let task = await transaction(pool, async (db) =>
      createTask(
        db,
        scope,
        {
          request_id: randomUUID(),
          text: 'ZPOC',
          mode: 'SYNTHETIC',
          target: { target_ref: 'synthetic', client: '000' },
        },
        await assetManifest(),
      ),
    );
    let worker = await child(task.active_run_id);
    assert.equal(worker.result.done, true);
    await once(worker.p, 'exit');
    task = await loadTask(pool, scope, task.id);
    task = await transaction(pool, (db) =>
      command(db, scope, task.id, {
        request_id: randomUUID(),
        revision: task.revision,
        command: 'answer',
        question_id: task.wait.questions[0].id,
        option_id: 'remaining',
      }),
    );
    task = await transaction(pool, (db) =>
      command(db, scope, task.id, {
        request_id: randomUUID(),
        revision: task.revision,
        command: 'complete_batch',
      }),
    );
    worker = await child(task.active_run_id, 'after_business_commit_before_checkpoint', 'N08');
    assert.equal(worker.result.step_id.startsWith('N08'), true);
    let exit = once(worker.p, 'exit');
    worker.p.kill('SIGKILL');
    await exit;
    const committed = await loadTask(pool, scope, task.id);
    assert.equal(committed.artifacts.length, 1);
    await pool.query(
      "UPDATE app.fsd_v1_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [task.active_run_id],
    );
    worker = await child(task.active_run_id);
    assert.equal(worker.result.done, true, JSON.stringify(worker.result));
    await once(worker.p, 'exit');
    task = await loadTask(pool, scope, task.id);
    assert.equal(task.artifacts.length, 1);
    assert.equal(task.artifacts[0].id, committed.artifacts[0].id);
    assert.equal(task.wait_reason, 'PLAN_CONFIRM');
    worker = await child(task.active_run_id, 'after_decision_commit_before_dispatch');
    assert.equal(worker.result.point, 'after_decision_commit_before_dispatch');
    exit = once(worker.p, 'exit');
    worker.p.kill('SIGKILL');
    await exit;
    task = await loadTask(pool, scope, task.id);
    const decisionId = task.confirmations[0].id;
    assert.equal(
      (
        await pool.query(
          "SELECT dispatch_status FROM app.fsd_v1_event WHERE run_id=$1 AND event_type='decision.recorded'",
          [task.active_run_id],
        )
      ).rows[0].dispatch_status,
      'PENDING',
    );
    worker = await child(
      task.active_run_id,
      'after_business_commit_before_checkpoint',
      'N09:plan-confirmed',
    );
    assert.equal(worker.result.step_id, 'N09:plan-confirmed');
    exit = once(worker.p, 'exit');
    worker.p.kill('SIGKILL');
    await exit;
    await pool.query(
      "UPDATE app.fsd_v1_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [task.active_run_id],
    );
    worker = await child(task.active_run_id);
    assert.equal(worker.result.done, true, JSON.stringify(worker.result));
    await once(worker.p, 'exit');
    task = await loadTask(pool, scope, task.id);
    assert.equal(task.wait_reason, 'FSD_CONFIRM');
    assert.equal(task.artifacts.length, 2);
    assert.equal(task.artifacts[1].kind, 'FSD');
    assert.equal(task.confirmations.length, 1);
    assert.equal(task.confirmations[0].id, decisionId);
  } finally {
    await pool.end();
  }
});
