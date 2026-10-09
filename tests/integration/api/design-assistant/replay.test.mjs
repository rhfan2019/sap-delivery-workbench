import { fault } from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../../fixtures/fs-workspace/api.mjs';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { claim } from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { executeRun } from '../../../../apps/api/src/modules/design-assistant/worker.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
test('DBG-03 fixed replay uses recorded responses in a new thread with zero real model/SAP calls', async () => {
  const f = await apiFixture(),
    pool = new pg.Pool(databaseConfig());
  const base = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/work/design/fsd/v1`;
  const request = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    await setupCheckpoints(pool);
    const created = await request('POST', '/tasks', {
      request_id: randomUUID(),
      text: 'ZPOC fixed replay',
      mode: 'SYNTHETIC',
    });
    assert.equal(created.statusCode, 200);
    const source = created.json();
    let lease = await transaction(pool, (db) => claim(db, 'source', source.active_run_id));
    await assert.rejects(
      () =>
        executeRun(pool, lease, {
          onBoundary: async (point) => {
            if (point === 'after_interrupt') throw fault('PERSISTENCE_ERROR', 'CHECKPOINT');
          },
        }),
      /PERSISTENCE_ERROR/,
    );
    const original = (await request('GET', '/tasks/' + source.id)).json();
    const body = { request_id: randomUUID() },
      response = await request('POST', '/tasks/' + source.id + '/replay', body);
    assert.equal(response.statusCode, 200, response.body);
    const replay = response.json();
    assert.notEqual(replay.active_run_id, original.active_run_id);
    assert.equal(replay.publication_disabled, true);
    lease = await transaction(pool, (db) => claim(db, 'fixed-replay', replay.active_run_id));
    const oldThread = (
      await pool.query('SELECT thread_id FROM app.fsd_v1_run WHERE id=$1', [source.active_run_id])
    ).rows[0].thread_id;
    assert.notEqual(lease.thread_id, oldThread);
    let externalCalls = 0;
    await executeRun(pool, lease, {
      model: async () => {
        externalCalls++;
        throw Error('external model');
      },
      tool: async () => {
        externalCalls++;
        throw Error('external SAP');
      },
    });
    assert.equal(externalCalls, 0);
    const current = (await request('GET', '/tasks/' + replay.id)).json();
    assert.equal(current.wait_reason, 'CLARIFICATION');
    assert.equal(current.delivered_artifact_id, undefined);
    assert.ok(current.evidence.every((e) => e.replay_source_evidence_id));
    assert.deepEqual((await request('GET', '/tasks/' + source.id)).json(), original);
    assert.equal(
      (await request('POST', '/tasks/' + source.id + '/replay', body)).json().revision,
      current.revision,
    );
  } finally {
    await pool.end();
    await f.close();
  }
});
