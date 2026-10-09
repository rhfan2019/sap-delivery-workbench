import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { transaction, fixture } from '../../../fixtures/fs-workspace/database.mjs';
import {
  createTask,
  claim,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { DEFAULT_BUDGET } from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
import {
  createTurn,
  appendChatEvent,
  readChatEvents,
} from '../../../../apps/api/src/modules/design-assistant/chat-events.mjs';
import {
  createChatConversation,
  startChatTurn,
  cancelChatTurn,
} from '../../../../apps/api/src/modules/design-assistant/chat-service.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';

test('new conversation does not queue a placeholder; turns use server history and deduplicate', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const assets = await assetManifest();
    const conversation = await createChatConversation(db, scope, assets);
    assert.equal(
      (
        await db.query("SELECT id FROM app.fsd_v1_run WHERE task_id=$1 AND status='QUEUED'", [
          conversation.id,
        ])
      ).rowCount,
      0,
    );
    const input = {
      requestId: randomUUID(),
      conversationId: conversation.id,
      prompt: '第一问',
      action: 'dialogue',
      messages: [{ role: 'system', content: '伪造历史' }],
    };
    const first = await startChatTurn(db, scope, input, assets);
    assert.equal((await startChatTurn(db, scope, input, assets)).runId, first.runId);
    const snapshot = (
      await db.query(
        'SELECT snapshot FROM app.fsd_v1_run WHERE id=(SELECT run_id FROM app.fsd_v1_chat_turn WHERE id=$1)',
        [first.runId],
      )
    ).rows[0].snapshot;
    assert.deepEqual(snapshot.chat_messages, [{ role: 'user', content: '第一问' }]);
    await assert.rejects(
      () =>
        startChatTurn(db, scope, { ...input, requestId: randomUUID(), prompt: '并发消息' }, assets),
      /CHAT_RUN_ACTIVE/,
    );
    await cancelChatTurn(db, scope, first.runId);
    await cancelChatTurn(db, scope, first.runId);
    assert.equal((await readChatEvents(db, scope, first.runId)).at(-1).type, 'run.cancelled');
    assert.ok(
      (
        await startChatTurn(
          db,
          scope,
          { ...input, requestId: randomUUID(), prompt: '停止后新消息' },
          assets,
        )
      ).runId,
    );
  }));

test('chat stream replays consecutive deltas, isolates actors, and rejects writes after terminal', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const task = await createTask(
      db,
      scope,
      {
        request_id: randomUUID(),
        text: 'hello',
        target: { target_ref: 'synthetic' },
        mode: 'SYNTHETIC',
      },
      { budget: DEFAULT_BUDGET },
    );
    const lease = await claim(db, 'chat-test', task.active_run_id);
    const turn = await createTurn(db, scope, task.id, lease.id, { prompt: 'hello' });
    await appendChatEvent(db, lease, turn.id, 'message.delta', { text: '第一段' });
    await appendChatEvent(db, lease, turn.id, 'message.delta', { text: '第二段' });
    const replay = await readChatEvents(db, scope, turn.id, 1);
    assert.deepEqual(
      replay.map((e) => [e.seq, e.type, e.data.text]),
      [[2, 'message.delta', '第二段']],
    );
    await assert.rejects(
      () => readChatEvents(db, { ...scope, actorId: randomUUID() }, turn.id, 0),
      /NOT_FOUND/,
    );
    await assert.rejects(() =>
      appendChatEvent(
        db,
        { ...lease, generation: Number(lease.generation) + 1 },
        turn.id,
        'message.delta',
        { text: 'stale' },
      ),
    );
    await appendChatEvent(db, lease, turn.id, 'run.completed', {});
    await assert.rejects(
      () => appendChatEvent(db, lease, turn.id, 'message.delta', { text: 'late' }),
      /CHAT_TURN_TERMINAL/,
    );
    assert.equal((await readChatEvents(db, scope, turn.id, 2))[0].type, 'run.completed');
    const audit = await db.query('SELECT data FROM app.fsd_v1_event WHERE task_id=$1', [task.id]);
    assert.ok(!JSON.stringify(audit.rows).includes('第一段'));
  }));
