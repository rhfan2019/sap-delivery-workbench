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
  stepCommit,
  reserve,
  settle,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
test('MODEL-05 takeover charges abandoned active execution but excludes downtime', async () => {
  const { pool, scope, t } = await setup();
  try {
    const first = await transaction(pool, (db) => claim(db, 'first', t.active_run_id));
    await pool.query(
      "UPDATE app.fsd_v1_run SET lease_until=clock_timestamp()-interval '30 seconds',state=jsonb_set(state,'{active_accounted_until}',to_jsonb((clock_timestamp()-interval '40 seconds')::text)) WHERE id=$1",
      [first.id],
    );
    const next = await transaction(pool, (db) => claim(db, 'next', first.id));
    assert.ok(next.state.budget.active_ms >= 9900 && next.state.budget.active_ms < 11000);
    assert.equal((await loadTask(pool, scope, t.id)).budget.active_ms, next.state.budget.active_ms);
  } finally {
    await pool.end();
  }
});
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
async function setup() {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  const scope = await transaction(pool, fixture);
  const t = await transaction(pool, async (db) =>
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
  return { pool, scope, t };
}
function barrier(n) {
  let count = 0,
    release;
  const gate = new Promise((r) => (release = r));
  return async () => {
    if (++count === n) release();
    await gate;
  };
}
test('STATE-03 explicit barrier competing claims produce exactly one writer', async () => {
  const { pool, t, scope } = await setup();
  try {
    for (let round = 0; round < 20; round++) {
      const task =
        round === 0
          ? t
          : await transaction(pool, async (db) =>
              createTask(
                db,
                scope,
                {
                  request_id: randomUUID(),
                  text: 'ZPOC barrier ' + round,
                  mode: 'SYNTHETIC',
                  target: { target_ref: 'synthetic', client: '000' },
                },
                await assetManifest(),
              ),
            );
      const gate = barrier(2);
      const results = await Promise.all(
        [1, 2].map(async (i) => {
          await gate();
          return transaction(pool, (db) => claim(db, 'worker-' + i, task.active_run_id));
        }),
      );
      assert.equal(results.filter(Boolean).length, 1);
    }
  } finally {
    await pool.end();
  }
});
test('REC-05 fenced takeover rejects old worker business AND checkpoint writes', async () => {
  const { pool, t } = await setup();
  try {
    const first = await transaction(pool, (db) => claim(db, 'first', t.active_run_id));
    await pool.query(
      "UPDATE app.fsd_v1_run SET lease_until=now()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    const second = await transaction(pool, (db) => claim(db, 'second', first.id));
    assert.ok(Number(second.generation) > Number(first.generation));
    await assert.rejects(
      () => transaction(pool, (db) => stepCommit(db, first, 'late', {}, () => ({}))),
      /LEASE_LOST/,
    );
    const { durableSaver } =
      await import('../../../../apps/api/src/modules/design-assistant/checkpointer.mjs');
    const saver = durableSaver(pool, first);
    await assert.rejects(
      () =>
        saver.putWrites(
          { configurable: { thread_id: first.thread_id, checkpoint_id: randomUUID() } },
          [['probe', 'late']],
          randomUUID(),
        ),
      /LEASE_LOST/,
    );
  } finally {
    await pool.end();
  }
});
test('OBS-07 audit failure rolls back earlier command writes', async () => {
  const { pool, scope, t } = await setup();
  try {
    await assert.rejects(
      () =>
        transaction(pool, async (db) => {
          await db.query(
            "CREATE FUNCTION pg_temp.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit storage failure'; END $$",
          );
          await db.query(
            'CREATE TRIGGER fsd_test_audit_failure BEFORE INSERT ON app.fsd_v1_event FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_audit()',
          );
          await command(db, scope, t.id, {
            request_id: randomUUID(),
            revision: t.revision,
            command: 'pause',
          });
        }),
      /injected audit/,
    );
    const after = await loadTask(pool, scope, t.id);
    assert.equal(after.status, 'ACTIVE');
    assert.equal(after.revision, 0);
  } finally {
    await pool.end();
  }
});
test('MODEL-04/05 shared reservations cannot double spend, unknown usage survives and settles once', async () => {
  const { pool, t } = await setup();
  try {
    const lease = await transaction(pool, (db) => claim(db, 'budget', t.active_run_id));
    const gate = barrier(2);
    const results = await Promise.all(
      [1, 2].map(async () => {
        await gate();
        return transaction(pool, (db) =>
          reserve(db, lease, 'same-operation-' + lease.id, 'model', 1000),
        );
      }),
    );
    assert.equal(results.length, 2);
    let state = (await pool.query('SELECT state FROM app.fsd_v1_run WHERE id=$1', [lease.id]))
      .rows[0].state;
    assert.equal(state.budget.model_calls, 1);
    assert.equal(state.budget.tokens, 1000);
    await transaction(pool, (db) =>
      settle(db, lease, 'same-operation-' + lease.id, null, {
        code: 'TIMEOUT',
        error_origin: 'MODEL',
      }),
    );
    state = (await pool.query('SELECT state FROM app.fsd_v1_run WHERE id=$1', [lease.id])).rows[0]
      .state;
    assert.equal(state.budget.tokens, 1000);
    await transaction(pool, (db) =>
      settle(db, lease, 'same-operation-' + lease.id, { valid: true }, null, { total_tokens: 200 }),
    );
    await transaction(pool, (db) =>
      settle(db, lease, 'same-operation-' + lease.id, { valid: true }, null, { total_tokens: 200 }),
    );
    state = (await pool.query('SELECT state FROM app.fsd_v1_run WHERE id=$1', [lease.id])).rows[0]
      .state;
    assert.equal(state.budget.tokens, 200);
  } finally {
    await pool.end();
  }
});
test('MODEL-05 two tasks retain independent unknown reservations across takeover and settle once', async () => {
  const a = await setup(),
    b = await setup();
  try {
    const leases = await Promise.all(
      [a, b].map((f) =>
        transaction(f.pool, (db) => claim(db, 'parallel-usage', f.t.active_run_id)),
      ),
    );
    const gate = barrier(2);
    await Promise.all(
      [a, b].map(async (f, i) => {
        await gate();
        await transaction(f.pool, (db) =>
          reserve(db, leases[i], 'usage-' + leases[i].id, 'model', 1000),
        );
        await transaction(f.pool, (db) =>
          settle(db, leases[i], 'usage-' + leases[i].id, null, {
            code: 'TIMEOUT',
            error_origin: 'MODEL',
          }),
        );
      }),
    );
    for (const [i, f] of [a, b].entries()) {
      await f.pool.query(
        "UPDATE app.fsd_v1_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [leases[i].id],
      );
      const next = await transaction(f.pool, (db) => claim(db, 'usage-recovery', leases[i].id));
      assert.equal(next.state.budget.tokens, 1000);
      await transaction(f.pool, (db) =>
        settle(db, next, 'usage-' + next.id, { ok: true }, null, { total_tokens: 200 + i }),
      );
      await transaction(f.pool, (db) =>
        settle(db, next, 'usage-' + next.id, { ok: true }, null, { total_tokens: 999 }),
      );
      const op = (
        await f.pool.query('SELECT reservation FROM app.fsd_v1_operation WHERE id=$1', [
          'usage-' + next.id,
        ])
      ).rows[0];
      assert.equal(op.reservation.tokens, 1000);
      assert.equal(op.reservation.actual_tokens, 200 + i);
      assert.equal(op.reservation.usage_known, true);
      assert.equal((await loadTask(f.pool, f.scope, f.t.id)).budget.tokens, 200 + i);
    }
  } finally {
    await a.pool.end();
    await b.pool.end();
  }
});
test('STATE-04 commit-first then pause retains artifact; restart cannot remove pause', async () => {
  const { pool, scope, t } = await setup();
  try {
    const lease = await transaction(pool, (db) => claim(db, 'worker', t.active_run_id));
    await transaction(pool, (db) =>
      stepCommit(db, lease, 'first', {}, (s) => {
        s.document = { kept: 'kept' };
        return { ok: true };
      }),
    );
    const before = await loadTask(pool, scope, t.id);
    await transaction(pool, (db) =>
      command(db, scope, t.id, {
        request_id: randomUUID(),
        revision: before.revision,
        command: 'pause',
      }),
    );
    assert.equal(await transaction(pool, (db) => claim(db, 'restarted', lease.id)), null);
    assert.equal((await loadTask(pool, scope, t.id)).document.kept, 'kept');
  } finally {
    await pool.end();
  }
});
