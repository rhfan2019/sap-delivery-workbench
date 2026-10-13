import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
test('pending items: customer tabs, model drawer/default, menu navigation and delivery actions', async (t) => {
  const server = await createServer({
    root: 'apps/web',
    server: { port: 5188, strictPort: true, hmr: false },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const org = { id: 'org', code: 'INSPIRE', name: 'Inspire', rowVersion: '1', status: 'active' };
  const customers = [
    { id: 'c1', code: 'C1', name: '客户甲', status: 'active', customerKind: 'external' },
    { id: 'c2', code: 'C2', name: '客户乙', status: 'active', customerKind: 'external' },
  ];
  const projects = [
    {
      id: 'p1',
      code: 'P1',
      name: '采购项目',
      customerId: 'c1',
      customerName: '客户甲',
      status: 'active',
    },
    {
      id: 'p2',
      code: 'P2',
      name: '财务项目',
      customerId: 'c2',
      customerName: '客户乙',
      status: 'active',
    },
  ];
  let items = [
    {
      id: 'i1',
      code: '00001',
      itemNo: 1,
      name: '采购报表',
      module: 'MM',
      kind: 'report',
      priority: 'low',
      difficulty: 'medium',
      changeType: 'new',
      registeredOn: '2026-10-01',
      businessFunction: '',
      businessOwner: '',
      notes: '',
      transactionCode: '',
      rowVersion: '1',
      phases: Object.fromEntries(
        ['fsd', 'development', 'consultant_test', 'user_test'].map((k) => [
          k,
          {
            assigneeId: null,
            effortDays: null,
            plannedStart: null,
            plannedEnd: null,
            actualEnd: null,
            progress: 0,
            status: 'not_started',
            notes: '',
          },
        ]),
      ),
      objects: [],
      tags: [],
      custom: {},
    },
  ];
  const models = [1, 2].map((i) => ({
    id: 'm' + i,
    name: '测试模型' + i,
    provider: '本地测试',
    modelId: 'model-' + i,
    protocol: 'openai_chat',
    baseUrl: 'https://example.com',
    maxOutputTokens: 8192,
    timeoutSeconds: 60,
    temperature: null,
    rowVersion: '1',
    versionId: 'v' + i,
    versionNo: '1',
    credentialReady: true,
    isDefault: false,
    test: null,
  }));
  let defaultModel = null,
    tested = 0,
    deleted = 0,
    system = {
      id: 's1',
      name: '测试系统',
      code: 'S1',
      sapUrl: 'https://sap.invalid',
      language: 'EN',
      status: 'active',
      rowVersion: '1',
    };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method();
    let data = {};
    if (path === '/api/session')
      data = {
        user: { id: 'u', displayName: '测试用户' },
        organization: org,
        canManageOrganization: true,
        mustChangePassword: false,
      };
    else if (path === '/api/projects' || path === '/api/admin/projects') data = projects;
    else if (path === '/api/project-preference') data = { projectId: 'p1' };
    else if (path === '/api/admin/organization') data = org;
    else if (path === '/api/admin/customers') data = customers;
    else if (path === '/api/admin/sap-systems') data = [system];
    else if (path === '/api/admin/sap-systems/s1/test') {
      system = {
        ...system,
        rowVersion: '2',
        testStatus: 'passed',
        testMessage: '正常',
        backendVersion: 'SAP_BASIS 758',
        testedAt: new Date().toISOString(),
      };
      data = { status: 'passed', message: '正常', system };
    } else if (path === '/api/admin/models')
      data = { items: models, defaultModel, defaultRevision: '0' };
    else if (/\/admin\/models\/m\d\/test$/.test(path)) {
      const m = models.find((m) => path.includes('/' + m.id + '/'));
      m.test = {
        status: 'passed',
        message: '测试通过',
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
      };
      tested++;
      data = { status: 'passed', message: '测试通过' };
    } else if (/\/admin\/models\/m\d\/default$/.test(path)) {
      const m = models.find((m) => path.includes('/' + m.id + '/'));
      m.isDefault = true;
      defaultModel = { id: m.id, versionId: m.versionId, name: m.name };
      data = { ok: true };
    } else if (path === '/api/projects/p1/development-items')
      data = { items, members: [], tags: [], fields: [], readOnly: false, isAdmin: true };
    else if (path === '/api/projects/p1/development-items/batch' && method === 'POST') {
      const ids = route.request().postDataJSON().ids;
      items = items.filter((i) => !ids.includes(i.id));
      deleted += ids.length;
      data = { count: ids.length, ids };
    } else if (path.endsWith('/files') || path.endsWith('/events')) data = [];
    await route.fulfill({ json: data });
  });
  try {
    await page.goto('http://127.0.0.1:5188/workspace/organization');
    await page.getByRole('heading', { name: '客户甲', exact: true }).waitFor();
    await mkdir('.runtime/artifacts/todo-implementation-20261004', { recursive: true });
    await page.screenshot({
      path: '.runtime/artifacts/todo-implementation-20261004/customers.png',
      fullPage: true,
    });
    assert.equal(await page.locator('.organization-summary').count(), 0);
    assert.equal(await page.locator('.relation-tree').count(), 0);
    await page.getByRole('button', { name: '项目', exact: true }).click();
    await page.locator('.tree-customer-line .tree-node').filter({ hasText: '客户甲' }).click();
    await page.screenshot({
      path: '.runtime/artifacts/todo-implementation-20261004/projects.png',
      fullPage: true,
    });
    assert.equal(await page.locator('.related-projects tbody tr').count(), 1);
    assert.equal(await page.locator('.tree-customer-line .count-badge').count(), 0);
    await page.getByRole('link', { name: '企业资料', exact: true }).click();
    await page.getByRole('button', { name: '编辑企业资料' }).waitFor();
    await page.getByRole('link', { name: '大模型(LLM)', exact: true }).click();
    await page.getByRole('button', { name: '测试模型1', exact: true }).click();
    await page.locator('.model-drawer[open]').waitFor();
    assert.equal(await page.getByRole('heading', { name: '默认调用参数', exact: true }).count(), 0);
    assert.equal(await page.locator('.model-drawer input[type="number"]').count(), 0);
    await page.getByRole('button', { name: '测试模型2', exact: true }).click();
    await page.locator('.model-drawer input').first().waitFor();
    assert.equal(await page.locator('.model-drawer input').first().inputValue(), '测试模型2');
    await page.locator('.model-drawer input').first().fill('未保存');
    await page.getByRole('button', { name: '测试模型1', exact: true }).click();
    await page.getByRole('button', { name: '取消，保留当前内容' }).click();
    assert.equal(await page.locator('.model-drawer input').first().inputValue(), '未保存');
    await page.getByRole('button', { name: '测试模型1', exact: true }).click();
    await page.getByRole('button', { name: '确认继续' }).click();
    assert.equal(await page.locator('.model-drawer input').first().inputValue(), '测试模型1');
    assert.equal(await page.getByText('FS 结构化测试', { exact: true }).count(), 0);
    await page
      .locator('.model-table tbody tr')
      .first()
      .getByRole('button', { name: '测试', exact: true })
      .click();
    await page.getByRole('status').filter({ hasText: '测试通过' }).first().waitFor();
    assert.equal(tested, 1);
    await page.getByRole('button', { name: '设为默认：测试模型2', exact: true }).click();
    await page.getByRole('button', { name: '确认继续' }).click();
    await page.getByRole('status').filter({ hasText: '组织默认模型已更新' }).waitFor();
    assert.equal(tested, 2);
    assert.equal(defaultModel.id, 'm2');
    await mkdir('.runtime/artifacts/todo-implementation-20261004', { recursive: true });
    await page.screenshot({
      path: '.runtime/artifacts/todo-implementation-20261004/models.png',
      fullPage: true,
    });
    await page.getByRole('link', { name: '开发清单', exact: true }).click();
    await page.getByRole('link', { name: '设计', exact: true }).waitFor();
    // Bulk deletion is only offered after selecting rows.
    assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0);
    assert.match(
      await page.getByRole('link', { name: '设计', exact: true }).getAttribute('href'),
      /\/projects\/p1\/development-items\/i1\/design$/,
    );
    await page.getByRole('button', { name: '开发', exact: true }).click();
    await page.getByText('“开发”Agent 即将开发').waitFor();
    await page.getByRole('checkbox', { name: '选择 00001', exact: true }).check();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认继续' }).click();
    await page.getByRole('status').filter({ hasText: '已删除 1 项' }).waitFor();
    assert.equal(deleted, 1);
    await page.goto('http://127.0.0.1:5188/workspace/connections');
    await page.getByRole('button', { name: '测试', exact: true }).click();
    await page.getByLabel('Client', { exact: true }).fill('100');
    await page.getByLabel('用户', { exact: true }).fill('TEST');
    await page.getByLabel('密码', { exact: true }).fill('private');
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await page.locator('.sap-test-state.passed').waitFor();
    assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), '');
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.reload();
    await page.getByText('SAP_BASIS 758', { exact: true }).waitFor();
    await page.screenshot({
      path: '.runtime/artifacts/todo-implementation-20261004/sap.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
