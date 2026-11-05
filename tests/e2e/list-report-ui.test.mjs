import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const today = (() => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
})();
const phase = (status = 'not_started', extra = {}) => ({
  assigneeId: null,
  effortDays: null,
  plannedStart: null,
  plannedEnd: null,
  actualStart: null,
  actualEnd: null,
  progress: 0,
  status,
  notes: '',
  ...extra,
});

// docs/modules/list-report.md: the filter bar, conditions, column menu, 适配筛选 and saved views.
test('list report: filter bar, column menu, adapt filters and saved views', async (t) => {
  const items = Array.from({ length: 12 }, (_, n) => ({
    id: `i${n}`,
    code: String(n + 1).padStart(5, '0'),
    itemNo: n + 1,
    rowVersion: '1',
    createdBy: 'u',
    module: ['SD', 'MM', 'PP'][n % 3],
    kind: ['report', 'interface'][n % 2],
    name: `开发项 ${n + 1}`,
    businessFunction: '',
    priority: 'medium',
    difficulty: n === 0 ? 'hard' : 'medium',
    changeType: 'new',
    registeredOn: today,
    businessOwner: '',
    notes: '',
    transactionCode: '',
    phases: {
      fsd: phase('completed'),
      development: phase(['in_progress', 'not_started'][n % 2], {
        assigneeId: n % 4 === 0 ? null : 'u',
        plannedEnd: n < 3 ? today : '2020-01-01',
      }),
      consultant_test: phase(),
      user_test: phase(),
    },
    objects: [],
    tags: n === 1 ? ['t1'] : [],
    custom: {},
  }));
  const server = await createServer({
    root: 'apps/web',
    server: { port: 5196, strictPort: true, hmr: false },
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
    if (msg.type() === 'error' && /Vue warn/i.test(msg.text())) errors.push(msg.text());
  });
  const access = {
    projectId: 'p1',
    permissions: ['project:view', 'delivery.item:view', 'delivery.view:save'],
    limits: {},
  };
  let views = [];
  const viewsPath = '/api/projects/p1/list-views/delivery.items';
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    let data = {};
    if (path === '/api/session')
      data = {
        authenticated: true,
        user: { id: 'u', displayName: '测试用户' },
        organization: { id: 'org', name: 'Inspire' },
        permissions: [],
      };
    else if (path === '/api/projects/p1/access') data = access;
    else if (path === '/api/projects/p1') data = { id: 'p1', milestones: [] };
    else if (path === '/api/projects')
      data = [{ id: 'p1', code: 'P1', name: '虚拟测试项目', status: 'active' }];
    else if (path === '/api/project-preference') data = { projectId: 'p1' };
    else if (path === '/api/projects/p1/development-items')
      data = {
        items,
        members: [{ id: 'u', displayName: '张顾问', active: true }],
        tags: [{ id: 't1', name: '紧急', color: 'red', usage: 1 }],
        fields: [],
        readOnly: false,
        access,
      };
    else if (path === '/api/projects/p1/development-tags') data = [];
    else if (path === viewsPath && method === 'GET') data = { views, canSave: true };
    else if (path === viewsPath && method === 'POST') {
      const body = request.postDataJSON();
      if (body.isDefault) views = views.map((v) => ({ ...v, isDefault: false }));
      data = {
        id: 'v' + (views.length + 1),
        name: body.name,
        isDefault: !!body.isDefault,
        autoApply: body.autoApply !== false,
        state: body.state,
      };
      views = [...views, data];
    } else if (path.startsWith(viewsPath + '/') && method === 'PATCH') {
      const id = path.split('/').at(-1);
      const body = request.postDataJSON();
      if (body.isDefault) views = views.map((v) => ({ ...v, isDefault: false }));
      views = views.map((v) => (v.id === id ? { ...v, ...body } : v));
      data = views.find((v) => v.id === id);
    } else if (path.startsWith(viewsPath + '/') && method === 'DELETE') {
      views = views.filter((v) => v.id !== path.split('/').at(-1));
      data = { ok: true };
    }
    await route.fulfill({ json: data });
  });
  const total = (n) => page.getByText(new RegExp(` 共 ${n} 项$`)).waitFor();
  const closePanel = () => page.keyboard.press('Escape');

  await page.goto('http://127.0.0.1:5196/workspace/development-items');
  await total(12);
  const bar = page.getByRole('region', { name: '筛选栏' });
  await bar.getByText('开发人员', { exact: true }).waitFor();
  assert.equal(await page.getByText('已修改').count(), 0);

  // Several values of a field, with how many rows each would find.
  await bar.getByRole('button', { name: '模块：全部' }).click();
  const sd = page.getByRole('checkbox', { name: 'SD' });
  await sd.check();
  await total(4);
  await page.getByRole('checkbox', { name: 'MM' }).check();
  await total(8);
  assert.match(await page.locator('.lr-option').filter({ hasText: 'PP' }).innerText(), /4/);
  await closePanel();
  await bar.getByRole('button', { name: '模块：SD、MM' }).waitFor();
  await page.getByText('已修改').waitFor();

  // Exclusion turns the same choices round.
  await bar.getByRole('button', { name: '模块：SD、MM' }).click();
  await page.getByRole('button', { name: '排除', exact: true }).click();
  await total(4);
  await closePanel();
  await bar.getByRole('button', { name: '模块：≠ SD、≠ MM' }).waitFor();
  await page.getByRole('button', { name: '清除模块' }).click();
  await total(12);

  // A value and “none” together, and the condition belongs to one phase.
  await bar.getByRole('button', { name: '开发人员：全部' }).click();
  await page.getByRole('checkbox', { name: '未分配' }).check();
  await total(3);
  await closePanel();
  await page.getByRole('button', { name: '清除开发人员' }).click();

  // A date preset stays a preset.
  await bar.getByRole('button', { name: '开发计划完成：全部' }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await total(3);
  await closePanel();
  await bar.getByRole('button', { name: '开发计划完成：今天' }).waitFor();

  // Hiding the bar keeps the conditions in sight, as removable chips.
  await page.keyboard.press('f');
  await bar.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '移除筛选 开发计划完成：今天' }).click();
  await total(12);
  await page.keyboard.press('f');
  await bar.waitFor();

  // A column header opens sorting and the same filter; the header then shows it.
  await page.getByRole('button', { name: '开发状态列菜单' }).click();
  await page.getByRole('checkbox', { name: '进行中' }).check();
  await total(6);
  await page.getByRole('button', { name: '降序排列' }).click();
  await page.locator('thead th.filtered').filter({ hasText: '开发状态' }).waitFor();
  await page.getByRole('button', { name: '清除开发状态' }).click();
  await total(12);

  // 适配筛选 puts another field on the bar.
  await page.getByRole('button', { name: /^适配筛选/ }).click();
  await page.getByLabel('搜索字段').fill('难易');
  await page.getByLabel('显示筛选字段 难易度').check();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await bar.getByRole('button', { name: '难易度：全部' }).click();
  await page.getByRole('checkbox', { name: /^难/ }).check();
  await total(1);
  await closePanel();
  await mkdir('.runtime/artifacts/list-report', { recursive: true });
  await page.screenshot({ path: '.runtime/artifacts/list-report/bar.png' });

  // Saved as the default view, it is what the next visit opens on.
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await page.getByRole('dialog', { name: '另存为新视图' }).getByText('难易度：难').waitFor();
  await page.screenshot({ path: '.runtime/artifacts/list-report/save.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('请填写视图名称。').waitFor();
  await page.getByLabel('视图名称').fill('难点开发');
  await page.getByRole('checkbox', { name: /设为我的默认/ }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '视图：难点开发' }).waitFor();
  assert.equal(await page.getByText('已修改').count(), 0);
  assert.equal(views[0].isDefault, true);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: '视图：难点开发' }).waitFor();
  await total(1);

  // A change shows as unsaved, 保存 keeps it, 标准 brings the list back.
  await page.getByLabel('搜索', { exact: true }).fill('开发项');
  await page.getByText('已修改').waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已修改').waitFor({ state: 'detached' });
  assert.equal(views[0].state.search, '开发项');
  await page.getByRole('button', { name: '视图：难点开发' }).click();
  await page.locator('.lr-view-item').filter({ hasText: '标准' }).click();
  await total(12);
  assert.equal(await bar.getByRole('button', { name: /^难易度/ }).count(), 0);

  // With 打开即应用 off a view shows its conditions and waits.
  await page.getByRole('button', { name: '视图：标准' }).click();
  await page.getByRole('button', { name: '管理视图' }).click();
  const manage = page.getByRole('dialog', { name: '管理视图' });
  await manage.getByLabel('难点开发打开即应用').uncheck();
  await page.screenshot({ path: '.runtime/artifacts/list-report/manage.png' });
  await manage.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '视图：标准' }).click();
  await page.locator('.lr-view-item').filter({ hasText: '难点开发' }).click();
  await total(0);
  await bar.getByRole('button', { name: '难易度：难' }).waitFor();
  await page.getByRole('button', { name: '应用', exact: true }).first().click();
  await total(1);

  // A view is deleted only after asking.
  await page.getByRole('button', { name: '视图：难点开发' }).click();
  await page.getByRole('button', { name: '管理视图' }).click();
  await manage.getByRole('button', { name: '删除视图 难点开发' }).click();
  await page.getByRole('button', { name: '确认继续' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '视图：标准' }).waitFor();
  assert.deepEqual(views, []);
  assert.deepEqual(errors, []);
});
