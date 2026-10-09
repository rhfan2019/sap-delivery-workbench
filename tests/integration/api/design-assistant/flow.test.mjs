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
  command,
  claim,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../../apps/api/src/modules/design-assistant/worker.mjs';
import {
  syntheticModel,
  syntheticTool,
} from '../../../../apps/api/src/modules/design-assistant/simulation.mjs';
test('FLOW-01 / REC-04 fixed clarification, successor thread, two exact gates and delivery', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  try {
    await setupCheckpoints(pool);
    const scope = await transaction(pool, fixture);
    const assets = await assetManifest();
    let task = await transaction(pool, (db) =>
      createTask(
        db,
        scope,
        {
          request_id: randomUUID(),
          text: 'ZPOC 未清订单报表（测试伪对象）',
          target: { target_ref: 'synthetic', client: '000', allowed_urls: [] },
          mode: 'SYNTHETIC',
        },
        assets,
      ),
    );
    const first = task.active_run_id;
    const run = async () => {
      const lease = await transaction(pool, (db) => claim(db, 'test', task.active_run_id));
      assert.ok(lease);
      await executeRun(pool, lease, { model: syntheticModel, tool: syntheticTool });
      task = await loadTask(pool, scope, task.id);
    };
    const cmd = async (body) => {
      task = await transaction(pool, (db) =>
        command(db, scope, task.id, { request_id: randomUUID(), revision: task.revision, ...body }),
      );
    };
    await run();
    assert.equal(task.wait_reason, 'CLARIFICATION');
    const calls = task.budget.model_calls;
    const fixedQuestions = JSON.stringify(task.wait.questions);
    const attachmentId = randomUUID();
    await pool.query(
      'INSERT INTO app.fsd_v1_attachment(id,task_id,name,media_type,bytes,content_hash,extraction) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        attachmentId,
        task.id,
        'requirements.txt',
        'text/plain',
        Buffer.from('material'),
        'hash-material',
        {
          state: 'ready',
          regions: [{ locator: 'lines:1', text: 'UNIQUE-ATTACHMENT-REQUIREMENT' }],
        },
      ],
    );
    await pool.query(
      "UPDATE app.fsd_v1_task SET state=jsonb_set(state,'{attachment_ids}',$2::jsonb) WHERE id=$1",
      [task.id, JSON.stringify([attachmentId])],
    );
    const q = task.wait.questions[0];
    await cmd({
      command: 'answer',
      question_id: q.id,
      option_id: q.options[0].id,
      attachment_ids: [attachmentId],
    });
    assert.equal(task.budget.model_calls, calls);
    await cmd({
      command: 'answer',
      question_id: q.id,
      option_id: q.options.at(-1).id,
      text: 'SYNTHETIC changed answer',
      attachment_ids: [attachmentId],
    });
    await cmd({ command: 'pause' });
    assert.equal(await transaction(pool, (db) => claim(db, 'must-not-wake', first)), null);
    await cmd({ command: 'resume' });
    assert.equal(task.wait_reason, 'CLARIFICATION');
    assert.equal(task.status, 'WAITING');
    assert.equal(JSON.stringify(task.wait.questions), fixedQuestions);
    assert.equal(task.budget.model_calls, calls);
    await cmd({
      command: 'answer',
      question_id: q.id,
      option_id: q.options[0].id,
      attachment_ids: [attachmentId],
    });
    const batchRequest = {
      request_id: randomUUID(),
      revision: task.revision,
      command: 'complete_batch',
    };
    task = await transaction(pool, (db) => command(db, scope, task.id, batchRequest));
    const successor = task.active_run_id;
    task = await transaction(pool, (db) => command(db, scope, task.id, batchRequest));
    assert.equal(task.active_run_id, successor);
    assert.equal(
      (await pool.query('SELECT count(*)::int n FROM app.fsd_v1_run WHERE task_id=$1', [task.id]))
        .rows[0].n,
      2,
    );
    assert.notEqual(task.active_run_id, first);
    await run();
    assert.equal(task.wait_reason, 'PLAN_CONFIRM');
    const snapshot = (
      await pool.query('SELECT snapshot FROM app.fsd_v1_run WHERE id=$1', [task.active_run_id])
    ).rows[0].snapshot;
    assert.equal(snapshot.materials[0].extraction.regions[0].text, 'UNIQUE-ATTACHMENT-REQUIREMENT');
    await cmd({ command: 'confirm', ...task.wait, confirmed: true });
    await run();
    assert.equal(task.wait_reason, 'FSD_CONFIRM');
    await cmd({ command: 'confirm', ...task.wait, confirmed: true });
    await run();
    assert.equal(task.status, 'DELIVERED');
    assert.equal(task.confirmations.length, 2);
    assert.ok(task.delivered_artifact_id);
    const commits = (
      await pool.query('SELECT commit_key FROM app.fsd_v1_commit WHERE run_id=$1', [
        task.active_run_id,
      ])
    ).rows;
    assert.equal(new Set(commits.map((c) => c.commit_key)).size, commits.length);
  } finally {
    await pool.end();
  }
});
test('REC-03 confirmation before interrupt checkpoint fences old worker and preserves dispatch', async () => {
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
          text: 'ZPOC early confirmation',
          target: { target_ref: 'synthetic', client: '000' },
          mode: 'SYNTHETIC',
        },
        await assetManifest(),
      ),
    );
    const cmd = async (body) => {
      task = await transaction(pool, (db) =>
        command(db, scope, task.id, { request_id: randomUUID(), revision: task.revision, ...body }),
      );
    };
    const run = async (options) => {
      const lease = await transaction(pool, (db) => claim(db, 'early-test', task.active_run_id));
      assert.ok(lease);
      await executeRun(pool, lease, options);
      task = await loadTask(pool, scope, task.id);
    };
    await run();
    await cmd({
      command: 'answer',
      question_id: task.wait.questions[0].id,
      option_id: 'remaining',
    });
    await cmd({ command: 'complete_batch' });
    const runId = task.active_run_id;
    await run({
      onBoundary: async (point, detail) => {
        if (
          point === 'after_business_commit_before_checkpoint' &&
          detail.step_id.startsWith('N09:wait:')
        ) {
          task = await loadTask(pool, scope, task.id);
          await cmd({ command: 'confirm', ...task.wait, confirmed: true });
        }
      },
    });
    assert.equal(
      (await pool.query('SELECT status FROM app.fsd_v1_run WHERE id=$1', [runId])).rows[0].status,
      'QUEUED',
    );
    await run();
    assert.equal(task.active_run_id, runId);
    assert.equal(task.wait_reason, 'FSD_CONFIRM');
    assert.deepEqual(
      task.artifacts.map((a) => a.kind),
      ['PLAN', 'FSD'],
    );
    assert.equal(task.confirmations.length, 1);
  } finally {
    await pool.end();
  }
});
