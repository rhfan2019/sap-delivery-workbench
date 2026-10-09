import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../../scripts/testing/run-tests.mjs';
import {
  loadTask,
  claim,
  saveTask,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import {
  startChatTurn,
  chatRunSnapshot,
  cancelChatTurn,
} from '../../../../apps/api/src/modules/design-assistant/chat-service.mjs';
import {
  chatWorkflow,
  chatWorkflowCommand,
} from '../../../../apps/api/src/modules/design-assistant/chat-workflow.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../../apps/api/src/modules/design-assistant/worker.mjs';
import { syntheticModel } from '../../../../apps/api/src/modules/design-assistant/simulation.mjs';

test('original chat protocol supports clarification and two exact version approvals', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture),
      assets = await assetManifest();
    let receipt = await transaction(pool, (db) =>
      startChatTurn(
        db,
        scope,
        { requestId: randomUUID(), prompt: '生成 ZPOC 未清订单报表功能说明书', action: 'draft' },
        assets,
        { target_ref: 'synthetic', client: '000', allowed_urls: [] },
      ),
    );
    const run = async () => {
      const task = await loadTask(pool, scope, receipt.conversationId);
      const lease = await transaction(pool, (db) => claim(db, 'chat-workflow', task.active_run_id));
      assert.ok(lease);
      await executeRun(pool, lease);
      return chatRunSnapshot(pool, scope, receipt.runId);
    };
    let snapshot = await run();
    assert.equal(snapshot.state, 'waiting_user');
    const decision = snapshot.snapshot.decision;
    const waiting = await loadTask(pool, scope, receipt.conversationId);
    const attachmentId = randomUUID();
    await transaction(pool, async (db) => {
      await db.query(
        'INSERT INTO app.fsd_v1_attachment(id,task_id,name,media_type,bytes,content_hash,extraction) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          attachmentId,
          waiting.id,
          'basis.txt',
          'text/plain',
          Buffer.from('basis'),
          'test',
          { state: 'ready', text: 'basis' },
        ],
      );
      waiting.attachment_ids = [attachmentId];
      await saveTask(db, waiting);
    });
    for (const outcome of ['success', 'failure', 'cancel']) {
      const side = await transaction(pool, (db) =>
        startChatTurn(
          db,
          scope,
          {
            requestId: randomUUID(),
            conversationId: waiting.id,
            prompt: '解释这个问题',
            action: 'dialogue',
          },
          assets,
        ),
      );
      if (outcome === 'cancel')
        await transaction(pool, (db) => cancelChatTurn(db, scope, side.runId));
      else {
        const current = await loadTask(pool, scope, waiting.id);
        const lease = await transaction(pool, (db) =>
          claim(db, 'side-chat', current.active_run_id),
        );
        const execution = executeRun(pool, lease, {
          streamModel: async ({ onDelta }) => {
            if (outcome === 'failure')
              throw Object.assign(Error('provider failed'), { code: 'CONNECTION_ERROR' });
            await onDelta('说明');
            return { text: '说明', usage: { total_tokens: 2 } };
          },
        });
        if (outcome === 'failure') await assert.rejects(execution);
        else await execution;
      }
      const restored = await loadTask(pool, scope, waiting.id);
      assert.equal(restored.active_run_id, waiting.active_run_id);
      assert.equal(restored.wait.id, decision.id);
      assert.deepEqual(restored.attachment_ids, [attachmentId]);
      assert.ok(!restored.chat.pendingDesign);
    }
    const values = Object.fromEntries(
      decision.questions.map((q) => [
        q.id,
        q.options.find((o) => o.recommended)?.value ?? q.options[0].value,
      ]),
    );
    receipt = await transaction(pool, (db) =>
      startChatTurn(
        db,
        scope,
        {
          requestId: randomUUID(),
          conversationId: receipt.conversationId,
          prompt: snapshot.snapshot.prompt,
          action: 'draft',
          resumeRunId: receipt.runId,
          decisionAnswer: { decisionId: decision.id, values },
        },
        assets,
      ),
    );
    snapshot = await run();
    assert.equal(snapshot.state, 'completed');
    let workflow = await chatWorkflow(pool, scope, receipt.conversationId);
    assert.equal(workflow.phase, 'draft_review');
    const approve = async (command) =>
      transaction(pool, (db) =>
        chatWorkflowCommand(db, scope, receipt.conversationId, {
          command,
          requestId: randomUUID(),
          expectedVersion: workflow.version,
          revisionId: workflow.activeRevisionId,
          contentHash: workflow.activeContentHash,
        }),
      );
    workflow = await approve('approve_draft');
    assert.equal(workflow.phase, 'refining');
    assert.equal(workflow.activeRunId, null, 'approval alone must not start final generation');
    receipt = await transaction(pool, (db) =>
      startChatTurn(
        db,
        scope,
        {
          requestId: randomUUID(),
          conversationId: receipt.conversationId,
          prompt: '基于已确认初稿生成正式版',
          action: 'draft',
        },
        assets,
      ),
    );
    snapshot = await run();
    workflow = await chatWorkflow(pool, scope, receipt.conversationId);
    assert.equal(workflow.phase, 'final_review');
    workflow = await approve('approve_final');
    const task = await loadTask(pool, scope, receipt.conversationId);
    await executeRun(
      pool,
      await transaction(pool, (db) => claim(db, 'chat-workflow', task.active_run_id)),
    );
    assert.equal((await chatWorkflow(pool, scope, receipt.conversationId)).phase, 'completed');
  } finally {
    await pool.end();
  }
});

test('I-07 retrying a failed final generation keeps the plan approval and redoes only the FSD round', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture),
      assets = await assetManifest();
    let receipt = await transaction(pool, (db) =>
      startChatTurn(
        db,
        scope,
        { requestId: randomUUID(), prompt: '生成 ZPOC 未清订单报表功能说明书', action: 'draft' },
        assets,
        { target_ref: 'synthetic', client: '000', allowed_urls: [] },
      ),
    );
    const id = receipt.conversationId;
    const run = async (options) => {
      const task = await loadTask(pool, scope, id);
      const lease = await transaction(pool, (db) => claim(db, 'i07', task.active_run_id));
      assert.ok(lease);
      await executeRun(pool, lease, options).catch(() => {});
      return chatRunSnapshot(pool, scope, receipt.runId);
    };
    const turn = (prompt, extra = {}) =>
      transaction(pool, (db) =>
        startChatTurn(
          db,
          scope,
          { requestId: randomUUID(), conversationId: id, prompt, action: 'draft', ...extra },
          assets,
        ),
      );
    let snapshot = await run();
    const decision = snapshot.snapshot.decision;
    receipt = await turn(snapshot.snapshot.prompt, {
      resumeRunId: receipt.runId,
      decisionAnswer: {
        decisionId: decision.id,
        values: Object.fromEntries(decision.questions.map((q) => [q.id, q.options[0].value])),
      },
    });
    await run();
    let workflow = await chatWorkflow(pool, scope, id);
    assert.equal(workflow.phase, 'draft_review');
    workflow = await transaction(pool, (db) =>
      chatWorkflowCommand(db, scope, id, {
        command: 'approve_draft',
        requestId: randomUUID(),
        expectedVersion: workflow.version,
        revisionId: workflow.activeRevisionId,
        contentHash: workflow.activeContentHash,
      }),
    );
    // First final generation fails in the FSD round.
    receipt = await turn('基于已确认初稿生成正式版');
    snapshot = await run({
      model: async (args) => {
        if (args.kind === 'ChangeProposal')
          throw Object.assign(Error('provider down'), { code: 'CONNECTION_ERROR' });
        return syntheticModel(args);
      },
    });
    assert.equal(snapshot.state, 'failed');
    // Retry: the plan approval survives and only the FSD round is redone.
    const kinds = [];
    receipt = await turn('基于已确认初稿生成正式版');
    await run({
      model: async (args) => {
        kinds.push(args.kind);
        return syntheticModel(args);
      },
    });
    const task = await loadTask(pool, scope, id);
    assert.ok(task.confirmations.some((c) => c.kind === 'PLAN_CONFIRM'));
    assert.ok(!kinds.includes('AnalysisResult'), 'the retry must not restart requirement analysis');
    workflow = await chatWorkflow(pool, scope, id);
    assert.equal(workflow.phase, 'final_review');
    workflow = await transaction(pool, (db) =>
      chatWorkflowCommand(db, scope, id, {
        command: 'approve_final',
        requestId: randomUUID(),
        expectedVersion: workflow.version,
        revisionId: workflow.activeRevisionId,
        contentHash: workflow.activeContentHash,
      }),
    );
    await run();
    assert.equal((await chatWorkflow(pool, scope, id)).phase, 'completed');
  } finally {
    await pool.end();
  }
});
