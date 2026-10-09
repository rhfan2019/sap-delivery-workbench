import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../../scripts/testing/run-tests.mjs';
import {
  createTask,
  saveTask,
  claim,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import {
  createTurn,
  readChatEvents,
} from '../../../../apps/api/src/modules/design-assistant/chat-events.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../../apps/api/src/modules/design-assistant/worker.mjs';
async function setup(budget = {}) {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture);
    const assets = await assetManifest();
    assets.budget = { ...assets.budget, ...budget };
    const { task, turn } = await transaction(pool, async (db) => {
      const task = await createTask(
        db,
        scope,
        {
          request_id: randomUUID(),
          text: '恢复聊天',
          mode: 'SYNTHETIC',
          target: { target_ref: 'synthetic' },
        },
        assets,
      );
      task.input.chat_action = 'dialogue';
      task.input.chat_messages = [{ role: 'user', content: task.input.text }];
      task.messages = [
        { id: randomUUID(), role: 'user', content: task.input.text, status: 'completed' },
      ];
      await db.query('UPDATE app.fsd_v1_run SET snapshot=snapshot || $2::jsonb WHERE id=$1', [
        task.active_run_id,
        task.input,
      ]);
      const turn = await createTurn(db, scope, task.id, task.active_run_id, {
        prompt: task.input.text,
      });
      await db.query('UPDATE app.fsd_v1_run SET state=state || $2::jsonb WHERE id=$1', [
        task.active_run_id,
        { chat_turn_id: turn.id },
      ]);
      await saveTask(db, task);
      return { task, turn };
    });
    return { pool, scope, task, turn };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
async function child(run, point = '') {
  const process = fork(
    new URL('../../../fixtures/design-assistant/chat-crash-worker.mjs', import.meta.url),
    [run, point],
    { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  let calls = 0,
    timer;
  const result = await new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      process.kill('SIGKILL');
      reject(Error('chat worker barrier timeout'));
    }, 15000);
    process.on('message', (message) => {
      if (message.modelCall) calls++;
      else resolve(message);
    });
    process.once('error', reject);
    process.once('exit', (code) => {
      if (code) reject(Error('chat worker exited ' + code));
    });
  }).finally(() => clearTimeout(timer));
  return { process, result, calls };
}
for (const point of [
  'after_operation_result_before_checkpoint',
  'after_business_commit_before_checkpoint',
])
  test(
    'CHAT hard kill at ' + point + ' resumes same thread with no duplicated model/deltas/history',
    async () => {
      const f = await setup();
      let worker;
      try {
        worker = await child(f.task.active_run_id, point);
        assert.equal(worker.result.point, point);
        assert.equal(worker.calls, 1);
        const exit = once(worker.process, 'exit');
        worker.process.kill('SIGKILL');
        await exit;
        const before = (
          await f.pool.query('SELECT thread_id FROM app.fsd_v1_run WHERE id=$1', [
            f.task.active_run_id,
          ])
        ).rows[0];
        const partial = await readChatEvents(f.pool, f.scope, f.turn.id);
        assert.equal(partial.filter((e) => e.type === 'message.delta').length, 2);
        await f.pool.query(
          "UPDATE app.fsd_v1_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
          [f.task.active_run_id],
        );
        worker = await child(f.task.active_run_id);
        assert.equal(worker.result.done, true, JSON.stringify(worker.result));
        assert.equal(worker.calls, 0, 'settled model operation must not execute on restart');
        if (worker.process.exitCode === null) await once(worker.process, 'exit');
        const current = (
          await f.pool.query('SELECT thread_id,status FROM app.fsd_v1_run WHERE id=$1', [
            f.task.active_run_id,
          ])
        ).rows[0];
        assert.equal(current.thread_id, before.thread_id);
        assert.equal(current.status, 'WAITING');
        const events = await readChatEvents(f.pool, f.scope, f.turn.id);
        assert.deepEqual(
          events.filter((e) => e.type === 'message.delta'),
          partial.filter((e) => e.type === 'message.delta'),
        );
        assert.equal(events.filter((e) => e.type === 'run.completed').length, 1);
        const state = (
          await f.pool.query('SELECT state FROM app.fsd_v1_task WHERE id=$1', [f.task.id])
        ).rows[0].state;
        assert.equal(state.messages.filter((m) => m.role === 'user').length, 1);
        assert.equal(state.messages.filter((m) => m.role === 'assistant').length, 1);
        assert.equal(state.messages.at(-1).content, '持久化回复');
      } finally {
        if (worker?.process.exitCode === null) worker.process.kill('SIGKILL');
        await f.pool.end();
      }
    },
  );
test('CHAT absolute deadline terminates a never-resolving provider and rejects late deltas', async () => {
  const f = await setup({ model_call_timeout: 30 });
  let lateDelta, providerSignal;
  try {
    const lease = await transaction(f.pool, (db) =>
      claim(db, 'chat-timeout', f.task.active_run_id),
    );
    const started = Date.now();
    await assert.rejects(
      executeRun(f.pool, lease, {
        streamModel: async ({ onDelta, signal }) => {
          lateDelta = onDelta;
          providerSignal = signal;
          return new Promise(() => {});
        },
      }),
      { name: 'TimeoutError' },
    );
    assert.ok(
      Date.now() - started < 5000,
      'worker must not wait indefinitely for an uncooperative provider',
    );
    assert.equal(providerSignal.aborted, true);
    const before = await readChatEvents(f.pool, f.scope, f.turn.id);
    assert.equal(before.at(-1).type, 'run.failed');
    await assert.rejects(() => lateDelta('迟到正文'));
    assert.deepEqual(await readChatEvents(f.pool, f.scope, f.turn.id), before);
  } finally {
    await f.pool.end();
  }
});
