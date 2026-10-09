import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import pg from 'pg';
import { apiFixture } from '../../fixtures/fs-workspace/api.mjs';
import { databaseConfig } from '../../../apps/api/src/platform/database.mjs';
import { transaction } from '../../../apps/api/src/platform/auth.mjs';
import { saveModel } from '../../../apps/api/src/modules/models/store.mjs';
import { setupCheckpoints } from '../../../apps/api/src/modules/design-assistant/checkpointer.mjs';
import { executeRun } from '../../../apps/api/src/modules/design-assistant/worker.mjs';
import { claim } from '../../../apps/api/src/modules/design-assistant/repository.mjs';
import { createTelemetry } from '../../../apps/api/src/modules/design-assistant/telemetry.mjs';
import { startChatTurn } from '../../../apps/api/src/modules/design-assistant/chat-service.mjs';
import { assetManifest } from '../../../apps/api/src/modules/design-assistant/assets.mjs';
import {
  syntheticModel,
  syntheticTool,
} from '../../../apps/api/src/modules/design-assistant/simulation.mjs';

process.env.LLM_CREDENTIAL_KEY = 'b'.repeat(64);
process.env.FSD_REAL_INPUT_APPROVED = 'true';
const out = resolve('.runtime/artifacts/langgraph-chat-2026-10-09');
await mkdir(out, { recursive: true });
const origin = 'http://127.0.0.1:5196';
const f = await apiFixture({ origin });
const pool = new pg.Pool(databaseConfig());
const telemetry = createTelemetry({ log: false });
const contexts = [],
  errors = [],
  checks = [];
let browser,
  web,
  dispatch,
  stopping = false,
  release;
try {
  const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
    name: 'Synthetic browser chat',
    provider: 'Synthetic',
    protocol: 'openai_chat',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'test',
    apiKey: 'synthetic-not-live',
    maxOutputTokens: 1000,
    temperature: null,
    timeoutSeconds: 60,
  });
  await setupCheckpoints(pool);
  await f.app.listen({ host: '127.0.0.1', port: 3206 });
  const streamModel = async ({ context, signal, onDelta }) => {
    contexts.push(structuredClone(context.r.snapshot));
    const n = contexts.length;
    const first =
      n === 1
        ? '第一轮流式片段'
        : n === 2
          ? '第二轮基于历史回答'
          : n === 3
            ? '停止前保留片段'
            : '已读取合成附件';
    await onDelta(first);
    await new Promise((r) => {
      release = r;
    });
    signal.throwIfAborted();
    const last = n === 3 ? '禁止出现的晚到文本' : '，已完成。';
    await onDelta(last);
    return { text: first + last, usage: { input_tokens: 10, output_tokens: 10 } };
  };
  dispatch = (async () => {
    while (!stopping) {
      const rows = (
        await pool.query(
          "SELECT r.id FROM app.fsd_v1_run r JOIN app.fsd_v1_task t ON t.id=r.task_id WHERE t.item_id=$1 AND r.status='QUEUED' ORDER BY r.created_at",
          [f.scope.itemId],
        )
      ).rows;
      const lease = rows[0]
        ? await transaction(pool, (db) => claim(db, 'original-chat-browser', rows[0].id))
        : null;
      if (lease)
        await executeRun(pool, lease, {
          telemetry,
          streamModel,
          model: syntheticModel,
          tool: syntheticTool,
        });
      else await delay(100);
    }
  })();
  web = await createServer({
    root: resolve('apps/web'),
    server: {
      host: '127.0.0.1',
      port: 5196,
      strictPort: true,
      hmr: false,
      proxy: { '/api': 'http://127.0.0.1:3206' },
    },
  });
  await web.listen();
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.url().includes('/api/'))
      errors.push(`${r.status()} ${r.url()} ${await r.text()}`);
  });
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
  const composer = page.getByRole('textbox', { name: '输入消息', exact: true });
  await composer.waitFor();
  const send = async (text) => {
    await composer.fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
  };
  await send('第一轮用户需求：采购订单分析');
  await page.getByText('第一轮流式片段', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).count(), 1);
  await page.screenshot({ path: out + '/original-chat-streaming.png', fullPage: true });
  checks.push('original AgentWorkbench shows delta before provider completion');
  await page.reload();
  await page.getByText('第一轮流式片段', { exact: false }).waitFor();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor();
  assert.equal(contexts.length, 1);
  checks.push('page reload reconnects active durable stream without another provider call');
  release();
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  await send('第二轮用户追问：沿用之前范围');
  await page.getByText('第二轮基于历史回答', { exact: false }).waitFor();
  assert.ok(JSON.stringify(contexts[1]).includes('第一轮用户需求'));
  assert.ok(JSON.stringify(contexts[1]).includes('第一轮流式片段，已完成。'));
  checks.push('second provider snapshot includes first user and assistant');
  release();
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  await send('第三轮测试停止');
  await page.getByText('停止前保留片段', { exact: false }).waitFor();
  const cancelled = page.waitForResponse(
    (r) => r.url().endsWith('/cancel') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  assert.equal((await cancelled).status(), 200);
  release();
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  await page.reload();
  await page.getByText('停止前保留片段', { exact: false }).waitFor();
  assert.equal(await page.getByText('禁止出现的晚到文本', { exact: false }).count(), 0);
  await page.getByText('第一轮流式片段，已完成。', { exact: false }).waitFor();
  checks.push('stop preserves partial without late text; reload restores history');
  await page.screenshot({ path: out + '/original-chat-restored.png', fullPage: true });
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith('/attachments') && r.request().method() === 'POST',
  );
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'synthetic-requirement.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('合成采购订单需求附件，不含真实数据。'),
    });
  await page.getByText('synthetic-requirement.txt', { exact: false }).first().waitFor();
  await send('请参考上传的合成附件');
  assert.ok((await uploaded).ok());
  await page.getByText('已读取合成附件', { exact: false }).waitFor();
  assert.ok(JSON.stringify(contexts[3]).includes('合成采购订单需求附件'));
  release();
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  await page.getByText('synthetic-requirement.txt', { exact: false }).first().waitFor();
  checks.push('original attachment input uploads text material');
  const assets = await assetManifest();
  await transaction(pool, (db) =>
    startChatTurn(
      db,
      f.scope,
      {
        requestId: randomUUID(),
        modelId: model.id,
        prompt: '生成 ZPOC 未清订单报表功能说明书',
        action: 'draft',
        selection: {
          projectId: f.scope.projectId,
          itemId: f.scope.itemId,
          workspaceStage: 'design',
        },
      },
      assets,
      { target_ref: 'synthetic', client: '000', allowed_urls: [] },
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: '打开资料面板', exact: true }).click();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.locator('.work-session-row').filter({ hasText: '生成 ZPOC' }).click();
  await page.getByRole('radio').first().waitFor();
  for (const field of await page.locator('.decision-card fieldset').all())
    await field.getByRole('radio').first().check();
  await page.getByRole('button', { name: '确认并继续', exact: true }).click();
  await page.getByRole('button', { name: /审阅当前 v/ }).click();
  await page.getByRole('button', { name: /确认初稿 v/ }).click();
  checks.push('original DecisionCard clarification and WorkflowPanel initial approval');
  await page.getByRole('button', { name: '生成终稿', exact: true }).click();
  await page.getByRole('button', { name: /确认终稿 v/ }).waitFor();
  await page.getByRole('button', { name: /审阅当前 v/ }).click();
  await page.getByRole('button', { name: /确认终稿 v/ }).click();
  await page.getByText('终稿已确认。需要调整时，请先选择「提出修改」。', { exact: true }).waitFor();
  checks.push('original WorkflowPanel explicit final generation and final approval');
  await page.screenshot({ path: out + '/original-chat-delivered.png', fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    out + '/original-chat-result.json',
    JSON.stringify({ status: 'PASS', checks, contexts, errors }, null, 2),
  );
  console.log(JSON.stringify({ status: 'PASS', checks }));
} catch (error) {
  if (browser?.contexts()[0]?.pages()[0]) {
    const failed = browser.contexts()[0].pages()[0];
    await failed.screenshot({ path: out + '/original-chat-failure.png', fullPage: true });
    await writeFile(out + '/original-chat-failure.txt', await failed.locator('body').innerText());
  }
  await writeFile(
    out + '/original-chat-task-states.json',
    JSON.stringify(
      (await pool.query('SELECT state FROM app.fsd_v1_task WHERE item_id=$1', [f.scope.itemId]))
        .rows,
      null,
      2,
    ),
  );
  await writeFile(
    out + '/original-chat-result.json',
    JSON.stringify({ status: 'FAIL', checks, errors, error: error.stack }, null, 2),
  );
  throw error;
} finally {
  stopping = true;
  release?.();
  await browser?.close();
  await web?.close();
  await dispatch;
  await telemetry.shutdown();
  await f.close();
  await pool.end();
}
