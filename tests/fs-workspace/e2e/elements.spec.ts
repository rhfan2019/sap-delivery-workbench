import { test, expect } from '@playwright/test';
import { createServer as createVite } from 'vite';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:5188';
const requests: any[] = [];
const runs = new Map<string, any>();
let count = 0,
  web: any,
  backend: any;
const decision = {
  id: 'decision-1',
  kind: 'business',
  message: '确认采购范围后继续',
  questions: [
    {
      id: 'scope',
      title: '采购范围',
      allowText: true,
      options: [
        { value: 'all', label: '全部采购', description: '纳入所有采购组织', recommended: true },
      ],
    },
  ],
};
const artifact = {
  id: 'artifact-1',
  revision: 2,
  contentHash: 'hash-2',
  spec: { kind: 'report' },
  markdown: "# 采购功能说明书\n\n## 业务范围\n\n已确认采购组织。\n\n```abap\nWRITE: / 'SAP'.\n```",
};
test.beforeAll(async () => {
  backend = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = req.url!;
    const json = (data: any, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (url.endsWith('/models'))
      return json({
        items: [
          { id: 'model-a', name: '模型 Alpha', rowVersion: '1' },
          { id: 'model-b', name: '模型 Beta', rowVersion: '2' },
        ],
        defaultModel: { id: 'model-a' },
      });
    if (url.endsWith('/conversations') && req.method === 'POST') {
      requests.push({ kind: 'conversation', ...JSON.parse(raw) });
      return json({ conversationId: 'conversation-1' });
    }
    if (url.endsWith('/workflow'))
      return json({
        phase: 'analysis',
        version: '1',
        activeRevisionId: null,
        activeArtifact: null,
        revisions: [],
      });
    if (url.endsWith('/attachments') && req.method === 'POST') {
      requests.push({ kind: 'upload' });
      return json({ id: 'remote-file-1', state: 'ready', extraction: { warnings: [] } });
    }
    if (url.includes('/attachments/') && req.method === 'DELETE') {
      requests.push({ kind: 'remove' });
      return json({});
    }
    if (url.endsWith('/runs') && req.method === 'POST') {
      const data = JSON.parse(raw);
      requests.push({ kind: 'run', ...data });
      const id = 'run-' + ++count;
      const run = {
        id,
        data,
        state: 'running',
        seq: 0,
        response: null,
        content: '',
        createdAt: new Date().toISOString(),
      };
      runs.set(id, run);
      return json({
        runId: id,
        createdAt: run.createdAt,
        serverTime: new Date().toISOString(),
        conversationId: data.conversationId ?? 'conversation-1',
        action: data.prompt.includes('生成') || data.decisionAnswer ? 'draft' : 'dialogue',
        plan: {
          steps: [
            {
              stepId: 'analyze',
              label: '分析采购需求',
              status: 'running',
              attempt: 1,
              summary: '',
              startedAt: null,
              finishedAt: null,
            },
          ],
        },
      });
    }
    const match = url.match(/\/runs\/(run-\d+)(?:\/(events|cancel))?$/);
    if (match) {
      const run = runs.get(match[1]);
      if (!run) return json({}, 404);
      const send = (type: string, data: any = {}) =>
        run.response?.write(
          `data: ${JSON.stringify({ runId: run.id, seq: ++run.seq, type, data })}\n\n`,
        );
      if (match[2] === 'cancel') {
        requests.push({ kind: 'cancel' });
        run.state = 'cancelled';
        run.finishedAt = new Date().toISOString();
        send('run.cancelled');
        run.response?.end();
        return json({ status: 'cancelled' });
      }
      if (match[2] === 'events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.flushHeaders();
        run.response = res;
        if (run.state === 'cancelled') {
          send('run.cancelled');
          return res.end();
        }
        if (run.data.prompt.includes('取消')) {
          run.content = run.data.prompt.includes('长文')
            ? Array.from({ length: 90 }, (_, i) => `第 ${i + 1} 段采购说明。`).join('\n\n')
            : '这段内容应保留';
          send('message.delta', { text: run.content });
          return;
        }
        if (run.data.prompt.includes('失败')) {
          setTimeout(() => {
            run.state = 'failed';
            send('run.failed', { message: '模拟服务失败' });
            res.end();
          }, 600);
          return;
        }
        if (run.data.prompt.includes('确认') && !run.data.decisionAnswer) {
          run.state = 'waiting_user';
          send('run.waiting_user', { decision });
          return res.end();
        }
        if (run.data.prompt.includes('生成') || run.data.decisionAnswer) {
          run.artifact = artifact;
          send('artifact.ready', artifact);
        }
        run.content =
          '# 分析结果\n\n采购组织已关联。\n\n| 字段 | 含义 |\n| --- | --- |\n| EKORG | 采购组织 |\n\n```abap\nWRITE: / \'SAP\'.\n```\n\n<img src=x onerror="window.__unsafe=true"><script>window.__unsafe=true</script>\n\n[危险链接](javascript:alert(1))';
        send('message.delta', { text: run.content.slice(0, 30) });
        setTimeout(() => {
          send('message.delta', { text: run.content.slice(30) });
          send('step.updated', {
            stepId: 'analyze',
            label: '分析采购需求',
            status: 'succeeded',
            attempt: 1,
            summary: '已核对开发项',
            startedAt: null,
            finishedAt: null,
          });
          run.state = 'completed';
          send('run.completed');
          res.end();
        }, 200);
        return;
      }
      return json({
        runId: run.id,
        state: run.state,
        conversationId: 'conversation-1',
        snapshot: {
          input: {
            modelId: 'model-a',
            modelRowVersion: '1',
            selection: run.data.selection,
            action: 'auto',
          },
          prompt: run.data.prompt,
          decision: run.state === 'waiting_user' ? decision : null,
          plan: { steps: [] },
        },
        artifact: run.artifact,
        history: [
          {
            id: run.id + '-u',
            role: 'user',
            content: run.data.prompt,
            status: 'completed',
            authorName: '测试顾问',
            createdAt: run.createdAt,
          },
          {
            id: run.id + '-a',
            role: 'assistant',
            content: run.content,
            runId: run.id,
            createdAt: run.createdAt,
            finishedAt: run.finishedAt,
            status: run.state,
            action: run.artifact ? 'draft' : 'dialogue',
            error: run.state === 'failed' ? '模拟服务失败' : undefined,
            artifact: run.artifact,
            decision: run.state === 'waiting_user' ? decision : undefined,
          },
        ],
      });
    }
    json({ items: [] });
  });
  await new Promise<void>((resolve) => backend.listen(3198, '127.0.0.1', resolve));
  web = await createVite({
    root: fileURLToPath(new URL('../../../apps/web', import.meta.url)),
    server: {
      host: '127.0.0.1',
      port: 5188,
      strictPort: true,
      hmr: false,
      proxy: { '/api': 'http://127.0.0.1:3198' },
    },
    plugins: [
      {
        name: 'elements-test-harness',
        configureServer(server) {
          server.middlewares.use('/__elements', (_req, res) => {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__elements-entry.js"></script></body></html>',
            );
          });
        },
        resolveId(id) {
          if (id === '/__elements-entry.js') return id;
        },
        load(id) {
          if (id === '/__elements-entry.js')
            return `
    import { createApp, h, ref } from 'vue';
    import AgentWorkbench from '/src/features/fs-assistant-test/AgentWorkbench.vue';
    import '/src/assets/theme.css'; import '/src/assets/elements.css';
    import { identity } from '/src/services/session.ts';
    import { createRouter, createMemoryHistory } from 'vue-router'; const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]});
    identity.value = {user:{id:'test-user',displayName:'测试顾问'},organization:{id:'test-org'},canManageOrganization:true};
    const editable=ref(true), item=ref('item-1'); window.harness={editable,item,events:[]};
    const embedded = new URLSearchParams(location.search).get('embedded')==='1';
    const stage = new URLSearchParams(location.search).get('stage') || 'design';
    const initialRunId = new URLSearchParams(location.search).get('run');
    createApp({render:()=>h(AgentWorkbench,{key:item.value,stage,embedded,editable:editable.value,base:'/items/'+item.value+'/agent',modelPath:'/items/'+item.value+'/models',selection:{projectId:'project-1',itemId:item.value,workspaceStage:stage},storageScope:item.value,initialRunId,onOpenArtifact:a=>window.harness.events.push(['openArtifact',a]),onArtifact:a=>window.harness.events.push(['artifact',a]),onConversation:id=>window.harness.events.push(['conversation',id]),onFilesChanged:id=>window.harness.events.push(['filesChanged',id])})}).use(router).mount('#app');
    document.querySelector('#app').style.height='100dvh'; document.querySelector('#app').style.display='flex';
    document.querySelector('.assistant-test').style.width='100%';
  `;
        },
      },
    ],
  });
  await web.listen();
});
test.afterAll(async () => {
  await web?.close();
  backend?.closeAllConnections();
  await new Promise<void>((r) => backend?.close(r));
});
test.beforeEach(async ({ page }) => {
  requests.length = 0;
  await page.goto(origin + '/__elements');
  await expect(page.getByLabel('输入消息', { exact: true })).toBeVisible();
});

test('Elements composer: model picker, IME, newline, item scope, streaming Markdown and safe HTML', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('option').filter({ hasText: '模型 Beta' }).click();
  const input = page.getByLabel('输入消息', { exact: true });
  await input.fill('采购分析');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  expect(requests.filter((x) => x.kind === 'run')).toHaveLength(0);
  await input.dispatchEvent('compositionend');
  await input.fill('采购分析');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('采购分析\n');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible();
  await expect(page.getByRole('button', { name: '复制代码' })).toBeVisible();
  expect(requests.find((x) => x.kind === 'run')).toMatchObject({
    modelId: 'model-b',
    selection: { itemId: 'item-1', projectId: 'project-1', workspaceStage: 'design' },
  });
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();
  await expect(page.locator('.elements-markdown a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('.elements-markdown img')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/fs-workspace/elements-desktop.png', fullPage: true });
});
test('stop preserves response and next draft; failed earlier request cannot erase new input', async ({
  page,
}) => {
  const input = page.getByLabel('输入消息', { exact: true });
  await input.fill('取消任务');
  await input.press('Enter');
  await expect(page.getByText('这段内容应保留', { exact: true })).toBeVisible();
  await input.fill('下一条消息');
  await input.press('Enter');
  expect(requests.filter((x) => x.kind === 'run')).toHaveLength(1);
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText('已停止，内容已保留')).toBeVisible();
  await expect(input).toHaveValue('下一条消息');
  await input.fill('失败请求');
  await input.press('Enter');
  await input.fill('不能被覆盖的新草稿');
  await expect(page.getByText('模拟服务失败').first()).toBeVisible();
  await expect(input).toHaveValue('不能被覆盖的新草稿');
});
test('failed empty response has one actionable alert and preserves the submitted draft', async ({
  page,
}) => {
  const input = page.getByLabel('输入消息', { exact: true });
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await input.fill('失败请求');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: '模拟服务失败' })).toHaveCount(1);
  await expect(input).toHaveValue('失败请求');
  await expect(page.getByText('未收到模型正文', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新生成', exact: true })).toBeVisible();
});

test('attachments upload/remove preserve conversation identity and readonly controls', async ({
  page,
}) => {
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: '采购需求.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('采购组织'),
    });
  await expect(page.getByRole('button', { name: '预览 采购需求.txt' })).toBeVisible();
  await page.getByRole('button', { name: '处理附件', exact: true }).click();
  await expect(page.getByText('采购需求.txt · 已就绪')).toBeVisible();
  await page.getByLabel('输入消息', { exact: true }).fill('附件分析');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible();
  expect(requests.find((x) => x.kind === 'run').attachmentIds).toEqual(['remote-file-1']);
  await page.getByRole('button', { name: '删除 采购需求.txt' }).click();
  expect(requests.some((x) => x.kind === 'remove')).toBe(true);
  await page.evaluate(() => {
    (window as any).harness.editable.value = false;
  });
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '添加文件或图片' })).toBeDisabled();
});
test('business clarification resumes original item and artifact preview/adoption stay integrated', async ({
  page,
}) => {
  await page.getByLabel('输入消息', { exact: true }).fill('确认采购范围');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('需要你确认后继续')).toBeVisible();
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expect(page.getByText('请为每个问题选择选项或填写说明。')).toBeVisible();
  await page.getByRole('radio', { name: '补充其他口径' }).check();
  await page.getByLabel('采购范围：补充说明').fill('只含国内采购');
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expect(page.getByRole('heading', { name: '采购功能说明书' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: '说明书章节目录' })
      .getByRole('button', { name: '业务范围', exact: true }),
  ).toBeVisible();
  const resumed = requests.filter((x) => x.kind === 'run').at(-1);
  expect(resumed.decisionAnswer.values.scope).toBe('text:只含国内采购');
  expect(resumed.selection.itemId).toBe('item-1');
  expect(resumed.resumeRunId).toBeTruthy();
  await page.getByRole('button', { name: '采用到当前草稿' }).click();
  expect(
    await page.evaluate(() =>
      (window as any).harness.events.some((x: any) => x[0] === 'artifact' && x[1].revision === 2),
    ),
  ).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('2.json');
});
test('embedded development item receives artifact event; new item has no old history; mobile fits', async ({
  page,
}) => {
  await page.goto(origin + '/__elements?embedded=1&stage=development');
  await page.getByLabel('输入消息', { exact: true }).fill('生成开发内容');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).harness.events.some((x: any) => x[0] === 'openArtifact')),
    )
    .toBe(true);
  expect(requests.find((x) => x.kind === 'run').selection.workspaceStage).toBe('development');
  await page.evaluate(() => {
    (window as any).harness.item.value = 'item-2';
  });
  await expect(page.getByText('一起完成开发')).toBeVisible();
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('输入消息', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/fs-workspace/elements-mobile.png', fullPage: true });
});
test('attachment preparation gates send and new conversation before a file enters the tray', async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return original.call(this);
    };
  });
  await page.getByLabel('输入消息', { exact: true }).fill('带附件的需求');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: '慢读取.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('完整业务材料'),
    });
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '预览 慢读取.txt' })).toBeVisible();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible();
  expect(requests.find((x) => x.kind === 'run').attachmentIds).toEqual(['remote-file-1']);
});
test('long conversation lets readers scroll up and return to latest without losing content', async ({
  page,
}) => {
  await page.getByLabel('输入消息', { exact: true }).fill('取消长文测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('第 90 段采购说明。', { exact: true })).toBeVisible();
  const scroll = page.locator('.elements-conversation [style*="overflow: auto"]').first();
  await scroll.hover();
  await page.mouse.wheel(0, -20000);
  await expect(page.getByRole('button', { name: '滚动到最新消息' })).toBeVisible();
  await page.getByRole('button', { name: '滚动到最新消息' }).click();
  await expect
    .poll(() => scroll.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight))
    .toBeLessThan(70);
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText('已停止，内容已保留')).toBeVisible();
});
test('restore recovers current item history and rejects history owned by another item', async ({
  page,
}) => {
  await page.getByLabel('输入消息', { exact: true }).fill('采购分析');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible();
  const id = [...runs.keys()].at(-1)!;
  await page.goto(origin + '/__elements?run=' + id);
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible();
  await page.evaluate(() => {
    (window as any).harness.item.value = 'item-2';
  });
  await expect(page.getByRole('alert')).toContainText('历史会话归属与当前开发项目标不一致');
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
});

test('round2: one scroll owner, named messages, live duration and frozen stop duration', async ({
  page,
}) => {
  await page.getByLabel('输入消息', { exact: true }).fill('取消长文测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('第 90 段采购说明。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('发送信息')).toContainText('测试顾问');
  await expect(page.getByLabel('发送信息').locator('time')).toBeVisible();
  const info = page.getByLabel('运行信息', { exact: true });
  const before = await info.innerText();
  await expect.poll(() => info.innerText()).not.toBe(before);
  const scrollOwners = await page.locator('.elements-conversation').evaluate(
    (root) =>
      [root, ...root.querySelectorAll('*')].filter((e) => {
        const css = getComputedStyle(e);
        return /auto|scroll/.test(css.overflowY) && e.scrollHeight > e.clientHeight + 2;
      }).length,
  );
  expect(scrollOwners).toBe(1);
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText('已停止，内容已保留')).toBeVisible();
  const stopped = await info.innerText();
  await page.waitForTimeout(1200);
  expect(await info.innerText()).toBe(stopped);
});

test('round2: recommended choices remain explicit and resume original task', async ({ page }) => {
  await page.getByLabel('输入消息', { exact: true }).fill('确认采购范围');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('radio', { name: /全部采购（推荐）/ })).toBeVisible();
  const n = requests.filter((r) => r.kind === 'run').length;
  await page.getByRole('button', { name: '选择全部推荐' }).click();
  await expect(page.getByRole('radio', { name: /全部采购（推荐）/ })).toBeChecked();
  expect(requests.filter((r) => r.kind === 'run').length).toBe(n);
  await page.getByRole('button', { name: '确认并继续' }).click();
  await expect(page.getByRole('heading', { name: '采购功能说明书' })).toBeVisible();
  expect(requests.filter((r) => r.kind === 'run').at(-1).decisionAnswer.values.scope).toBe('all');
});
