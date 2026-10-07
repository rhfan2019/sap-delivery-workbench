import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../fixtures/api.mjs';
import { appendRunEvent, readRunEvents } from '../../../apps/api/src/fs-workspace/runs/events.mjs';
test('event replay is scoped and never reexecutes a run', async () => {
  const f = await apiFixture();
  try {
    const run = (
      await f.db.query('SELECT * FROM app.fs_run WHERE workspace_id=$1', [f.workspace.id])
    ).rows[0];
    await f.db.query('BEGIN');
    const event = await appendRunEvent(f.db, run, 'run.completed', '历史导入完成');
    await f.db.query('COMMIT');
    assert.equal(event.sequence, 1);
    const scope = { ...f.scope, workspaceId: f.workspace.id };
    assert.equal((await readRunEvents(f.db, scope, run.id, '0')).length, 1);
    assert.equal((await readRunEvents(f.db, scope, run.id, '1')).length, 0);
    await assert.rejects(readRunEvents(f.db, scope, run.id, '2'), /游标/);
    const response = await f.request('GET', `/runs/${run.id}/events?after=0`);
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /id: 1/);
    const response2 = await f.request('GET', `/runs/${run.id}/events?after=1`);
    assert.equal(response2.statusCode, 200);
    assert.doesNotMatch(response2.body, /id: 1/);
    assert.equal(
      (
        await f.db.query('SELECT count(*)::int AS n FROM app.fs_run WHERE workspace_id=$1', [
          f.workspace.id,
        ])
      ).rows[0].n,
      1,
    );
  } finally {
    await f.close();
  }
});
