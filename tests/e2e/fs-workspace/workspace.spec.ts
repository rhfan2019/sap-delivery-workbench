import { test, expect } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../fixtures/fs-workspace/api.mjs';
import { syntheticPdf } from '../../fixtures/fs-workspace/pdf.mjs';
import pg from 'pg';
import { databaseConfig } from '../../../apps/api/src/platform/database.mjs';
import { claimRun } from '../../../apps/api/src/modules/fs-workspace/runs/queue.mjs';
import { runOne } from '../../../apps/api/src/modules/fs-workspace/runs/worker.mjs';

test('legacy URL redirects to design while isolated FS module supports real API editing and Chinese IME', async ({
  page,
  context,
}) => {
  const origin = 'http://127.0.0.1:5187';
  const oldFont = { file: process.env.FS_FONT_FILE, name: process.env.FS_FONT_NAME };
  process.env.FS_FONT_FILE = 'C:/Windows/Fonts/msyh.ttc';
  process.env.FS_FONT_NAME = 'Microsoft YaHei';
  const f = await apiFixture({ origin });
  const pool = new pg.Pool(databaseConfig({ runtime: true }));
  let web;
  try {
    await f.app.listen({ host: '127.0.0.1', port: 3197 });
    web = await createServer({
      root: fileURLToPath(new URL('../../../apps/web/', import.meta.url)),
      plugins: [{
        name: 'isolated-fs-module-test',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__fs-module/')) return next();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/@vite/client"></script><script type="module" src="/__fs-module-entry.js"></script></body></html>');
          });
        },
        resolveId(id) { if (id === '/__fs-module-entry.js') return '\0fs-module-entry'; },
        load(id) {
          if (id !== '\0fs-module-entry') return;
          return `import {createApp} from 'vue';
import {createRouter,createWebHistory,RouterView} from 'vue-router';
import View from '/src/features/fs-workspace/views/FsWorkspaceView.vue';
import {restoreSession} from '/src/services/session';
import '/src/assets/main.css';
const router=createRouter({history:createWebHistory(),routes:[{path:'/__fs-module/:projectId/:itemId',component:View},{path:'/workspace/development-items',component:{template:'<p>Test navigation target</p>'}}]});
await restoreSession();
const app=createApp(RouterView);app.use(router);await router.isReady();app.mount('#app');`;
        },
      }],
      server: {
        host: '127.0.0.1',
        port: 5187,
        strictPort: true,
        hmr: false,
        proxy: { '/api': 'http://127.0.0.1:3197' },
      },
    });
    await web.listen();
    await context.addCookies([
      {
        name: 'sapwb_local_session',
        value: f.headers.cookie.split('=')[1],
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(`${origin}/__fs-module/${f.scope.projectId}/${f.scope.itemId}`);
    await expect(page.getByRole('heading', { name: 'FS-I', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '修改此段' }).first().click();
    await page.getByLabel('修订内容').fill('人工编辑的中文段落');
    await page.getByRole('button', { name: '生成修改候选' }).click();
    await expect(page.getByRole('heading', { name: '审阅修改候选' })).toBeVisible();
    await page.getByRole('button', { name: '接受全部关联修改' }).click();
    await expect(page.getByText('人工编辑的中文段落', { exact: true })).toBeVisible();
    const composer = page.getByLabel('补充业务要求');
    await composer.fill('输入法尚未确认');
    await composer.dispatchEvent('compositionstart');
    await composer.press('Enter');
    await expect(page.getByText('业务输入', { exact: true })).toHaveCount(0);
    await composer.dispatchEvent('compositionend');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('业务输入', { exact: true })).toHaveCount(1);
    const active = (await f.request('GET')).json().data.active_runs.at(-1);
    await f.request('POST', `/runs/${active.id}/cancel`, {}, { 'idempotency-key': randomUUID() });
    await expect(page.getByText('任务：已取消', { exact: false })).toBeVisible();
    await page.getByText('附件与来源', { exact: true }).click();
    await page
      .getByLabel('选择业务材料')
      .setInputFiles({
        name: 'synthetic-business.pdf',
        mimeType: 'application/pdf',
        buffer: syntheticPdf(),
      });
    await page.getByRole('button', { name: '上传材料', exact: true }).click();
    await expect(page.getByText('synthetic-business.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText('待安全扫描', { exact: true })).toBeVisible();
    await page.getByText('导出固定版本', { exact: true }).click();
    await page.getByRole('button', { name: '导出 Word', exact: true }).click();
    await expect(page.getByText('文件已排队', { exact: true })).toBeVisible();
    const exportLease = await claimRun(pool, 'browser-export', f.scope.organizationId);
    expect((await runOne(pool, exportLease)).status).toBe('completed');
    await page.getByRole('button', { name: '刷新导出状态', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载 Word', exact: true }).click();
    await (await downloaded).saveAs('.runtime/artifacts/fs-workspace/export/browser-download.docx');
    await page.screenshot({ path: '.runtime/artifacts/fs-workspace/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '对话', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '对话', exact: true }).click();
    await expect(composer).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: '.runtime/artifacts/fs-workspace/mobile.png', fullPage: true });
    // The production design page takes ownership of the draft, so check its legacy redirect last.
    await page.goto(`${origin}/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/fs/workspace`);
    await expect(page).toHaveURL(`${origin}/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/design`);
  } finally {
    await web?.close();
    await pool.end();
    await f.close();
    if (oldFont.file === undefined) delete process.env.FS_FONT_FILE;
    else process.env.FS_FONT_FILE = oldFont.file;
    if (oldFont.name === undefined) delete process.env.FS_FONT_NAME;
    else process.env.FS_FONT_NAME = oldFont.name;
  }
});
