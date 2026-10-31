import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { entryOf, moduleOf } from '../features/navigation';

// Browser-like tabs for the workbench (docs/specs/workbench-tabs.md). Each tab is an address with
// a page of its own; the address bar always shows the current tab. Remembered per user in this
// browser.
export interface Tab {
  id: string;
  path: string;
  // The page this tab showed before a link opened another page in it: kept alive, so the back
  // button returns to it as it was (workbench-tabs.md 4).
  back?: string;
}
export const tabs = ref<Tab[]>([]);
export const activeTabId = ref('');
export const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value));

const home = '/home';
// The pages a tab keeps while another tab is in front: every page but a development item's
// assistants, which stay as they were until FEAT-007.
export const isRecord = (path: string) => path.includes('/development-items/');
// One page instance per address; `?session=` and the like switch inside a page instead.
export const pageKey = (
  route: Pick<RouteLocationNormalizedLoaded, 'meta' | 'path' | 'fullPath'>,
) => (route.meta.keepOnQuery ? route.path : route.fullPath);

export function tabLabel(fullPath: string) {
  const path = fullPath.split(/[?#]/)[0]!;
  if (isRecord(path)) return path.endsWith('/development') ? '开发助手' : '设计助手';
  if (path === '/settings') return '设置';
  return entryOf(path)?.label ?? moduleOf(path).label;
}
export function tabIcon(fullPath: string) {
  const path = fullPath.split(/[?#]/)[0]!;
  if (isRecord(path)) return path.endsWith('/development') ? 'code' : 'file';
  return entryOf(path)?.icon ?? moduleOf(path).icon;
}

let router: Router | null = null;
let storageKey = '';
let stopHook: (() => void) | null = null;
let stopSave: (() => void) | null = null;
// The navigation a tab action started; `afterEach` applies it once the page is there.
let pending: { id: string; open?: number } | null = null;
const switching = ref(false);
const newId = () => Math.random().toString(36).slice(2, 10);
const inShell = (route: RouteLocationNormalizedLoaded) => route.matched[0]?.path === '/';

function load(): { tabs: Tab[]; active: string } | null {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!Array.isArray(data?.tabs)) return null;
    // A page left behind is not remembered: after a reload nothing of it is alive any more.
    const list = (data.tabs as Tab[])
      .filter(
        (t) => typeof t?.id === 'string' && typeof t?.path === 'string' && t.path.startsWith('/'),
      )
      .map((t) => ({ id: t.id, path: t.path }));
    return { tabs: list, active: String(data.active ?? '') };
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ tabs: tabs.value, active: activeTabId.value }),
    );
  } catch {
    // Storage may be refused; the tabs then last for this page only.
  }
}

// The shell starts the tabs for the signed-in user. The address being opened becomes the
// current tab: the remembered tab with that address, or a new one (a link from elsewhere).
export function startTabs(r: Router, userId: string) {
  stopTabs();
  router = r;
  storageKey = `workbench-tabs:${userId}`;
  const stored = load();
  tabs.value = stored?.tabs ?? [];
  const current = r.currentRoute.value.fullPath;
  const same =
    tabs.value.find((t) => t.id === stored?.active && t.path === current) ??
    tabs.value.find((t) => t.path === current);
  if (same) activeTabId.value = same.id;
  else {
    const tab = { id: newId(), path: current };
    const at = tabs.value.findIndex((t) => t.id === stored?.active);
    tabs.value.splice(at < 0 ? tabs.value.length : at + 1, 0, tab);
    activeTabId.value = tab.id;
  }
  stopHook = r.afterEach((to, _from, failure) => {
    const action = pending;
    pending = null;
    if (failure || !inShell(to)) return;
    if (action?.open !== undefined) {
      tabs.value.splice(action.open, 0, { id: action.id, path: to.fullPath });
      activeTabId.value = action.id;
      return;
    }
    if (action) activeTabId.value = action.id;
    const tab = activeTab.value;
    if (!tab) return;
    if (!action && pageKey(r.resolve(tab.path)) !== pageKey(to)) tab.back = tab.path;
    tab.path = to.fullPath;
  });
  stopSave = watch([tabs, activeTabId], save, { deep: true, immediate: true });
}
export function stopTabs() {
  stopHook?.();
  stopSave?.();
  stopHook = stopSave = null;
}

// A navigation that only brings another tab to the front: the page being left stays alive in
// its tab, so its “unsaved changes” guard lets it pass.
export const switchingTab = () => switching.value;
async function go(path: string, action: { id: string; open?: number }) {
  if (!router) return false;
  pending = action;
  switching.value = true;
  try {
    const failure = await router.push(path);
    return !failure;
  } catch {
    return false;
  } finally {
    pending = null;
    switching.value = false;
  }
}

export async function activateTab(id: string) {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab || id === activeTabId.value) return !!tab;
  // Two tabs on one address: the address stays, only the page in front changes.
  if (tab.path === router?.currentRoute.value.fullPath) {
    activeTabId.value = id;
    return true;
  }
  return go(tab.path, { id });
}

// Opens an address in a new tab right of the current one and brings it to the front.
export async function openInNewTab(path: string) {
  if (!router) return false;
  const at = tabs.value.findIndex((t) => t.id === activeTabId.value) + 1;
  const id = newId();
  const target = router.resolve(path).fullPath;
  if (target === router.currentRoute.value.fullPath) {
    tabs.value.splice(at, 0, { id, path: target });
    activeTabId.value = id;
    return true;
  }
  return go(target, { id, open: at });
}

// A menu entry has one tab (workbench-tabs.md 2, 3): opening it from the menu, a module, the
// command palette or the settings search brings its tab forward, the one on exactly its address
// first, else one on a page of it (a user's details belong to “用户”); only without one does a
// tab open.
const pathOf = (fullPath: string) => fullPath.split(/[?#]/)[0]!;
export async function openPage(path: string) {
  if (!router) return false;
  const target = pathOf(router.resolve(path).fullPath);
  const entry = entryOf(target)?.id;
  const tab =
    tabs.value.find((t) => pathOf(t.path) === target) ??
    (entry ? tabs.value.find((t) => entryOf(pathOf(t.path))?.id === entry) : undefined);
  return tab ? activateTab(tab.id) : openInNewTab(path);
}

// A page with unsaved changes asks before its tab closes (the shared confirmation dialog).
const leaveChecks = new Map<string, () => Promise<boolean> | boolean>();
export function useTabLeave(check: () => Promise<boolean> | boolean) {
  const id = activeTabId.value;
  leaveChecks.set(id, check);
  onBeforeUnmount(() => {
    if (leaveChecks.get(id) === check) leaveChecks.delete(id);
  });
}

// Closing the current tab brings the one on its right forward, else the one on its left; the
// last tab gives way to a fresh home tab, so one always stays open.
export async function closeTab(id: string) {
  const index = tabs.value.findIndex((t) => t.id === id);
  if (index < 0) return false;
  const check = leaveChecks.get(id);
  if (check) {
    if (!(await activateTab(id))) return false;
    if (!(await check())) return false;
  }
  if (id === activeTabId.value) {
    const next = tabs.value[index + 1] ?? tabs.value[index - 1];
    const moved = next ? await activateTab(next.id) : await openInNewTab(home);
    if (!moved) return false;
  }
  tabs.value = tabs.value.filter((t) => t.id !== id);
  return true;
}
export async function closeOtherTabs(id: string) {
  for (const tab of tabs.value.filter((t) => t.id !== id))
    if (!(await closeTab(tab.id))) return false;
  return activateTab(id);
}
export async function closeTabsRight(id: string) {
  const index = tabs.value.findIndex((t) => t.id === id);
  for (const tab of tabs.value.slice(index + 1)) if (!(await closeTab(tab.id))) return false;
  return true;
}

// The in-app address of the link an event happened on, for the shell's “open in a new tab”.
export function linkPath(target: EventTarget | null) {
  const a = (target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return '';
  const url = new URL(a.href, location.href);
  return url.origin === location.origin ? url.pathname + url.search + url.hash : '';
}
