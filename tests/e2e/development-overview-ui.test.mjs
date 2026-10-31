import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { addDays } from '@sap-delivery-workbench/contracts/delivery/overview';
import { buildOverview } from '../../apps/api/src/modules/development-overview/routes.mjs';

const today = (() => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
})();
const phase = (status = 'not_started', extra = {}) => ({
  assigneeId: 'u',
  effortDays: 2,
  plannedStart: addDays(today, -10),
  plannedEnd: addDays(today, 10),
  actualStart: null,
  actualEnd: null,
  baselineEnd: null,
  progress: status === 'completed' ? 100 : 0,
  status,
  notes: '',
  ...extra,
});

// TEST-002: a number on the development overview opens the development list filtered to exactly
// the items it counted; the drill-down replaces the filters saved for the project and clears.
test('development overview: cards drill down to the list with the same count', async (t) => {
  // Every third item has a late development phase, every fifth a hand-set delay on its FSD.
  const items = Array.from({ length: 15 }, (_, n) => ({
    id: `i${n}`,
    code: String(n + 1).padStart(5, '0'),
    itemNo: n + 1,
    rowVersion: '1',
    createdBy: 'u',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    module: ['MM', 'SD', 'FICO'][n % 3],
    kind: 'report',
    name: '开发项 ' + (n + 1),
    businessFunction: '',
    priority: 'medium',
    difficulty: 'medium',
    changeType: 'new',
    registeredOn: today,
    businessOwner: '',
    notes: '',
    transactionCode: '',
    phases: {
      fsd: phase(n % 5 === 0 ? 'delayed' : 'completed'),
      development: phase(
        'in_progress',
        n % 3 === 0 ? { plannedEnd: addDays(today, -2), actualStart: addDays(today, -5) } : {},
      ),
      consultant_test: phase(),
      user_test: phase(),
    },
    objects: [],
    tags: [],
    custom: {},
  }));
  const grant = { has: () => true, sources: () => [] };
  const overview = buildOverview({
    items,
    people: [{ id: 'u', displayName: '张顾问', active: true }],
    facts: {
      milestones: [],
      budgetDays: null,
      finals: new Map(),
      activity: new Map(),
      drift: [],
      comments: [],
      devCoverage: new Map(),
      transitions: [],
    },
    today,
    grant,
    userId: 'u',
  });
  const risk = overview.cards.risk.count;
  assert.equal(risk, 7); // 0,3,6,9,12 late development; 5,10 delayed FSD (0 counted once)

  const server = await createServer({
    root: 'apps/web',
    server: { port: 5194, strictPort: true, hmr: false },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const access = {
    projectId: 'p1',
    permissions: ['project:view', 'delivery.item:view', 'delivery.overview:view'],
    limits: {},
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data = {};
    if (path === '/api/session')
      data = {
        authenticated: true,
        user: { id: 'u', displayName: '张顾问' },
        organization: { id: 'org', name: 'Inspire' },
        permissions: [],
      };
    else if (path === '/api/projects/p1/access') data = access;
    else if (path === '/api/projects/p1') data = { id: 'p1', milestones: [] };
    else if (path === '/api/projects')
      data = [{ id: 'p1', code: 'P1', name: '虚拟测试项目', status: 'active' }];
    else if (path === '/api/project-preference') data = { projectId: 'p1' };
    else if (path === '/api/projects/p1/development-overview') data = overview;
    else if (path === '/api/projects/p1/development-items')
      data = {
        items,
        members: [{ id: 'u', displayName: '张顾问', active: true }],
        tags: [],
        fields: [],
        readOnly: false,
        access,
      };
    else if (path === '/api/projects/p1/development-tags') data = [];
    await route.fulfill({ json: data });
  });

  // A filter saved for the project earlier (only SD items) must not narrow the drill-down.
  await page.goto('http://127.0.0.1:5194/workspace/development-items');
  await page.getByText(/ 共 15 项$/).waitFor();
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('delivery-filters:v2:'));
    const saved = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.setItem(key, JSON.stringify({ ...saved, moduleFilter: 'SD' }));
  });

  await page.goto('http://127.0.0.1:5194/workspace/development-overview');
  // Without a built-in role the page opens on 我的, which has no project cards.
  await page.getByRole('tab', { name: '项目', exact: true }).click();
  const card = page.getByRole('button', { name: /风险开发项/ });
  await card.waitFor();
  assert.match(await card.innerText(), new RegExp(`\\n${risk}\\n`));
  await mkdir('.runtime/artifacts/development-overview', { recursive: true });
  await page.screenshot({ path: '.runtime/artifacts/development-overview/overview.png' });
  await card.click();

  await page.waitForURL(/development-items\?from=overview/);
  assert.match(page.url(), /risk=any/);
  await page.getByRole('button', { name: '移除筛选 来自开发概览：风险' }).waitFor();
  await page.getByText(new RegExp(` 共 ${risk} 项$`)).waitFor();
  assert.equal(await page.getByRole('button', { name: /^移除筛选 模块/ }).count(), 0);
  await page.screenshot({ path: '.runtime/artifacts/development-overview/drill-down.png' });

  // Clearing the drill-down shows the whole list again.
  await page.getByRole('button', { name: '移除筛选 来自开发概览：风险' }).click();
  await page.getByText(/ 共 15 项$/).waitFor();
  assert.deepEqual(errors, []);
});
