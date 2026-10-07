import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

test('delivery table: selection, navigation semantics, personalization and responsive layout', async (t) => {
  const server = await createServer({
    root: 'apps/web',
    server: { port: 5193, strictPort: true, hmr: false },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /vxe|Vue warn/i.test(msg.text())) errors.push(msg.text());
  });
  let rejectSave = true;
  let readOnly = false;
  let failDeleteId = '';
  let holdRead, releaseRead;
  let denied = false;
  let items = Array.from({ length: 25 }, (_, n) => ({
    id: `i${n}`,
    code: `DEV-${String(n + 1).padStart(4, '0')}`,
    name: ['采购订单执行清单', '供应商未清项批量清账', '交货到期清单与逾期分析'][n % 3],
    module: ['MM', 'FICO', 'SD'][n % 3],
    kind: 'report',
    priority: n % 3 === 0 ? 'high' : 'low',
    stage: n % 2 ? 'ready' : 'fs_draft',
    rowVersion: '1',
    businessOwnerId: 'u',
    developerId: null,
    plannedDevDate: '2026-10-20',
    blockedReason: n === 0 ? '等待业务确认' : null,
    summary: '完整需求说明',
    summaryFormat: 'plain',
  }));
  const deleted = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = {};
    if (path === '/api/session')
      data = {
        user: { id: 'u', displayName: '测试用户' },
        organization: { id: 'org', name: 'Inspire' },
        canManageOrganization: true,
      };
    else if (path === '/api/projects')
      data = [{ id: 'p1', name: '虚拟测试项目', status: 'active' }];
    else if (path === '/api/project-preference') data = { projectId: 'p1' };
    else if (path === '/api/projects/p1/development-items') {
      if (holdRead) await holdRead;
      if (denied) {
        await route.fulfill({ status: 404, json: { message: '项目不存在或无权访问。' } });
        return;
      }
      data = {
        items,
        members: [{ id: 'u', displayName: '张顾问', active: true }],
        readOnly,
        isAdmin: true,
      };
    } else if (route.request().method() === 'PATCH') {
      if (rejectSave) {
        await route.fulfill({ status: 409, json: { message: '测试保存冲突，输入应保留' } });
        return;
      }
      const id = path.split('/').at(-1),
        body = route.request().postDataJSON();
      assert.equal(body.rowVersion, '1');
      items = items.map((i) => (i.id === id ? { ...i, ...body.changes, rowVersion: '2' } : i));
      data = items.find((i) => i.id === id);
    } else if (route.request().method() === 'DELETE') {
      const id = path.split('/').at(-1);
      if (id === failDeleteId) {
        await route.fulfill({ status: 409, json: { message: '版本冲突' } });
        return;
      }
      deleted.push(id);
      items = items.filter((i) => i.id !== id);
      data = { ok: true };
    } else if (path.endsWith('/files') || path.endsWith('/events')) data = [];
    await route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5193/workspace/development-items');
  await page.getByRole('button', { name: '新建开发项', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '复制', exact: true }).count(), 0);
  // Background refresh must retain usable rows while the real fetch is outstanding.
  holdRead = new Promise((resolve) => {
    releaseRead = resolve;
  });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('更新中…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^查看 DEV-/ }).count(), 20);
  assert.equal(
    await page.getByRole('button', { name: /^编辑开发名称/ }).count(),
    0,
    'refresh must not allow stale GET to race with PATCH',
  );
  releaseRead();
  holdRead = null;
  await page.getByText('清单已更新', { exact: true }).waitFor();
  await page.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper').hover();
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(
    () =>
      document.querySelector('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper').scrollTop >
      200,
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper')?.scrollTop >
      200,
  );
  await page.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper').hover();
  await page.mouse.wheel(0, -2000);
  await page.getByRole('checkbox', { name: '选择 DEV-0001', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 DEV-0002', exact: true }).check();
  await page.getByText('已选择 2 项', { exact: true }).waitFor();
  assert.equal(await page.locator('.delivery-detail').count(), 0);
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).isEnabled(), true);
  assert.match(
    await page.getByRole('link', { name: '设计', exact: true }).first().getAttribute('href'),
    /\/i0\/design$/,
  );
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByRole('button', { name: '编辑开发名称 DEV-0001', exact: true }).click();
  const input = page.locator('.inline-editor input').filter({ visible: true });
  await input.fill('修改后的采购报表');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试保存冲突' }).waitFor();
  assert.equal(await input.inputValue(), '修改后的采购报表');
  assert.equal(items[0].name, '采购订单执行清单');
  await page.getByRole('link', { name: '设计', exact: true }).first().click();
  await page.getByRole('button', { name: '取消，保留当前内容' }).click();
  assert.match(page.url(), /workspace\/development-items/);
  assert.equal(await input.inputValue(), '修改后的采购报表');
  rejectSave = false;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '字段已保存' }).waitFor();
  assert.equal(items[0].name, '修改后的采购报表');
  await page.getByRole('button', { name: '查看 DEV-0001', exact: true }).click();
  await page.locator('.delivery-detail').waitFor();
  await mkdir('outputs/delivery-table', { recursive: true });
  await page.screenshot({ path: 'outputs/delivery-table/detail.png', fullPage: true });
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '按编号排序', exact: true }).click();
  await page.getByRole('button', { name: '按编号排序', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: /^查看 DEV-/ })
      .first()
      .innerText(),
    'DEV-0025',
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.trim().split('\r\n').length, 26);
  assert.match(csv.split('\r\n')[1], /DEV-0025/);
  await page.getByRole('button', { name: '按编号排序', exact: true }).click();
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  await page.getByRole('dialog', { name: '列设置' }).waitFor();
  await page.getByLabel('显示需求描述', { exact: true }).check();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '列设置', exact: true }).click();
  assert.equal(await page.getByLabel('显示需求描述', { exact: true }).isChecked(), true);
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByLabel('搜索开发清单').fill('不存在的条目');
  await page
    .getByText('没有符合筛选条件的开发项', { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor();
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0);
  await page.getByRole('button', { name: '清除全部', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 DEV-0001', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 DEV-0002', exact: true }).check();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '取消，保留当前内容' }).click();
  assert.equal(deleted.length, 0);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认继续' }).click();
  await page.getByRole('status').filter({ hasText: '已删除 2 项' }).waitFor();
  assert.deepEqual(deleted, ['i0', 'i1']);
  await page.getByRole('checkbox', { name: '选择 DEV-0003', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 DEV-0004', exact: true }).check();
  failDeleteId = 'i3';
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认继续' }).click();
  await page.getByRole('alert').filter({ hasText: '有 1 项删除失败' }).waitFor();
  assert.equal(
    await page.getByRole('checkbox', { name: '选择 DEV-0004', exact: true }).isChecked(),
    true,
  );
  failDeleteId = '';
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择 DEV-0004', exact: true }).waitFor();
  await mkdir('outputs/delivery-table', { recursive: true });
  await page.screenshot({ path: 'outputs/delivery-table/desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.main-shell')).marginLeft === '0px' &&
      document.querySelector('.workbench-mobile')?.getBoundingClientRect().height < 500,
  );
  await page.screenshot({ path: 'outputs/delivery-table/mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('.workbench-mobile').hover();
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('.workbench-mobile')?.scrollTop > 200);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.workbench-mobile')?.scrollTop > 200);
  await page.setViewportSize({ width: 1440, height: 900 });
  readOnly = true;
  await page.reload();
  await page.getByText('此项目已归档，只能查看历史资料。').waitFor();
  await page.getByRole('checkbox', { name: '选择 DEV-0004', exact: true }).check();
  assert.equal(
    await page.getByRole('button', { name: '新建开发项', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await page.getByRole('button', { name: '查看 DEV-0004', exact: true }).click();
  await page.getByRole('button', { name: '展开详情', exact: true }).click();
  denied = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '项目不存在或无权访问' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^查看 DEV-/ }).count(), 0);
  assert.equal(
    await page.getByRole('button', { name: '新建开发项', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.locator('.delivery-list').isVisible(), true, 'denial exits full detail');
  denied = false;
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await page.getByRole('button', { name: '查看 DEV-0004', exact: true }).waitFor();
  assert.deepEqual(errors, []);
});
