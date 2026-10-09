import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
import { databaseConfig } from '../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../apps/api/src/platform/auth.mjs';
import { fixture } from '../../fixtures/fs-workspace/database.mjs';
import { assertIsolatedDatabase } from '../../../scripts/testing/run-tests.mjs';
import {
  createTask,
  claim,
  loadTask,
  command,
} from '../../../apps/api/src/modules/design-assistant/repository.mjs';
import { assetManifest } from '../../../apps/api/src/modules/design-assistant/assets.mjs';
import { executeRun } from '../../../apps/api/src/modules/design-assistant/worker.mjs';
import { createTelemetry } from '../../../apps/api/src/modules/design-assistant/telemetry.mjs';
import { diagnostics } from '../../../apps/api/src/modules/design-assistant/routes.mjs';
import { setupCheckpoints } from '../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
assertIsolatedDatabase(process.env);
const pool = new pg.Pool(databaseConfig()),
  out = resolve('.runtime/artifacts/abap-backend-2026-10-08/diagnosis');
await mkdir(out, { recursive: true });
const telemetry = createTelemetry({ url: 'http://127.0.0.1:4318/v1/traces', log: true });
let browser;
try {
  await setupCheckpoints(pool);
  const scope = await transaction(pool, fixture);
  let task = await transaction(pool, async (db) =>
    createTask(
      db,
      scope,
      {
        request_id: randomUUID(),
        text: 'ZPOC diagnostic failure',
        mode: 'SYNTHETIC',
        target: { target_ref: 'synthetic', client: '000' },
      },
      await assetManifest(),
    ),
  );
  let lease = await transaction(pool, (db) => claim(db, 'diagnostic-fault', task.active_run_id));
  await assert.rejects(
    () =>
      executeRun(pool, lease, {
        telemetry,
        model: async () => ({
          output: { kind: 'AnalysisResult', goto: 'DELIVERED', secret: 'SYNTHETIC-LEAK-MARKER' },
        }),
      }),
    /INVALID_OUTPUT/,
  );
  task = await loadTask(pool, scope, task.id);
  const before = await diagnostics(pool, task, telemetry.metrics());
  assert.equal(before.runs[0].error.error_origin, 'OUTPUT_VALIDATION');
  assert.equal(JSON.stringify(before).includes('SYNTHETIC-LEAK-MARKER'), false);
  await writeFile(out + '/failure-diagnostic.json', JSON.stringify(before, null, 2));
  const traceId = before.attempts[0].trace_id;
  let trace;
  for (let i = 0; i < 30; i++) {
    trace = await (await fetch('http://127.0.0.1:16686/api/traces/' + traceId)).json();
    if (
      trace.data?.[0]?.spans.some(
        (s) =>
          s.operationName === 'output.validate' &&
          s.tags.some((t) => t.key === 'error_code' && t.value === 'INVALID_OUTPUT'),
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(
    trace.data?.[0]?.spans.some(
      (s) =>
        s.operationName === 'output.validate' &&
        s.tags.some((t) => t.key === 'error_code' && t.value === 'INVALID_OUTPUT'),
    ),
  );
  await writeFile(out + '/failure-trace.json', JSON.stringify(trace, null, 2));
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto('http://127.0.0.1:16686/trace/' + traceId);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '/failure-trace.png', fullPage: true });
  const original = task.active_run_id;
  task = await transaction(pool, (db) =>
    command(db, scope, task.id, {
      request_id: randomUUID(),
      revision: task.revision,
      command: 'supplement',
      text: '修正合成输入：明确未清订单口径需要澄清',
    }),
  );
  lease = await transaction(pool, (db) => claim(db, 'diagnostic-successor', task.active_run_id));
  await executeRun(pool, lease, { telemetry });
  task = await loadTask(pool, scope, task.id);
  assert.notEqual(task.active_run_id, original);
  assert.equal(task.wait_reason, 'CLARIFICATION');
  const after = await diagnostics(pool, task, telemetry.metrics());
  await writeFile(out + '/successor-diagnostic.json', JSON.stringify(after, null, 2));
  await writeFile(
    out + '/result.json',
    JSON.stringify(
      {
        status: 'PASS',
        task_id: task.id,
        failed_run_id: original,
        trace_id: traceId,
        successor_run_id: task.active_run_id,
        root_cause: 'Model output violated closed schema; exactly one repair also failed',
        action:
          'Explicit new input creates successor with preserved failed run and original thread; no reset/deletion',
        checkpoint: before.runs[0].checkpoint_id,
        diagnostic_hash: before.sha256,
      },
      null,
      2,
    ),
  );
  console.log('Failure → output.validate → diagnostic → explicit successor verified');
} finally {
  await browser?.close();
  await telemetry.shutdown();
  await pool.end();
}
