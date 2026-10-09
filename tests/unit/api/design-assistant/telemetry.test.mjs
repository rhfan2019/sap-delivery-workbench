import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphInterrupt } from '@langchain/langgraph';
import {
  BoundedExporter,
  safeAttributes,
  createTelemetry,
} from '../../../../apps/api/src/modules/design-assistant/telemetry.mjs';
test('OBS-01 durable human interrupt is WAITING, not an operation failure', async () => {
  const spans = [],
    telemetry = createTelemetry({
      log: false,
      spanExporter: {
        export: (batch, done) => {
          spans.push(...batch);
          done({ code: 0 });
        },
        shutdown: async () => {},
      },
    });
  try {
    await assert.rejects(() =>
      telemetry.span('graph.node.N10', {}, async () => {
        throw new GraphInterrupt([]);
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(spans[0].attributes.status, 'WAITING');
    assert.notEqual(spans[0].status.code, 2);
    assert.equal(JSON.stringify(telemetry.metrics()).includes('operation_failures_total'), false);
  } finally {
    await telemetry.shutdown();
  }
});
test('OBS-06 default exporter capacity is exactly bounded at 1000 spans', async () => {
  const ex = new BoundedExporter({ export: () => {}, shutdown: async () => {} }, { timeoutMs: 1 });
  for (let i = 0; i < 1200; i++) ex.export([{ name: 'synthetic' }], () => {});
  assert.equal(ex.size, 1000);
  assert.equal(ex.metrics.dropped_total, 200);
  await ex.shutdown();
});
test('OBS-04 exception metadata cannot become diagnostic metric labels', async () => {
  const telemetry = createTelemetry({ log: false });
  await assert.rejects(() =>
    telemetry.span('test', {}, async () => {
      throw Object.assign(Error('SECRET'), { code: 'SECRET', error_origin: 'SECRET provider' });
    }),
  );
  assert.equal(JSON.stringify(telemetry.metrics()).includes('SECRET'), false);
  await telemetry.shutdown();
});
test('OBS-04 arbitrary bodies, metadata, headers and errors never enter safe attributes', () => {
  const result = safeAttributes({
    task_id: '00000000-0000-4000-8000-000000000001',
    body: 'SECRET',
    headers: { authorization: 'SECRET' },
    stack: 'SECRET',
    metadata: 'SECRET',
    error_code: 'TIMEOUT',
  });
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(result.error_code, 'TIMEOUT');
});
test('OBS-05/06 exporter is bounded while backend hangs and reports drops', async () => {
  const ex = new BoundedExporter(
    { export: () => {}, shutdown: async () => {} },
    { capacity: 3, timeoutMs: 10 },
  );
  for (let i = 0; i < 12; i++) ex.export([{ name: 'synthetic' }], () => {});
  assert.ok(ex.metrics.dropped_total >= 8);
  assert.ok(ex.size <= 3);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(ex.metrics.failed_total > 0);
  await ex.shutdown();
});
