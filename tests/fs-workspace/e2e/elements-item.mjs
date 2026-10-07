import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { apiFixture } from '../../../tests/fs-workspace/fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
const out = 'artifacts/fs-workspace/elements-item';
const origin = 'http://127.0.0.1:5192';
const spec = JSON.parse(
  await readFile('packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', 'utf8'),
);
const received = [],
  checks = [],
  errors = [];
const f = await apiFixture({
  origin,
  agentStream: async (_c, _k, _p, o) => {
    received.push(o.context);
    const task = o.context.manifest.task;
    o.onDelta(
      task === 'clarification'
        ? '{"kind":"ready"}'
        : task === 'development'
          ? JSON.stringify({
              kind: 'development',
              title: '盘点程序',
              overview: '只读',
              technicalDesign: '依据指定版本',
              code: 'REPORT zstock.',
              tests: '未执行',
              notes: '',
            })
          : task === 'draft'
            ? JSON.stringify({ ...spec, sources: o.context.manifest.sources })
            : '已记录：冻结库存不自动清账。请确认跨期差异和重复执行的处理规则。',
    );
    return { finishReason: 'stop' };
  },
});
let web, browser, page;
const api = async (method, path, payload) =>
  await f.app.inject({ method, url: '/api' + path, payload, headers: f.headers });
try {
  await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
    name: '本地模拟模型',
    provider: 'test',
    protocol: 'openai_chat',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'synthetic',
    apiKey: 'synthetic',
    maxOutputTokens: 20000,
    temperature: null,
    timeoutSeconds: 30,
  });
  await f.db.query(
    "UPDATE app.development_item SET code='DEV-0005',name='全厂库存盘点差异自动清账',module='MM',summary='按工厂与盘点日期汇总差异，识别冻结库存、跨期差异及重复执行。',acceptance='冻结库存不得自动清账；重复执行不重复过账。' WHERE id=$1",
    [f.scope.itemId],
  );
  await f.db.query("UPDATE app.project SET name='虚拟测试项目' WHERE id=$1", [f.scope.projectId]);
  await f.app.listen({ host: '127.0.0.1', port: 3202 });
  web = await createServer({
    root: 'D:/Workspace/sap-delivery-workbench/apps/web',
    server: {
      host: '127.0.0.1',
      port: 5192,
      strictPort: true,
      hmr: false,
      proxy: { '/api': 'http://127.0.0.1:3202' },
    },
  });
  await web.listen();
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
  const path = `/projects/${f.scope.projectId}/development-items/${f.scope.itemId}`;
  await page.goto(origin + '/workspace/development-items');
  await page.getByLabel('筛选模块').selectOption('MM');
  await page.getByLabel('搜索开发清单').fill('DEV-0005');
  await page.getByLabel('筛选阶段').selectOption('fs_draft');
  await page
    .getByRole('row')
    .filter({ hasText: 'DEV-0005' })
    .getByRole('link', { name: '设计', exact: true })
    .click();
  await page.getByLabel('输入消息', { exact: true }).waitFor();
  await page.getByLabel('返回开发清单').click();
  await page.getByRole('row').filter({ hasText: 'DEV-0005' }).waitFor();
  assert.equal(await page.getByLabel('搜索开发清单').inputValue(), 'DEV-0005');
  assert.equal(await page.getByLabel('筛选模块').inputValue(), 'MM');
  assert.equal(await page.getByLabel('筛选阶段').inputValue(), 'fs_draft');
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'DEV-0005' }).waitFor();
  assert.equal(await page.getByLabel('搜索开发清单').inputValue(), 'DEV-0005');
  checks.push('清单搜索、模块、阶段在返回及刷新后恢复');
  await page.goto(origin + path + '/design');
  await page.getByLabel('输入消息', { exact: true }).waitFor();
  assert.ok(await page.getByLabel('输入消息', { exact: true }).getAttribute('placeholder'));
  for (const label of ['刷新工作区', '需求讨论', '生成说明书', '智能助手 · 继续工作'])
    assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
  checks.push('默认连续对话、红框内容及阶段切换移除');
  await page.getByLabel('打开资料面板').click();
  await page.getByText('需求摘要', { exact: true }).waitFor();
  await page.getByRole('button', { name: '成果', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('工作备注', { exact: true }).fill('人工约束：只处理本工厂。');
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '工作稿已保存' }).waitFor();
  checks.push('右侧当前成果编辑保存');
  await page.getByLabel('关闭右侧面板').click();
  await page.getByLabel('输入消息', { exact: true }).fill('先不要生成说明书，讨论冻结库存如何处理');
  await page.getByLabel('发送消息', { exact: true }).click();
  await page
    .getByText('已记录：冻结库存不自动清账。请确认跨期差异和重复执行的处理规则。', { exact: true })
    .waitFor();
  assert.equal(received.at(-1).manifest.task, 'dialogue');
  assert.equal(
    await page.locator('.work-chat-heading h2').innerText(),
    '全厂库存盘点差异自动清账 · 设计助手',
  );
  assert.ok(await page.getByLabel('发送信息').first().locator('time').isVisible());
  assert.ok(!(await page.getByLabel('发送信息').first().innerText()).includes('历史姓名未记录'));
  checks.push('稳定开发项标题、持久化发送人及日期时间');
  assert.ok(JSON.stringify(received.at(-1)).includes('人工约束：只处理本工厂'));
  await page.getByLabel('输入消息', { exact: true }).fill('请生成说明书');
  await page.getByLabel('发送消息', { exact: true }).click();
  await page.getByRole('button', { name: '采用为当前成果', exact: true }).waitFor();
  await page.getByRole('button', { name: '采用为当前成果', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认继续', exact: true })
    .click();
  await page.getByRole('status').filter({ hasText: 'AI 候选已采用' }).waitFor();
  checks.push('同一对话自然语言讨论转生成、采用保存与最新人工内容入模');
  await page.screenshot({
    path: out + '/设计-文档并排-1600.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('承接上次对话的用户要求摘录').check();
  await page.getByRole('button', { name: '创建对话', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.work-session-row').length === 2);
  await page.getByText('查看承接内容', { exact: true }).waitFor();
  await page.screenshot({
    path: out + '/设计-对话管理-1600.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('关闭右侧面板').click();
  assert.equal(await page.locator('[data-message-id]').count(), 0);
  await page.getByLabel('输入消息', { exact: true }).fill('本轮讨论验收边界');
  await page.getByLabel('发送消息', { exact: true }).click();
  await page
    .getByText('已记录：冻结库存不自动清账。请确认跨期差异和重复执行的处理规则。', { exact: true })
    .waitFor();
  assert.ok(received.at(-1).manifest.workContext.handoff.summary.includes('冻结库存'));
  assert.equal(received.at(-1).manifest.included.length, 0);
  checks.push('新对话承接摘要和当前成果、不复制旧消息');
  await page.reload();
  await page
    .getByText('已记录：冻结库存不自动清账。请确认跨期差异和重复执行的处理规则。', { exact: true })
    .waitFor();
  await page.getByLabel('打开资料面板').click();
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.locator('.work-session-row').last().click();
  await page.getByRole('button', { name: /打开功能说明书/ }).waitFor();
  checks.push('刷新恢复与历史会话切换');
  // Upload via the actual input, then verify restored server file list.
  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('添加文件或图片').click();
  await (
    await chooser
  ).setFiles({
    name: '盘点需求.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('冻结库存不清账'),
  });
  await page.getByRole('button', { name: '处理附件', exact: true }).click();
  await page.getByText(/盘点需求.txt · 已就绪/).waitFor();
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.locator('.work-file-row').filter({ hasText: '盘点需求.txt' }).click();
  await page.getByText('提取内容预览，非原始文件。', { exact: true }).waitFor();
  checks.push('附件上传、服务端文件列表与提取内容预览');
  await page.screenshot({
    path: out + '/设计-文件面板-1600.png',
    fullPage: true,
    animations: 'disabled',
  });
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    if (width === 390)
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('.main-shell')).marginLeft === '0px',
      );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({
      path: out + '/资料面板-' + width + '.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByLabel('关闭右侧面板').click();
    assert.ok(await page.getByLabel('输入消息', { exact: true }).isVisible());
    await page.screenshot({
      path: out + '/对话-' + width + '.png',
      fullPage: true,
      animations: 'disabled',
    });
    if (width === 1600) await page.getByLabel('打开资料面板').click();
  }
  checks.push('宽窄屏无横向溢出、面板可关闭、输入框可见');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(origin + path + '/development');
  await page.getByRole('button', { name: '选择依据', exact: true }).click();
  await page.getByLabel('引用版本').selectOption({ index: 1 });
  await page.getByRole('button', { name: '保存设计依据', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '工作稿已保存' }).waitFor();
  await page.getByLabel('关闭右侧面板').click();
  await page.getByLabel('输入消息', { exact: true }).fill('请根据设计生成ABAP代码');
  await page.getByLabel('发送消息', { exact: true }).click();
  await page.getByRole('button', { name: '采用为当前成果', exact: true }).waitFor();
  assert.ok(received.at(-1).manifest.workContext.designVersionId);
  await page.getByRole('button', { name: '采用为当前成果', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认继续', exact: true })
    .click();
  await page.getByRole('status').filter({ hasText: 'AI 候选已采用' }).waitFor();
  assert.match((await api('GET', path + '/work/development')).json().head.document.code, /zstock/);
  checks.push('开发独立会话、固定设计依据、自然语言生成与采用');
  await page.screenshot({ path: out + '/开发-1600.png', fullPage: true, animations: 'disabled' });
  await page.getByLabel('关闭右侧面板').click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: '查看日志', exact: true }).last().click();
  const logPage = await popupPromise;
  await logPage.getByRole('heading', { name: '运行信息与日志' }).waitFor();
  await logPage.getByText('执行步骤', { exact: true }).waitFor();
  await logPage.getByText(/JSON → Markdown：本地 JavaScript 脚本，模型调用 0 次/).waitFor();
  checks.push('成果保存日志记录本地脚本渲染耗时，模型调用零次');
  await logPage.screenshot({ path: out + '/运行日志.png', fullPage: true });
  await logPage.close();
  checks.push('运行编号常显，一键打开对应授权日志页面');
  await page.getByRole('button', { name: '重置对话（清空两阶段成果）', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已重置：设计与开发' }).waitFor();
  assert.equal((await api('GET', path + '/work/design')).json().head, null);
  const clearedDev = (await api('GET', path + '/work/development')).json();
  assert.equal(clearedDev.head.document.code, '');
  assert.equal(clearedDev.head.designVersionId, null);
  for (const st of ['design', 'development'])
    assert.equal((await api('GET', path + '/work/' + st + '/sessions')).json().items.length, 0);
  await page.reload();
  await page.getByRole('button', { name: '选择依据', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '查看日志', exact: true }).count(), 0);
  checks.push('一键清空两阶段会话和成果，刷新不恢复，开发设计依据清空');
  await page.screenshot({ path: out + '/重置后.png', fullPage: true });
  assert.deepEqual(errors, []);
  checks.push('浏览器无未捕获异常');
  await writeFile(
    out + '/页面验收.json',
    JSON.stringify({ checks, model: 'local mock', sapCalls: 0, errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (e) {
  if (page) await page.screenshot({ path: out + '/失败诊断.png', fullPage: true });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await web?.close();
  await f.close();
}
