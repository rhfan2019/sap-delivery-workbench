import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../fixtures/api.mjs';
import { randomUUID } from 'node:crypto';
import { claimRun, expireExhaustedRuns } from '../../../apps/api/src/fs-workspace/runs/queue.mjs';

test('crashed workers exhaust retry budget and persist one terminal failure event', async () => {
  const f = await apiFixture();
  try {
    const created = await f.request(
      'POST',
      '/exports',
      { document_version_id: f.workspace.draft_head.id, format: 'docx' },
      { 'idempotency-key': randomUUID() },
    );
    assert.equal(created.statusCode, 202);
    let run;
    for (let attempt = 1; attempt <= 3; attempt++) {
      run = await claimRun(f.db, 'crashing-worker', f.scope.organizationId);
      assert.equal(run.attempt, attempt);
      await f.db.query(
        "UPDATE app.fs_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [run.id],
      );
    }
    assert.equal(await claimRun(f.db, 'fourth-worker', f.scope.organizationId), null);
    await f.db.query('BEGIN');
    await expireExhaustedRuns(f.db, f.scope.organizationId);
    await f.db.query('COMMIT');
    const row = (await f.db.query('SELECT * FROM app.fs_run WHERE id=$1', [run.id])).rows[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.budget_json.error_code, 'RETRY_BUDGET_EXHAUSTED');
    await f.db.query('BEGIN');
    await expireExhaustedRuns(f.db, f.scope.organizationId);
    await f.db.query('COMMIT');
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM app.fs_run_event WHERE run_id=$1 AND payload->>'event_type'='run.failed'",
          [run.id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await f.close();
  }
});
