import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import pg from 'pg';
import { databaseConfig } from '../../../apps/api/src/platform/database.mjs';
import { createServer } from 'vite';
import { apiFixture } from '../../fixtures/fs-workspace/api.mjs';
import { setupCheckpoints } from '../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../apps/api/src/modules/design-assistant/worker.mjs';
import { claim } from '../../../apps/api/src/modules/design-assistant/repository.mjs';
import { transaction } from '../../../apps/api/src/platform/auth.mjs';
import { createTelemetry } from '../../../apps/api/src/modules/design-assistant/telemetry.mjs';
const out = resolve('.runtime/artifacts/abap-backend-2026-10-08/browser');
await mkdir(out, { recursive: true });
process.env.FSD_OTLP_URL = 'http://127.0.0.1:4318/v1/traces';
const origin = 'http://127.0.0.1:5194',
  f = await apiFixture({ origin });
const pool = new pg.Pool(databaseConfig());
const telemetry = createTelemetry({ log: false });
let web, browser, stopWorker;
const errors = [];
try {
  await setupCheckpoints(pool);
  await f.app.listen({ host: '127.0.0.1', port: 3204 });
  // Other fault fixtures deliberately leave queued/expired work in the shared
  // isolated database. Dispatch this browser fixture only; never drain history.
  let stopping = false;
  const dispatch = (async () => {
    while (!stopping) {
      const row = (
        await pool.query(
          "SELECT state->>'active_run_id' AS run_id FROM app.fsd_v1_task WHERE item_id=$1 ORDER BY created_at DESC LIMIT 1",
          [f.scope.itemId],
        )
      ).rows[0];
      const lease = row?.run_id
        ? await transaction(pool, (db) => claim(db, 'browser-fixture', row.run_id))
        : null;
      if (lease) await executeRun(pool, lease, { telemetry });
      else await new Promise((r) => setTimeout(r, 100));
    }
  })();
  stopWorker = async () => {
    stopping = true;
    await dispatch;
  };
  web = await createServer({
    root: resolve('apps/web'),
    plugins: [
      {
        name: 'fsd-backend-test-harness-only',
        configureServer(server) {
          server.middlewares.use('/__fsd_backend_harness', async (_req, res) => {
            const html = await server.transformIndexHtml(
              '/__fsd_backend_harness',
              `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">
import { createApp } from '/node_modules/.vite/deps/vue.js';
import FsdWorkbench from '/src/features/item-workspace/FsdWorkbench.vue';
import '/src/features/item-workspace/workspace.css';
createApp(FsdWorkbench, { base: ${JSON.stringify(`/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/work/design`)}, editable: true }).mount('#app');
</script></body></html>`,
            );
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          });
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5194,
      strictPort: true,
      hmr: false,
      proxy: { '/api': 'http://127.0.0.1:3204' },
    },
  });
  await web.listen();
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.context().addCookies([
    {
      name: 'sapwb_local_session',
      value: f.headers.cookie.split('=')[1],
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(
    origin + `/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/design`,
  );
  await page.getByRole('heading', { name: '一起把需求说明白' }).waitFor();
  const composer = page.getByRole('textbox', { name: '输入消息', exact: true });
  await composer.fill('保留原有 Agent 对话界面');
  assert.equal(await composer.inputValue(), '保留原有 Agent 对话界面');
  assert.equal(await page.getByRole('button', { name: '开始设计', exact: true }).count(), 0);
  await page.getByRole('button', { name: '添加文件或图片', exact: true }).waitFor();
  await page.getByRole('button', { name: '选择模型', exact: true }).waitFor();
  await page.screenshot({ path: out + '/restored-agent-chat.png', fullPage: true });
  // The backend engineering harness must never replace the product's Agent conversation UI.
  await page.goto(origin + '/__fsd_backend_harness');
  await page
    .getByLabel('报表需求', { exact: true })
    .fill('ZPOC 合成未清订单报表，验证恢复及两道确认门');
  await page.getByRole('button', { name: '开始设计', exact: true }).click();
  await page.getByRole('radio').first().waitFor();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: '保存答案', exact: true }).click();
  await page.getByRole('button', { name: '提交完整回答批次', exact: true }).click();
  await page
    .getByRole('button', { name: '确认当前方案及范围', exact: true })
    .click({ timeout: 30000 });
  await page
    .getByRole('button', { name: '确认当前FSD及范围', exact: true })
    .click({ timeout: 30000 });
  await page.getByRole('status').filter({ hasText: 'DELIVERED' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: '运行诊断', exact: true }).click();
  await page.getByText('诊断时间线', { exact: true }).waitFor();
  await page.screenshot({ path: out + '/delivered.png', fullPage: true });
  const task = (
    await f.db.query(
      'SELECT id FROM app.fsd_v1_task WHERE item_id=$1 ORDER BY created_at DESC LIMIT 1',
      [f.scope.itemId],
    )
  ).rows[0];
  const base = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/work/design/fsd/v1/tasks/${task.id}`;
  const diag = (await f.app.inject({ url: base + '/diagnostics', headers: f.headers })).json();
  await writeFile(out + '/diagnostic.json', JSON.stringify(diag, null, 2));
  const delivered = (await f.app.inject({ url: base, headers: f.headers })).json();
  const docx = await f.app.inject({
    url: base + '/artifacts/' + delivered.delivered_artifact_id + '?format=docx',
    headers: f.headers,
  });
  assert.equal(docx.statusCode, 200);
  const zip = await JSZip.loadAsync(docx.rawPayload),
    xml = await zip.file('word/document.xml').async('string');
  for (const required of ['选择屏幕', '输出', 'REMAINING', '合成测试成果'])
    assert.ok(xml.includes(required));
  await writeFile(out + '/synthetic-fsd.docx', docx.rawPayload);
  const json = (
    await f.app.inject({
      url: base + '/artifacts/' + delivered.delivered_artifact_id,
      headers: f.headers,
    })
  ).json();
  assert.equal(Object.keys(json.objects).length, 8);
  await writeFile(out + '/synthetic-fsd.json', JSON.stringify(json, null, 2));
  assert.equal(
    (await f.app.inject({ url: base, headers: f.headers })).json().budget.model_calls,
    delivered.budget.model_calls,
  );
  const traces = [];
  const eventTraces = (
    await f.db.query(
      "SELECT DISTINCT data->'trace_context'->>'trace_id' AS trace_id FROM app.fsd_v1_event WHERE task_id=$1 AND data->'trace_context'->>'trace_id' IS NOT NULL",
      [task.id],
    )
  ).rows;
  for (const attempt of eventTraces) {
    let data;
    for (let n = 0; n < 30; n++) {
      data = await (await fetch('http://127.0.0.1:16686/api/traces/' + attempt.trace_id)).json();
      if (
        data.data?.[0]?.spans.some((s) =>
          ['worker.execution', 'api.command', 'artifact.export'].includes(s.operationName),
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(data.data?.length, 'trace must reach Jaeger');
    traces.push(...data.data);
  }
  assert.ok(traces.some((t) => t.spans.some((s) => s.operationName === 'business.commit')));
  assert.ok(traces.some((t) => t.spans.some((s) => s.operationName === 'checkpoint.persist')));
  for (const name of [
    'api.command',
    'artifact.export',
    'tool.attempt',
    'model.attempt',
    'graph.node.N11',
  ])
    assert.ok(
      traces.some((t) => t.spans.some((s) => s.operationName === name)),
      name,
    );
  for (const t of traces)
    for (const s of t.spans.filter((s) => s.operationName.startsWith('graph.node.')))
      assert.ok(s.references.some((r) => r.refType === 'CHILD_OF' && r.traceID === t.traceID));
  for (const attempt of diag.attempts) {
    const root = traces
      .find((t) => t.traceID === attempt.trace_id)
      ?.spans.find((s) => s.operationName === 'worker.execution');
    assert.ok(
      root?.references.some((r) => r.refType === 'FOLLOWS_FROM'),
      'outbox/recovery must link the causal trace',
    );
  }
  await writeFile(out + '/jaeger-traces.json', JSON.stringify(traces, null, 2));
  await page.goto('http://127.0.0.1:16686/trace/' + diag.attempts.at(-1).trace_id);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '/jaeger.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    out + '/result.json',
    JSON.stringify(
      {
        status: 'PASS',
        task_id: task.id,
        attempts: diag.attempts.map((a) => ({ id: a.id, trace_id: a.trace_id })),
        checks: [
          'browser two gates delivered',
          'diagnostic export',
          'OTel collector Jaeger persisted spans',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('FSD browser and actual OTel → Collector → Jaeger PASS: ' + out);
} finally {
  await browser?.close();
  await web?.close();
  await stopWorker?.();
  await telemetry.shutdown();
  await f.close();
  await pool.end();
}
