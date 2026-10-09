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

test('LangGraph persists real deltas before the provider finishes and checkpoints the reply', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let streamed;
  const first = new Promise((resolve) => {
    streamed = resolve;
  });
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture);
    const { turn, task } = await transaction(pool, async (db) => {
      const task = await createTask(
        db,
        scope,
        {
          request_id: randomUUID(),
          text: '解释刚才的范围',
          target: { target_ref: 'synthetic' },
          mode: 'SYNTHETIC',
        },
        await assetManifest(),
      );
      task.input.chat_action = 'dialogue';
      task.input.chat_messages = [
        { role: 'user', content: '采购订单' },
        { role: 'assistant', content: '先确认范围' },
        { role: 'user', content: task.input.text },
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
    const lease = await transaction(pool, (db) => claim(db, 'chat-flow', task.active_run_id));
    let calls = 0;
    const running = executeRun(pool, lease, {
      streamModel: async ({ context, onDelta }) => {
        calls++;
        assert.equal(context.r.snapshot.chat_messages[0].content, '采购订单');
        await onDelta('第一段');
        streamed();
        await barrier;
        await onDelta('第二段');
        return { text: '第一段第二段', usage: { total_tokens: 12 } };
      },
    });
    // Do not leave a rejected worker promise unhandled if the expected branch is absent.
    await Promise.race([
      first,
      running.then(() => {
        throw Error('No streaming chat node executed');
      }),
    ]);
    const partial = await readChatEvents(pool, scope, turn.id);
    assert.equal(
      partial
        .filter((e) => e.type === 'message.delta')
        .map((e) => e.data.text)
        .join(''),
      '第一段',
    );
    assert.ok(!partial.some((e) => e.type === 'run.completed'));
    release();
    await running;
    const events = await readChatEvents(pool, scope, turn.id);
    assert.equal(events.at(-1).type, 'run.completed');
    assert.equal(calls, 1);
    const row = (await pool.query('SELECT state FROM app.fsd_v1_task WHERE id=$1', [task.id]))
      .rows[0];
    assert.equal(row.state.messages.at(-1).content, '第一段第二段');
  } finally {
    release();
    await pool.end();
  }
});

test('a provider rejecting the key fails the chat turn with a specific code and message', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture);
    const { turn, task } = await transaction(pool, async (db) => {
      const task = await createTask(
        db,
        scope,
        {
          request_id: randomUUID(),
          text: '分析交货逾期需求',
          target: { target_ref: 'synthetic' },
          mode: 'SYNTHETIC',
        },
        await assetManifest(),
      );
      task.input.chat_action = 'dialogue';
      task.input.chat_messages = [{ role: 'user', content: task.input.text }];
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
    const lease = await transaction(pool, (db) => claim(db, 'chat-auth', task.active_run_id));
    await executeRun(pool, lease, {
      streamModel: async () => {
        throw Object.assign(new Error('提供方拒绝认证或无权访问模型。'), {
          code: 'AUTH_FAILED',
          statusCode: 502,
        });
      },
    }).catch(() => {});
    const failed = (await readChatEvents(pool, scope, turn.id)).at(-1);
    assert.equal(failed.type, 'run.failed');
    assert.equal(failed.data.code, 'MODEL_AUTH_FAILED');
    assert.match(failed.data.message, /API Key/);
  } finally {
    await pool.end();
  }
});
