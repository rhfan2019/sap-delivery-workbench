import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { addDays } from '@sap-delivery-workbench/contracts/delivery/overview';
import {
  baseOptions,
  defaultBase,
  loadRows,
  loadWindow,
  mondayOf,
} from '@sap-delivery-workbench/contracts/delivery/load';

const today = (() => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
})();
const monday = mondayOf(today);
const phase = (extra = {}) => ({
  assigneeId: null,
  effortDays: null,
  plannedStart: null,
  plannedEnd: null,
  actualStart: null,
  actualEnd: null,
  baselineEnd: null,
  progress: 0,
  status: 'not_started',
  notes: '',
  ...extra,
});

// docs/specs/development-load.md: a number opens the development list in the same tab with
// exactly the items it counted; the back button returns to the very same page, scrolled where
// it was, without loading it again.
test('development load: drill-down and back keep the page as it was', async (t) => {
  const people = Array.from({ length: 14 }, (_, n) => ({
    id: 'd' + n,
    name: '开发' + String(n + 1).padStart(2, '0'),
  }));
  // Every developer has items spread from six weeks back to eight weeks ahead; past ones done.
  const items = [];
  for (let n = 0; n < 220; n++) {
    const who = people[n % people.length];
    const due = addDays(monday, ((n * 3) % 98) - 42);
    const done = due < today && n % 5 !== 0;
    items.push({
      id: 'i' + n,
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
        fsd: phase({ status: 'completed' }),
        development: phase({
          assigneeId: n % 23 === 0 ? null : who.id,
          effortDays: 1 + (n % 4),
          plannedEnd: n % 17 === 0 ? null : due,
          actualEnd: done ? due : null,
          status: done ? 'completed' : 'in_progress',
        }),
        consultant_test: phase({ status: done && n % 2 ? 'completed' : 'not_started' }),
        user_test: phase(),
      },
      objects: [],
      tags: [],
      custom: {},
    });
  }
  const { totals, rows } = loadRows(items);
  const options = baseOptions(addDays(today, -120), addDays(today, 120), today);
  const load = {
    today,
    project: { start: addDays(today, -120), end: addDays(today, 120) },
    options,
    base: defaultBase(options, today),
    totals,
    people: people.map((p) => ({ id: p.id, name: p.name, active: true, sortCode: null })),
    rows,
  };

  const server = await createServer({
    root: 'apps/web',
    server: { port: 5195, strictPort: true, hmr: false },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let loads = 0;
  const access = {
    projectId: 'p1',
    permissions: ['project:view', 'delivery.item:view', 'delivery.load:view'],
    limits: {},
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = {};
    if (path === '/api/session')
      data = {
        authenticated: true,
        user: { id: 'u', displayName: '开发组长' },
        organization: { id: 'org', name: 'Inspire' },
        permissions: [],
      };
    else if (path === '/api/projects/p1/access') data = access;
    else if (path === '/api/projects/p1') data = { id: 'p1', milestones: [] };
    else if (path === '/api/projects')
      data = [{ id: 'p1', code: 'P1', name: '虚拟测试项目', status: 'active' }];
    else if (path === '/api/project-preference') data = { projectId: 'p1' };
    else if (path === '/api/projects/p1/development-load') {
      loads++;
      data = load;
    } else if (path === '/api/projects/p1/development-items')
      data = {
        items,
        members: people.map((p) => ({ id: p.id, displayName: p.name, active: true })),
        tags: [],
        fields: [],
        readOnly: false,
        access,
      };
    else if (path === '/api/projects/p1/development-tags') data = [];
    await route.fulfill({ json: data });
  });

  await page.goto('http://127.0.0.1:5195/workspace/development-load');
  const table = page.locator('.ld-table');
  await table.waitFor();
  assert.match(
    await page.locator('.ld-totals').innerText(),
    new RegExp(`总个数\\s*${totals.items}`),
  );
  assert.equal(await page.locator('.ld-table tbody tr').count(), people.length + 2); // 总计, TBD

  // Scroll the table both ways and mark its element, to tell the same page from a new one.
  const scroller = page.locator('.ld-scroll');
  await scroller.evaluate((e) => {
    e.scrollLeft = 640;
    e.scrollTop = 120;
    e.dataset.marker = 'kept';
  });
  const before = await scroller.evaluate((e) => [e.scrollLeft, e.scrollTop]);
  assert.ok(before[0] > 0 && before[1] > 0);
  await mkdir('.runtime/artifacts/development-load', { recursive: true });
  await page.screenshot({ path: '.runtime/artifacts/development-load/load.png' });

  // The last developer with items planned in the base week.
  const baseWeek = (p) =>
    loadWindow(rows.find((r) => r.id === p.id) ?? { weeks: {} }, load.base).weeks[1];
  const who = people.findLast((p) => rows.some((r) => r.id === p.id) && baseWeek(p).planned);
  const base = baseWeek(who);
  const row = page.locator('.ld-table tbody tr', { hasText: who.name });
  // Columns: name, unplanned, 4 total, 4 before, then 4 per week; the base week is the second.
  // Clicked in place: Playwright's own click would first scroll the table to the button.
  await row
    .locator('td')
    .nth(1 + 4 + 4 + 4 + 1)
    .locator('button')
    .evaluate((b) => b.click());
  await page.waitForURL(/development-items\?.*from=load/);
  assert.match(page.url(), new RegExp('assignee=' + who.id + '&'));
  await page
    .getByRole('button', { name: '移除筛选 来自开发排期：' + who.name, exact: false })
    .waitFor();
  await page.getByText(new RegExp(` 共 ${base.planned} 项$`)).waitFor();
  await page.screenshot({ path: '.runtime/artifacts/development-load/drill-down.png' });

  // Back: the same page instance, scrolled as before, nothing loaded again.
  await page.goBack();
  await page.waitForURL(/development-load/);
  await table.waitFor();
  assert.equal(await scroller.evaluate((e) => e.dataset.marker), 'kept');
  assert.deepEqual(await scroller.evaluate((e) => [e.scrollLeft, e.scrollTop]), before);
  assert.equal(loads, 1);
  assert.equal(await page.locator('[aria-busy="true"]').count(), 0);

  // The base date is in the address: another Monday moves the nine weeks without a request.
  const next = addDays(load.base, 14);
  await page.goto(`http://127.0.0.1:5195/workspace/development-load?week=${next}`);
  await table.waitFor();
  assert.match(
    await page.locator('.ld-table thead tr').first().innerText(),
    new RegExp(addDays(next, -7)),
  );
  assert.deepEqual(errors, []);
});
