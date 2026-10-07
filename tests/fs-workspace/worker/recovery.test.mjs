import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
import {
  claimRun,
  renewLease,
  cancelRun,
  assertLease,
} from '../../../apps/api/src/fs-workspace/runs/queue.mjs';
import { commitNode } from '../../../apps/api/src/fs-workspace/runs/checkpoints.mjs';
import { runOne } from '../../../apps/api/src/fs-workspace/runs/worker.mjs';
import pg from 'pg';
import { databaseConfig } from '../../../scripts/lib/database.mjs';

test('expired worker fencing and cancellation prevent stale commits', async () => {
  const f = await apiFixture();
  try {
    const {
      rows: [source],
    } = await f.db.query('SELECT * FROM app.fs_run WHERE workspace_id=$1', [f.workspace.id]);
    const id = randomUUID();
    await f.db.query(
      `INSERT INTO app.fs_run(id,organization_id,project_id,workspace_id,session_id,input_snapshot_id,principal_user_id,principal_session_id,intent,status,node_id,budget_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'parse','queued','scan','{"max_attempts":5}')`,
      [
        id,
        source.organization_id,
        source.project_id,
        source.workspace_id,
        source.session_id,
        source.input_snapshot_id,
        source.principal_user_id,
        source.principal_session_id,
      ],
    );
    const first = await claimRun(f.db, 'worker-a', f.scope.organizationId);
    assert.equal(first.id, id);
    assert.equal(await claimRun(f.db, 'worker-b', f.scope.organizationId), null);
    assert.equal(await renewLease(f.db, first), true);
    await f.db.query("UPDATE app.fs_run SET lease_until=now()-interval '1 second' WHERE id=$1", [
      id,
    ]);
    const second = await claimRun(f.db, 'worker-b', f.scope.organizationId);
    assert.equal(BigInt(second.fencing), BigInt(first.fencing) + 1n);
    await assert.rejects(assertLease(f.db, first), /租约/);
    assert.equal(await renewLease(f.db, first), false);
    await f.db.query('BEGIN');
    await commitNode(f.db, second, {
      inputHash: 'synthetic',
      outputRefs: [],
      configVersions: {},
      nextStatus: 'completed',
    });
    await f.db.query('COMMIT');
    assert.equal(
      (
        await f.db.query('SELECT count(*)::int AS n FROM app.fs_run_checkpoint WHERE run_id=$1', [
          id,
        ])
      ).rows[0].n,
      1,
    );
    await f.db.query("UPDATE app.fs_run SET status='queued' WHERE id=$1", [id]);
    const replayLease = await claimRun(f.db, 'replay-worker', f.scope.organizationId);
    await f.db.query('BEGIN');
    const replay = await commitNode(
      f.db,
      replayLease,
      {
        inputHash: 'synthetic',
        outputRefs: [],
        configVersions: {},
        nextStatus: 'completed',
      },
      () => {
        throw new Error('checkpoint effect must not repeat');
      },
    );
    await f.db.query('COMMIT');
    assert.equal(replay.reused, true);
    await f.db.query("UPDATE app.fs_run SET status='queued' WHERE id=$1", [id]);
    const changedConfigLease = await claimRun(f.db, 'new-config-worker', f.scope.organizationId);
    let executed = false;
    await f.db.query('BEGIN');
    const changedConfig = await commitNode(
      f.db,
      changedConfigLease,
      {
        inputHash: 'synthetic',
        outputRefs: [],
        configVersions: { renderer: '2' },
        nextStatus: 'completed',
      },
      async () => {
        executed = true;
      },
    );
    await f.db.query('COMMIT');
    assert.equal(changedConfig.reused, false);
    assert.equal(executed, true);
    await f.db.query("UPDATE app.fs_run SET status='queued' WHERE id=$1", [id]);
    const third = await claimRun(f.db, 'worker-c', f.scope.organizationId);
    await f.db.query('UPDATE app.auth_session SET revoked_at=now() WHERE id=$1', [
      f.scope.sessionId,
    ]);
    await f.db.query('BEGIN');
    const denied = await commitNode(f.db, third, {
      inputHash: 'synthetic-2',
      outputRefs: [],
      configVersions: {},
      nextStatus: 'completed',
    });
    await f.db.query('COMMIT');
    assert.equal(denied.status, 'waiting_user');
    assert.equal(
      (
        await f.db.query('SELECT count(*)::int AS n FROM app.fs_run_checkpoint WHERE run_id=$1', [
          id,
        ])
      ).rows[0].n,
      2,
    );
    const scope = { ...f.scope, workspaceId: f.workspace.id };
    await cancelRun(f.db, scope, id);
    await assert.rejects(assertLease(f.db, second), /租约/);
    assert.equal(
      (await f.db.query('SELECT status FROM app.fs_run WHERE id=$1', [id])).rows[0].status,
      'cancelled',
    );
  } finally {
    await f.close();
  }
});

test('production worker reports missing scanner as waiting evidence without parsing', async () => {
  const f = await apiFixture(),
    pool = new pg.Pool(databaseConfig({ runtime: true }));
  try {
    const source = (
      await f.db.query('SELECT * FROM app.fs_run WHERE workspace_id=$1', [f.workspace.id])
    ).rows[0];
    const attachmentId = randomUUID();
    await f.db.query(
      "INSERT INTO app.fs_attachment(id,organization_id,project_id,workspace_id,client_upload_id,blob_key,hash,size,mime,name,scan_status,created_by) VALUES($1,$2,$3,$4,$5,$1::uuid::text,'not-a-real-hash',10,'application/pdf','synthetic.pdf','quarantined',$6)",
      [
        attachmentId,
        source.organization_id,
        source.project_id,
        source.workspace_id,
        randomUUID(),
        source.principal_user_id,
      ],
    );
    const id = randomUUID();
    await f.db.query(
      `INSERT INTO app.fs_run(id,organization_id,project_id,workspace_id,session_id,input_snapshot_id,principal_user_id,principal_session_id,intent,status,node_id,budget_json,is_write)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'attachment_parse','queued','scan_parse',$9,false)`,
      [
        id,
        source.organization_id,
        source.project_id,
        source.workspace_id,
        source.session_id,
        source.input_snapshot_id,
        source.principal_user_id,
        source.principal_session_id,
        { attachment_id: attachmentId, attachment_hash: 'not-a-real-hash' },
      ],
    );
    const lease = await claimRun(pool, 'scanner-worker', source.organization_id);
    const outcome = await runOne(pool, lease, { scannerExecutable: null });
    assert.equal(outcome.status, 'waiting_evidence');
    const row = (await f.db.query('SELECT * FROM app.fs_run WHERE id=$1', [id])).rows[0];
    assert.equal(row.budget_json.error_code, 'SCANNER_UNAVAILABLE');
    assert.equal(
      (
        await f.db.query(
          'SELECT count(*)::int AS n FROM app.fs_parse_result WHERE attachment_id=$1',
          [attachmentId],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await pool.end();
    await f.close();
  }
});
