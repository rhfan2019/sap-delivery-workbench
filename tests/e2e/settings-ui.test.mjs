import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

// The settings area (docs/specs/project-access-admin.md 4): menu and overview by permission,
// settings search, customers, the model drawer, a project's SAP systems with a personal login,
// and the development list's actions under project permissions.
test('settings: menu by permission, customers, models, project SAP login and list actions', async (t) => {
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
    {
      id: 'c1',
      code: 'C1',
      name: '客户甲',
      status: 'active',
      customerKind: 'external',
      projectCount: 1,
    },
    {
      id: 'c2',
      code: 'C2',
      name: '客户乙',
      status: 'active',
      customerKind: 'external',
      projectCount: 1,
    },
  ];
  const projects = [
    {
      id: 'p1',
      code: 'P1',
      name: '采购项目',
      shortName: '采购',
      customerId: 'c1',
      customerName: '客户甲',
      status: 'active',
    },
    {
      id: 'p2',
      code: 'P2',
      name: '财务项目',
      shortName: '',
      customerId: 'c2',
      customerName: '客户乙',
      status: 'active',
    },
  ];
  const access = {
    projectId: 'p1',
    permissions: [
      'project:view',
      'project.member:view',
      'project.sap:view',
      'project.sap:manage',
      'delivery.item:view',
      'delivery.item:create',
      'delivery.item:edit',
      'delivery.item:delete',
      'delivery.item:export',
      'sap.development:read',
      'sap.test:read',
      // The development list links an assistant only for those who may run it (c16f934).
      'agent.fsd:run',
    ],
    limits: {},
  };
  const phase = () => ({
    assigneeId: null,
    effortDays: null,
    plannedStart: null,
    plannedEnd: null,
    actualEnd: null,
    progress: 0,
    status: 'not_started',
    notes: '',
  });
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
      createdBy: 'u',
      rowVersion: '1',
      phases: Object.fromEntries(
        ['fsd', 'development', 'consultant_test', 'user_test'].map((k) => [k, phase()]),
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
    deleted = 0;
  let system = {
    id: 's1',
    projectId: 'p1',
    name: 'S/4 开发 100',
    purpose: 'development',
    sid: 'S4D',
    sapUrl: 'https://sap.invalid',
    client: '100',
    language: 'ZH',
    description: '',
    isDefault: true,
    status: 'active',
    testStatus: null,
    testMessage: null,
    testedAt: null,
    backendVersion: null,
    rowVersion: '1',
    canRead: true,
    credential: { state: 'none', username: '' },
  };
  const credentials = [];
  const projectDetail = {
    ...projects[0],
    projectType: 'implementation',
    isPaused: false,
    description: '',
    plannedStartDate: null,
    plannedEndDate: null,
    methodology: 'activate',
    contractRole: 'prime',
    primeContractor: '',
    sapProduct: 's4_onpremise',
    sapRelease: '',
    deployment: null,
    modules: ['MM'],
    language: 'ZH',
    namespace: 'Z',
    defaultPackage: '',
    transportMethod: null,
    keyRoles: { manager: null, director: null, architect: null, devLead: null, basisLead: null },
    phases: [],
    currentPhase: null,
    milestones: [
      {
        id: 'm1',
        key: 'code_freeze',
        name: '开发冻结',
        phaseKey: 'realize',
        plannedOn: null,
        achievedOn: null,
        notes: '',
        rowVersion: '1',
      },
    ],
    moduleLeads: [],
    contacts: [],
    health: [],
    healthStale: true,
    members: [{ id: 'u', displayName: '测试用户' }],
    access,
    rowVersion: '1',
  };
  const sapView = () => ({
    projectId: 'p1',
    readOnly: false,
    canManage: true,
    canSave: true,
    policy: { maxDays: 30, idleDays: 14 },
    profileLogin: false,
    systems: [system],
  });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method();
    let data = {};
    if (path === '/api/session')
      data = {
        authenticated: true,
        user: { id: 'u', displayName: '测试用户' },
        organization: org,
        mustChangePassword: false,
        // A platform configurator with customer rights, without user or role administration.
        permissions: [
          'org.profile:view',
          'customer:view',
          'customer:manage',
          'model:view',
          'model:manage',
        ],
      };
    else if (path === '/api/projects') data = projects;
    else if (path === '/api/projects/p1/access') data = access;
    else if (path === '/api/project-preference') data = { projectId: 'p1' };
    else if (path === '/api/admin/organization') data = org;
    else if (path === '/api/admin/customers') data = customers;
    else if (path === '/api/projects/p1/sap-systems') data = sapView();
    else if (path === '/api/projects/p1/sap-systems/s1/credential' && method === 'PUT') {
      const body = req.postDataJSON();
      credentials.push(body);
      system = { ...system, credential: { state: body.mode, username: body.username } };
      data = sapView();
    } else if (path === '/api/projects/p1/sap-systems/s1/test') {
      system = {
        ...system,
        testStatus: 'passed',
        testMessage: '正常',
        backendVersion: 'SAP_BASIS 758',
        testedAt: new Date().toISOString(),
      };
      data = { status: 'passed', message: '正常', version: 'SAP_BASIS 758' };
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
      data = { items, members: [], tags: [], fields: [], readOnly: false, access };
    else if (path === '/api/projects/p1') data = projectDetail;
    else if (path === '/api/projects/p1/development-items/batch' && method === 'POST') {
      const ids = route.request().postDataJSON().ids;
      items = items.filter((i) => !ids.includes(i.id));
      deleted += ids.length;
      data = { count: ids.length, ids };
    } else if (path.endsWith('/files') || path.endsWith('/events')) data = [];
    await route.fulfill({ json: data });
  });
  try {
    await mkdir('.runtime/artifacts/settings-ui', { recursive: true });
    await page.goto('http://127.0.0.1:5188/settings');
    await page.getByRole('heading', { name: '设置', exact: true, level: 1 }).waitFor();
    const menu = page.getByRole('navigation', { name: '设置菜单' });
    // Planned pages are listed; pages the user may not open are not. Groups fold: personal and
    // project start open, the rest closed; the page header names the place.
    await menu.getByRole('link', { name: /通知/ }).waitFor();
    await menu.getByRole('button', { name: '项目', exact: true, expanded: true }).waitFor();
    await menu.getByRole('button', { name: '智能体', exact: true, expanded: false }).waitFor();
    await page.getByRole('navigation', { name: '当前位置' }).getByText('设置').waitFor();
    // A module icon on the rail opens a folded menu again (backlog BUG-006).
    await page.getByRole('button', { name: '收起菜单', exact: true }).click();
    await page.locator('.menu-hidden').waitFor();
    await page
      .getByRole('complementary', { name: '模块' })
      .getByRole('link', { name: '设置' })
      .click();
    await page.locator('.menu-hidden').waitFor({ state: 'detached' });
    assert.equal(await menu.isVisible(), true);
    // Notifications sit at the foot of the rail (backlog UI-001).
    await page.getByRole('button', { name: '通知', exact: true }).click();
    await page
      .getByRole('region', { name: '通知' })
      .getByText(/暂无通知/)
      .waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await menu.getByRole('link', { name: '用户', exact: true }).count(), 0);
    assert.equal(await menu.getByRole('link', { name: '角色与权限', exact: true }).count(), 0);
    assert.equal(await menu.getByRole('link', { name: '规模与商务', exact: true }).count(), 0);
    await page.screenshot({ path: '.runtime/artifacts/settings-ui/overview.png', fullPage: true });
    // Searching the settings menu and opening the first match with Enter.
    await page.getByLabel('搜索设置').fill('客户');
    await page.getByLabel('搜索设置').press('Enter');
    await page.getByRole('heading', { name: '客户', exact: true, level: 1 }).waitFor();
    await page.getByText('客户甲', { exact: true }).waitFor();
    await page.getByLabel('搜索设置').fill('');
    await menu.getByRole('link', { name: /通知/ }).click();
    await page.getByRole('heading', { name: '通知', exact: true, level: 1 }).waitFor();
    await menu.getByRole('button', { name: '智能体', exact: true }).click();
    await menu.getByRole('link', { name: '大模型', exact: true }).click();
    await page.getByRole('button', { name: '测试模型1', exact: true }).click();
    await page.locator('.s-drawer[open]').waitFor();
    assert.equal(await page.getByRole('heading', { name: '默认调用参数', exact: true }).count(), 0);
    assert.equal(await page.locator('.s-drawer input[type="number"]').count(), 0);
    await page.getByRole('button', { name: '测试模型2', exact: true }).click();
    await page.locator('.s-drawer input').first().waitFor();
    assert.equal(await page.locator('.s-drawer input').first().inputValue(), '测试模型2');
    // A row opens the record to read; 编辑 switches the same drawer, 取消 goes back
    // (development-discipline.md 4.1).
    const foot = page.locator('.s-drawer-foot');
    assert.ok(await page.locator('.s-drawer input').first().isDisabled());
    assert.equal(await foot.getByRole('button', { name: '保存', exact: true }).count(), 0);
    await foot.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('.s-drawer input').first().fill('未保存');
    await foot.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.locator('.s-drawer input').first().inputValue(), '测试模型2');
    assert.ok(await page.locator('.s-drawer input').first().isDisabled());
    await foot.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('.s-drawer input').first().fill('未保存');
    await page.getByRole('button', { name: '测试模型1', exact: true }).click();
    await page.getByRole('button', { name: '取消，保留当前内容' }).click();
    assert.equal(await page.locator('.s-drawer input').first().inputValue(), '未保存');
    await page.getByRole('button', { name: '测试模型1', exact: true }).click();
    await page.getByRole('button', { name: '确认继续' }).click();
    assert.equal(await page.locator('.s-drawer input').first().inputValue(), '测试模型1');
    await page
      .locator('.s-table tbody tr')
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
    await page.screenshot({ path: '.runtime/artifacts/settings-ui/models.png', fullPage: true });

    // A project's SAP system stores no password; the user logs in with their own SAP user.
    await page.goto('http://127.0.0.1:5188/settings/project/sap');
    await page.getByText('S/4 开发 100').first().waitFor();
    // Project pages carry the project switcher in the page header.
    await page.getByRole('button', { name: '切换项目' }).getByText('采购').waitFor();
    // The list reads like 大模型 (DESIGN.md 6.2): testing needs the user's own login first.
    const sapRow = page.locator('.s-table tbody tr').first();
    assert.equal(
      await sapRow.getByRole('button', { name: '测试', exact: true }).isDisabled(),
      true,
    );
    await sapRow.getByRole('button', { name: '登录', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('SAP 用户').fill('DEV01');
    await dialog.getByLabel('密码').fill('private');
    await dialog.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('已加密保存 · DEV01').waitFor();
    assert.deepEqual(credentials, [{ username: 'DEV01', password: 'private', mode: 'saved' }]);
    await sapRow.getByRole('button', { name: '测试', exact: true }).click();
    await page
      .getByText(/SAP_BASIS 758/)
      .first()
      .waitFor();
    await page.screenshot({
      path: '.runtime/artifacts/settings-ui/project-sap.png',
      fullPage: true,
    });

    // The icon rail switches module; 开发管理 opens the development list.
    await page.getByRole('link', { name: '开发管理', exact: true }).click();
    await page
      .getByRole('link', { name: '设计 00001', exact: true })
      .waitFor({ state: 'attached' });
    // Bulk deletion is only offered after selecting rows.
    assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0);
    assert.match(
      await page.getByRole('link', { name: '设计 00001', exact: true }).getAttribute('href'),
      /\/projects\/p1\/development-items\/i1\/design$/,
    );
    await page.getByRole('checkbox', { name: '选择 00001', exact: true }).check();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认继续' }).click();
    await page.getByRole('status').filter({ hasText: '已删除 1 项' }).waitFor();
    assert.equal(deleted, 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
