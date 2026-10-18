import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const phase = (status = 'not_started', extra = {}) => ({
  assigneeId: null,
  effortDays: null,
  plannedStart: null,
  plannedEnd: null,
  actualEnd: null,
  progress: status === 'completed' ? 100 : 0,
  status,
  notes: '',
  ...extra,
});

test('development list: page/batch/row actions, inline edit, grouped drawer, columns', async (t) => {
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
  const batches = [];
  let items = Array.from({ length: 25 }, (_, n) => ({
    id: `i${n}`,
    code: String(n + 1).padStart(5, '0'),
    itemNo: n + 1,
    rowVersion: '1',
    module: ['MM', 'FICO', 'SD'][n % 3],
    kind: 'report',
    name: ['采购订单执行清单', '供应商未清项批量清账', '交货到期清单与逾期分析'][n % 3],
    businessFunction: '<p>完整需求<strong>说明</strong></p>',
    priority: n % 3 === 0 ? 'high' : 'low',
    difficulty: 'medium',
    changeType: 'new',
    registeredOn: '2026-10-01',
    businessOwner: '业务甲',
    notes: '',
    transactionCode: '',
    phases: {
      fsd: phase(n % 2 ? 'completed' : 'in_progress', {
        assigneeId: 'u',
        plannedEnd: '2026-01-01',
      }),
      development: phase(),
      consultant_test: phase(),
      user_test: phase(),
    },
    objects: n === 0 ? [{ pgmid: 'R3TR', objectType: 'PROG', objectName: 'ZMM_PO_TRACK' }] : [],
    tags: n === 0 ? ['t1'] : [],
    custom: {},
  }));
  // Contract 3.5: a member who maintains and manages the list in project p1.
  const access = {
    projectId: 'p1',
    permissions: [
      'project:view',
      'delivery.item:view',
      'delivery.item:create',
      'delivery.item:edit',
      'delivery.item:delete',
      'delivery.item:import',
      'delivery.item:export',
      'delivery.config:manage',
    ],
    limits: {},
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    let data = {};
    if (path === '/api/session')
      data = {
        user: { id: 'u', displayName: '测试用户' },
        organization: { id: 'org', name: 'Inspire' },
        permissions: [],
      };
    else if (path === '/api/projects/p1/access') data = access;
    else if (path === '/api/projects/p1') data = { id: 'p1', milestones: [] };
    else if (path === '/api/projects')
      data = [{ id: 'p1', code: 'P1', name: '虚拟测试项目', status: 'active' }];
    else if (path === '/api/project-preference') data = { projectId: 'p1' };
    else if (path === '/api/projects/p1/development-items' && method === 'GET')
      data = {
        items,
        members: [{ id: 'u', displayName: '张顾问', active: true }],
        tags: [{ id: 't1', name: '紧急', color: 'red', usage: 1 }],
        fields: [],
        readOnly: false,
        access,
      };
    else if (path === '/api/projects/p1/development-items/batch') {
      const body = request.postDataJSON();
      batches.push(body);
      if (body.action === 'delete') items = items.filter((i) => !body.ids.includes(i.id));
      data = { count: body.ids.length, ids: body.ids };
    } else if (method === 'PATCH') {
      if (rejectSave) {
        await route.fulfill({ status: 409, json: { message: '测试保存冲突，输入应保留' } });
        return;
      }
      const id = path.split('/').at(-1);
      const body = request.postDataJSON();
      items = items.map((i) => {
        if (i.id !== id) return i;
        const next = structuredClone(i);
        for (const [key, value] of Object.entries(body.changes)) {
          const [a, b] = key.split('.');
          if (b) next.phases[a][b] = value;
          else next[a] = value;
        }
        next.rowVersion = String(Number(i.rowVersion) + 1);
        return next;
      });
      data = items.find((i) => i.id === id);
    } else if (path === '/api/projects/p1/development-tags')
      data = [{ id: 't1', name: '紧急', color: 'red', usage: 1 }];
    else if (path.endsWith('/files') || path.endsWith('/events')) data = [];
    await route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5193/workspace/development-items');
  await page.getByRole('button', { name: '新建开发项', exact: true }).waitFor();

  await mkdir('.runtime/artifacts/delivery-table', { recursive: true });
  await page.screenshot({ path: '.runtime/artifacts/delivery-table/list.png' });
  // Page actions live in the heading (settings under 导入 / 导出); batch actions appear only
  // after selection.
  await page.getByRole('button', { name: '导入 / 导出', exact: true }).click();
  await page.getByRole('menuitem', { name: '清单设置' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '批量修改' }).count(), 0);
  await page.getByRole('checkbox', { name: '选择 00001', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 00002', exact: true }).check();
  await page.getByText('已选 2 项', { exact: true }).waitFor();
  await page.screenshot({ path: '.runtime/artifacts/delivery-table/batch.png' });
  for (const name of ['批量修改', '复制', '导出', '删除'])
    assert.equal(await page.getByRole('button', { name, exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByText(/00001《采购订单执行清单》/).waitFor();
  await page.getByRole('button', { name: '取消，保留当前内容' }).click();
  assert.equal(batches.length, 0);
  await page.getByRole('button', { name: '取消选择', exact: true }).click();

  // Row actions: design navigates; the other agents are announced as coming soon.
  assert.match(
    await page.getByRole('link', { name: '设计 00001', exact: true }).first().getAttribute('href'),
    /\/development-items\/i0\/design$/,
  );
  // Row actions are a hover bar: design and development icons, the rest under "more".
  const firstRow = page.locator('tbody tr').filter({ hasText: '00001' }).first();
  await firstRow.hover();
  // Reports and functions open the development assistant; other kinds are announced as coming.
  assert.match(
    await page.getByRole('link', { name: '开发 00001', exact: true }).first().getAttribute('href'),
    /\/development-items\/i0\/development$/,
  );
  await firstRow.hover();
  await page.getByRole('button', { name: '00001 的更多操作', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '顾问测试' }).click();
  await page.getByText('“顾问测试”Agent 即将开发').waitFor();

  // Inline edit: a choice saves on change; a failure stays in the cell with the value.
  const row = page.locator('tbody tr').filter({ hasText: '00001' }).first();
  await row.locator('.td-priority .inline-cell').click();
  await row.locator('.td-priority select').selectOption('medium');
  await row.getByRole('alert').filter({ hasText: '测试保存冲突' }).waitFor();
  assert.equal(await row.locator('.td-priority select').inputValue(), 'medium');
  rejectSave = false;
  await row.locator('.td-priority select').selectOption('low');
  await row.locator('.td-priority select').waitFor({ state: 'detached' });
  assert.equal(items[0].priority, 'low');
  // Open phases past their planned end are flagged without changing data.
  assert.ok((await row.locator('.td-fsd\\.status').innerText()).includes('逾期'));

  // Drawer: one page grouped by section, no tabs; edit and save the changed fields only.
  await page.getByRole('button', { name: '查看 00001', exact: true }).click();
  const drawer = page.locator('.item-drawer');
  await drawer.waitFor();
  assert.equal(await drawer.getByRole('tab').count(), 0);
  for (const name of [
    '基本信息',
    'FSD相关',
    '开发顾问相关',
    '顾问测试相关',
    'IT顾问/用户测试相关',
    '关联附件',
    '最近活动',
  ])
    await drawer.getByRole('heading', { name, exact: true }).waitFor();
  await drawer.getByText('ZMM_PO_TRACK').waitFor();
  await drawer.getByRole('button', { name: '编辑', exact: true }).click();
  await drawer.getByLabel('开发名称', { exact: true }).fill('修改后的采购报表');
  await drawer.getByLabel('业务Owner', { exact: true }).fill('业务乙');
  await page.screenshot({ path: '.runtime/artifacts/delivery-table/drawer-edit.png' });
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存 00001' }).waitFor();
  assert.equal(items[0].name, '修改后的采购报表');
  assert.equal(items[0].businessOwner, '业务乙');
  await mkdir('.runtime/artifacts/delivery-table', { recursive: true });
  await page.screenshot({ path: '.runtime/artifacts/delivery-table/drawer.png' });
  // Clicking another row switches the drawer; clicking elsewhere on the page closes it.
  await page.getByRole('button', { name: '查看 00002', exact: true }).click();
  await drawer.getByRole('heading', { name: '供应商未清项批量清账' }).waitFor();
  assert.doesNotMatch(await drawer.locator('.phase-track').innerText(), /%/);
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });

  // Column settings persist per user and project.
  await page.getByRole('button', { name: '显示', exact: true }).click();
  await page.getByLabel('显示业务功能点', { exact: true }).check();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '显示', exact: true }).click();
  assert.equal(await page.getByLabel('显示业务功能点', { exact: true }).isChecked(), true);
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();

  // Batch delete names the affected items and runs once for the whole selection.
  await page.getByRole('checkbox', { name: '选择 00001', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 00002', exact: true }).check();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认继续' }).click();
  await page.getByRole('status').filter({ hasText: '已删除 2 项' }).waitFor();
  assert.deepEqual(batches, [{ action: 'delete', ids: ['i0', 'i1'] }]);
  assert.deepEqual(errors, []);
});
