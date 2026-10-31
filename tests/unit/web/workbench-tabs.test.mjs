import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../apps/web/', import.meta.url));
const page = { render: () => null };

// docs/specs/workbench-tabs.md 2, 3, 5, 6: tabs open right of the current one, follow the address,
// share one settings tab, close towards the right, keep one tab open and come back for the same
// user.
test('workbench tabs open, follow, close and come back', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const t = await vite.ssrLoadModule('/src/services/tabs.ts');
    const { createMemoryHistory, createRouter } = await vite.ssrLoadModule('vue-router');
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: page },
        {
          path: '/',
          component: page,
          children: [
            { path: 'home', component: page },
            { path: 'settings', component: page },
            { path: 'settings/users', component: page },
            { path: 'settings/users/:id', component: page },
            { path: 'workspace/development-items', component: page, meta: { keepOnQuery: true } },
            { path: 'workspace/development-load', component: page },
            { path: 'workspace/development-overview', component: page },
            { path: 'projects/:p/development-items/:i/design', component: page },
          ],
        },
      ],
    });
    await router.push('/workspace/development-items');
    t.startTabs(router, 'u1');
    const labels = () => t.tabs.value.map((x) => t.tabLabel(x.path));
    const active = () => t.tabLabel(t.activeTab.value.path);
    assert.deepEqual(labels(), ['开发清单']);

    // A new tab opens right of the current one and comes to the front.
    await t.openInNewTab('/workspace/development-load');
    await t.activateTab(t.tabs.value[0].id);
    await t.openInNewTab('/workspace/development-overview');
    assert.deepEqual(labels(), ['开发清单', '开发概览', '开发排期']);
    assert.equal(active(), '开发概览');
    assert.equal(router.currentRoute.value.fullPath, '/workspace/development-overview');

    // A menu entry has one tab: clicking it again brings that tab forward instead of adding one;
    // a new entry opens right of the current tab.
    await t.openPage('/workspace/development-load');
    assert.deepEqual(labels(), ['开发清单', '开发概览', '开发排期']);
    assert.equal(active(), '开发排期');
    await t.openPage('/workspace/development-items');
    assert.equal(active(), '开发清单');
    assert.equal(t.tabs.value.length, 3);
    await t.activateTab(t.tabs.value[2].id);
    await t.openPage('/home');
    assert.deepEqual(labels(), ['开发清单', '开发概览', '开发排期', '工作台']);
    await router.push('/workspace/development-load');
    assert.deepEqual(labels(), ['开发清单', '开发概览', '开发排期', '开发排期']);
    await t.closeTab(t.activeTab.value.id);
    assert.equal(t.tabs.value.length, 3);

    // Settings pages share one tab (UI-012): the menu, a new-tab request and a link from another
    // page all go there; the page the link was on stays in its tab.
    await t.openPage('/settings');
    assert.equal(t.tabs.value.length, 4);
    const settings = t.activeTab.value.id;
    await t.openPage('/settings/users');
    await t.openInNewTab('/settings/users/42');
    assert.equal(t.tabs.value.length, 4);
    assert.equal(t.activeTab.value.id, settings);
    assert.equal(t.tabNote(t.activeTab.value.path), '用户');
    await t.activateTab(t.tabs.value[0].id);
    await router.push('/settings');
    assert.equal(t.activeTab.value.id, settings);
    assert.equal(t.tabs.value[0].path, '/workspace/development-items');
    assert.equal(t.tabs.value.length, 4);
    await t.activateTab(t.tabs.value[0].id);
    await t.openPage('/settings/users');
    assert.equal(t.activeTab.value.id, settings);
    assert.equal(router.currentRoute.value.fullPath, '/settings/users');
    await t.closeTab(settings);

    // Back and forward walk one history for all tabs: an address another tab shows brings that
    // tab forward instead of becoming this tab's (UI-010).
    await t.activateTab(t.tabs.value[1].id);
    await t.activateTab(t.tabs.value[2].id);
    router.back();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(labels(), ['开发清单', '开发概览', '开发排期']);
    assert.equal(active(), '开发概览');

    // A plain navigation changes the current tab; pages outside the shell leave tabs alone.
    await router.push('/home');
    assert.deepEqual(labels(), ['开发清单', '工作台', '开发排期']);
    await router.push('/login');
    await router.push('/home');
    assert.deepEqual(labels(), ['开发清单', '工作台', '开发排期']);

    // Two tabs on one address both stay; switching between them keeps the address.
    await t.openInNewTab('/home');
    assert.equal(t.tabs.value.length, 4);
    assert.equal(router.currentRoute.value.fullPath, '/home');

    // Closing the current tab brings the right one forward, else the left; the last gives way
    // to a fresh home tab.
    await t.activateTab(t.tabs.value[1].id);
    await t.closeTab(t.activeTab.value.id);
    assert.deepEqual(labels(), ['开发清单', '工作台', '开发排期']);
    assert.equal(t.activeTab.value.id, t.tabs.value[1].id);
    await t.closeTabsRight(t.tabs.value[0].id);
    assert.deepEqual(labels(), ['开发清单']);
    assert.equal(router.currentRoute.value.fullPath, '/workspace/development-items');
    await t.closeTab(t.tabs.value[0].id);
    assert.deepEqual(labels(), ['工作台']);
    assert.equal(router.currentRoute.value.fullPath, '/home');

    // The tabs come back for the same user, with the address being opened in front; settings
    // tabs remembered from before they shared one come back as one.
    await t.openInNewTab('/settings');
    await new Promise((r) => setTimeout(r));
    t.stopTabs();
    t.startTabs(router, 'u1');
    assert.deepEqual(labels(), ['工作台', '设置']);
    assert.equal(active(), '设置');
    t.stopTabs();
    localStorage.setItem(
      'workbench-tabs:u3',
      JSON.stringify({
        tabs: [
          { id: 'a', path: '/settings/users' },
          { id: 'b', path: '/home' },
          { id: 'c', path: '/settings' },
        ],
        active: 'c',
      }),
    );
    t.startTabs(router, 'u3');
    assert.deepEqual(
      t.tabs.value.map((x) => x.id),
      ['b', 'c'],
    );
    t.stopTabs();
    t.startTabs(router, 'u2');
    assert.deepEqual(labels(), ['设置']);
    t.stopTabs();

    // Labels: a record page names its assistant; the settings overview is “设置”.
    assert.equal(t.tabLabel('/projects/a/development-items/b/design?session=s'), '设计助手');
    assert.equal(t.tabLabel('/projects/a/development-items/b/development'), '开发助手');
    assert.ok(t.isRecord('/projects/a/development-items/b/design'));
    assert.equal(
      t.pageKey({ meta: { keepOnQuery: true }, path: '/x', fullPath: '/x?item=1' }),
      '/x',
    );
  } finally {
    await vite.close();
    delete globalThis.localStorage;
  }
});
