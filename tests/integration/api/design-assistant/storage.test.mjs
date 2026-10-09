import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, fixture } from '../../../fixtures/fs-workspace/database.mjs';
import {
  createTask,
  command,
  claim,
  stepCommit,
  loadTask,
} from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { DEFAULT_BUDGET } from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
import { randomUUID } from 'node:crypto';
const assets = { graph: 'fsd-1', schema: 1, prompt: '1', budget: DEFAULT_BUDGET };
test('STATE-01 identical requests reuse facts; changed payload is rejected', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const input = {
      request_id: randomUUID(),
      text: 'ZPOC report',
      target: { target_ref: 'synthetic', client: '000' },
      mode: 'SYNTHETIC',
    };
    const a = await createTask(db, scope, input, assets),
      b = await createTask(db, scope, input, assets);
    assert.equal(a.id, b.id);
    await assert.rejects(
      () => createTask(db, { ...scope, itemId: randomUUID() }, input, assets),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      () => createTask(db, scope, { ...input, text: 'changed' }, assets),
      /IDEMPOTENCY_CONFLICT/,
    );
  }));
test('STATE-01 idempotent command response is bound to project and item scope', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const t = await createTask(
      db,
      scope,
      {
        request_id: randomUUID(),
        text: 'ZPOC private A',
        target: { target_ref: 'synthetic', client: '000' },
        mode: 'SYNTHETIC',
      },
      assets,
    );
    const input = { request_id: randomUUID(), command: 'new_session', revision: t.revision };
    await command(db, scope, t.id, input);
    await assert.rejects(
      () => command(db, { ...scope, itemId: randomUUID() }, t.id, input),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      () => command(db, { ...scope, projectId: randomUUID() }, t.id, input),
      /IDEMPOTENCY_CONFLICT/,
    );
  }));
test('REC-02 / REC-05 duplicate commit reuses result, lost generation cannot write', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const task = await createTask(
      db,
      scope,
      {
        request_id: randomUUID(),
        text: 'ZPOC report',
        target: { target_ref: 'synthetic', client: '000' },
        mode: 'SYNTHETIC',
      },
      assets,
    );
    const lease = await claim(db, 'worker', task.active_run_id);
    const result = await stepCommit(db, lease, 'N01:0', { value: 1 }, (s) => {
      s.phase = 2;
      return { phase: 2 };
    });
    assert.equal(result.phase, 2);
    assert.equal(
      (
        await stepCommit(db, lease, 'N01:0', { value: 1 }, () => {
          throw Error('duplicate');
        })
      ).phase,
      2,
    );
    await assert.rejects(
      () =>
        stepCommit(
          db,
          { ...lease, generation: Number(lease.generation) - 1 },
          'N02:0',
          {},
          () => ({}),
        ),
      /LEASE_LOST/,
    );
    assert.equal((await loadTask(db, scope, task.id)).revision, 1);
  }));
test('STATE-04 pause wins against late commit, history is retained', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const task = await createTask(
      db,
      scope,
      {
        request_id: randomUUID(),
        text: 'ZPOC',
        target: { target_ref: 'synthetic', client: '000' },
        mode: 'SYNTHETIC',
      },
      assets,
    );
    const lease = await claim(db, 'worker', task.active_run_id);
    await command(db, scope, task.id, { request_id: randomUUID(), command: 'pause', revision: 0 });
    await assert.rejects(
      () => stepCommit(db, lease, 'N08', {}, () => ({})),
      /USER_PAUSED|LEASE_LOST/,
    );
    const t = await loadTask(db, scope, task.id);
    assert.equal(t.status, 'PAUSED');
    assert.equal(t.input.text, 'ZPOC');
  }));
