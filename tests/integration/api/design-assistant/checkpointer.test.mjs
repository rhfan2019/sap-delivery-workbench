import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StateGraph, Annotation, START, END, interrupt, Command } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { databaseConfig } from '../../../../apps/api/src/platform/database.mjs';
import { assertIsolatedDatabase } from '../../../../scripts/testing/run-tests.mjs';
import { setupCheckpoints } from '../../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { randomUUID } from 'node:crypto';
test('G0 real PostgreSQL saver ACK and interrupt can resume using a new saver instance', async () => {
  assertIsolatedDatabase(process.env);
  const pool = new pg.Pool(databaseConfig());
  try {
    await setupCheckpoints(pool);
    const state = Annotation.Root({ value: Annotation() });
    const build = (saver) =>
      new StateGraph(state)
        .addNode('wait', () => ({ value: interrupt({ kind: 'confirm' }) }))
        .addEdge(START, 'wait')
        .addEdge('wait', END)
        .compile({ checkpointer: saver });
    const config = { configurable: { thread_id: randomUUID() }, durability: 'sync' };
    const saver = new PostgresSaver(pool, undefined, { schema: 'fsd_checkpoint' });
    await build(saver).invoke({ value: 'before' }, config);
    const tuple = await saver.getTuple(config);
    assert.ok(tuple.checkpoint.id);
    const restarted = new PostgresSaver(pool, undefined, { schema: 'fsd_checkpoint' });
    const result = await build(restarted).invoke(new Command({ resume: 'confirmed' }), config);
    assert.equal(result.value, 'confirmed');
    assert.notEqual((await restarted.getTuple(config)).checkpoint.id, tuple.checkpoint.id);
  } finally {
    await pool.end();
  }
});
