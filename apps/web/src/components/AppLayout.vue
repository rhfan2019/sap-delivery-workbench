<script setup lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMediaQuery } from '@vueuse/core';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Link,
  Menu,
  PanelLeft,
  Search,
  SquarePlus,
} from '@lucide/vue';
import AppContextMenu, { type ContextItem } from './AppContextMenu.vue';
import AppIcon from './AppIcon.vue';
import AppTabs from './AppTabs.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import CommandPalette from './CommandPalette.vue';
import NotificationButton from './NotificationButton.vue';
import ProjectSwitcher from './ProjectSwitcher.vue';
import UserMenu from './UserMenu.vue';
import BaseDialog from './base/BaseDialog.vue';
import BaseIconButton from './base/BaseIconButton.vue';
import BaseKbd from './base/BaseKbd.vue';
import BaseNavItem from './base/BaseNavItem.vue';
import BaseResizeHandle from './base/BaseResizeHandle.vue';
import BaseToaster from './base/BaseToaster.vue';
import { toast } from './base/toast';
import { modules, moduleOf, entryOf, visibleSections } from '../features/navigation';
import { api, identity } from '../services/session';
import { detailOpen } from '../services/shell';
import { useShortcut } from '../services/shortcuts';
import {
  projectAccess,
  projectError,
  loadProjects,
  leaveDelivery,
} from '../services/projectContext';
import {
  activeTabId,
  isRecord,
  linkPath,
  openInNewTab,
  pageKey,
  startTabs,
  stopTabs,
  tabs,
} from '../services/tabs';

// The shell (DESIGN.md 4.1): icon rail, the current module's menu, and the content panel. A record
// page (a development item and its assistants) folds the menu away, as Plain does for a thread.
const route = useRoute();
const router = useRouter();
const module = computed(() => moduleOf(route.path));
// Only what the user may open is listed (docs/specs/project-access-admin.md 4.3).
const sections = computed(() =>
  visibleSections(module.value.sections, {
    organization: identity.value?.permissions ?? [],
    project: projectAccess.value,
  }),
);
const activeEntry = computed(() => entryOf(route.path));
const activeSection = computed(() =>
  sections.value.find((s) => s.items.some((i) => i.id === activeEntry.value?.id)),
);
// The page header (DESIGN.md 4.1): the project switcher where the page works on the current
// project, then the module and the page; organization and personal settings carry no switcher.
const projectScoped = computed(
  () => module.value.id !== 'settings' || activeSection.value?.id === 'project',
);
const crumbs = computed(() => {
  const entry = activeEntry.value;
  if (module.value.id === 'settings') {
    const section = activeSection.value;
    const list = [{ label: '设置', to: entry?.id === 'settings' ? undefined : '/settings' }];
    if (section?.label) list.push({ label: section.label, to: undefined });
    if (entry && entry.id !== 'settings')
      list.push({ label: entry.label, to: route.path === entry.path ? undefined : entry.path });
    return list;
  }
  const list = [{ label: module.value.label, to: undefined as string | undefined }];
  if (entry && entry.label !== module.value.label)
    list.push({ label: entry.label, to: route.path === entry.path ? undefined : entry.path });
  return list;
});
// The settings menu filters itself as you type (Plain's “Search settings”).
const filter = ref('');
watch(module, () => (filter.value = ''));
// Menu groups fold (DESIGN.md 4.2). Personal and project start open, the rest closed; opening a
// page opens its group, and every group shows while searching. Remembered per browser.
const defaultClosed = ['organization', 'agents', 'operations'];
function storedGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('shell-menu-groups') ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}
const groupOpen = ref(storedGroups());
function isOpen(id: string) {
  if (filter.value.trim()) return true;
  return groupOpen.value[id] ?? !defaultClosed.includes(id);
}
function setGroup(id: string, open: boolean) {
  groupOpen.value = { ...groupOpen.value, [id]: open };
  try {
    localStorage.setItem('shell-menu-groups', JSON.stringify(groupOpen.value));
  } catch {
    // Storage may be refused; the choice then lasts for this page only.
  }
}
const toggleGroup = (id: string) => setGroup(id, !isOpen(id));
watch(
  () => activeSection.value?.id,
  (id) => {
    if (id && !isOpen(id)) setGroup(id, true);
  },
  { immediate: true },
);
const shownSections = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return sections.value;
  return sections.value
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => (i.label + i.description).toLowerCase().includes(q)),
    }))
    .filter((s) => s.items.length);
});
// Enter opens the best match: the exact name, then names that contain the words, then the rest.
function openFirst() {
  const q = filter.value.trim().toLowerCase();
  const items = shownSections.value.flatMap((s) => s.items);
  const rank = (label: string) =>
    label.toLowerCase() === q ? 0 : label.toLowerCase().includes(q) ? 1 : 2;
  const best = [...items].sort((a, b) => rank(a.label) - rank(b.label))[0];
  if (best) void router.push(best.path);
}
const record = computed(() => route.path.includes('/development-items/'));
const narrow = useMediaQuery('(max-width: 760px)');
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
const menuHidden = ref(stored('shell-menu') === 'hidden');
// With a record open beside a list, screens narrower than 1440px fold the menu by themselves;
// opening it again holds until the record closes.
const roomy = useMediaQuery('(min-width: 1440px)');
const shownAnyway = ref(false);
watch(detailOpen, (open) => {
  if (!open) shownAnyway.value = false;
});
const autoHidden = computed(
  () => detailOpen.value && !roomy.value && !narrow.value && !shownAnyway.value,
);
const hidden = computed(() => menuHidden.value || autoHidden.value);
function showMenu() {
  menuHidden.value = false;
  shownAnyway.value = true;
}
// Choosing a module on the rail while its menu is folded away opens the menu (backlog BUG-006).
function openModule() {
  if (!narrow.value && hidden.value) showMenu();
}
function toggleMenu() {
  if (hidden.value) showMenu();
  else menuHidden.value = true;
}
const mobileMenu = ref(false);
// Tabs (docs/specs/workbench-tabs.md): every page opens in a tab and stays alive while another
// tab is in front, but a development item's assistants (FEAT-007). Each page sits in a wrapper
// named after its tab and address, so KeepAlive drops exactly the pages whose tab closed.
startTabs(router, identity.value?.user.id ?? '');
onBeforeUnmount(stopTabs);
const pageId = (tabId: string, key: string) => `${tabId}|${key}`;
const currentPage = computed(() => pageId(activeTabId.value, pageKey(route)));
const keptPages = computed(() =>
  tabs.value
    .filter((t) => !isRecord(t.path.split(/[?#]/)[0]!))
    .map((t) => pageId(t.id, pageKey(router.resolve(t.path)))),
);
const wrappers = new Map<string, Component>();
function wrapperOf(id: string) {
  let wrapper = wrappers.get(id);
  if (!wrapper) {
    wrapper = defineComponent({
      name: id,
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    });
    wrappers.set(id, wrapper);
  }
  for (const key of wrappers.keys())
    if (key !== id && !keptPages.value.includes(key)) wrappers.delete(key);
  return wrapper;
}
// A kept page comes back where it was scrolled: the content body and anything scrolled inside it.
const body = ref<HTMLElement | null>(null);
const scrolls = new Map<string, [Element, number, number][]>();
watch(
  activeTabId,
  (_id, old) => {
    for (const id of scrolls.keys()) if (!tabs.value.some((t) => t.id === id)) scrolls.delete(id);
    if (!old || !body.value) return;
    const all = [body.value, ...body.value.querySelectorAll('*')];
    scrolls.set(
      old,
      all.filter((e) => e.scrollTop || e.scrollLeft).map((e) => [e, e.scrollTop, e.scrollLeft]),
    );
  },
  { flush: 'pre' },
);
watch(
  activeTabId,
  (id) => {
    const saved = scrolls.get(id);
    if (!saved && body.value) body.value.scrollTop = 0;
    for (const [e, top, left] of saved ?? []) e.scrollTo(left, top);
  },
  { flush: 'post' },
);
// Ctrl / ⌘ or middle click on a menu entry or a module opens it in a new tab; right click
// offers the same (DESIGN.md 4.1 “标签栏”).
function newTabClick(event: MouseEvent) {
  const middle = event.type === 'auxclick' && event.button === 1;
  if (!middle && !(event.type === 'click' && (event.ctrlKey || event.metaKey))) return;
  const path = linkPath(event.target);
  if (!path) return;
  event.preventDefault();
  event.stopPropagation();
  void openInNewTab(path);
}
function linkItems(target: EventTarget | null): ContextItem[] | null {
  const path = linkPath(target);
  if (!path) return null;
  return [
    { label: '在新标签页打开', icon: SquarePlus, run: () => openInNewTab(path) },
    {
      label: '在新窗口打开',
      icon: ExternalLink,
      run: () => window.open(path, '_blank', 'noopener'),
    },
    {
      label: '复制链接',
      icon: Link,
      run: () =>
        navigator.clipboard.writeText(location.origin + path).then(
          () => toast('链接已复制'),
          () => toast('复制失败，请重试。', 'red'),
        ),
    },
  ];
}
// The module menu's width is dragged on its right edge and remembered (DESIGN.md 4.1).
const navWidth = ref(Number(stored('shell-nav-width')) || 248);
function saveNavWidth(width: number) {
  try {
    localStorage.setItem('shell-nav-width', String(width));
  } catch {
    // Storage may be refused; the width then lasts for this page only.
  }
}
const palette = ref(false);
const shortcuts = ref(false);
const logoutError = ref('');
const loggingOut = ref(false);
watch(menuHidden, (hidden) => {
  try {
    localStorage.setItem('shell-menu', hidden ? 'hidden' : 'shown');
  } catch {
    // Storage may be refused; the choice then lasts for this page only.
  }
});
watch(
  () => route.path,
  () => {
    mobileMenu.value = false;
    void loadProjects();
  },
  { immediate: true },
);
useShortcut('Ctrl+K', () => (palette.value = true));
useShortcut('[', toggleMenu);
useShortcut('?', () => (shortcuts.value = true));
async function logout() {
  if (leaveDelivery.value && !(await leaveDelivery.value())) return;
  loggingOut.value = true;
  logoutError.value = '';
  try {
    await api('/logout', {});
    identity.value = null;
    await router.replace('/login');
  } catch (e) {
    logoutError.value = (e as Error).message;
  } finally {
    loggingOut.value = false;
  }
}
const keys = [
  ['Ctrl+K', '打开命令面板：跳转页面、切换项目'],
  ['[', '收起或展开二级菜单'],
  ['?', '查看键盘快捷键'],
  ['Esc', '关闭弹层、对话框与输入框'],
];
</script>
<template>
  <ConfirmDialog />
  <div
    class="shell"
    :class="{ 'menu-hidden': hidden || record, 'menu-open': mobileMenu, record }"
    :style="{ '--nav-width': navWidth + 'px' }"
  >
    <a class="skip-link" href="#main-content">跳转到主要内容</a>
    <AppContextMenu :resolve="linkItems">
      <aside
        class="rail"
        aria-label="模块"
        @click.capture="newTabClick"
        @auxclick.capture="newTabClick"
      >
        <RouterLink to="/home" class="mark" aria-label="SAP 智能交付工作台">S</RouterLink>
        <BaseIconButton
          v-if="narrow"
          label="打开菜单"
          side="right"
          @click="mobileMenu = !mobileMenu"
          ><Menu
        /></BaseIconButton>
        <BaseIconButton
          v-for="m in modules"
          :key="m.id"
          :label="m.label"
          :to="m.path"
          :pressed="module.id === m.id"
          side="right"
          @click="openModule"
          ><AppIcon :name="m.icon" :size="18"
        /></BaseIconButton>
        <span class="rail-space"></span>
        <NotificationButton />
        <BaseIconButton label="搜索与跳转" kbd="Ctrl+K" side="right" @click="palette = true"
          ><Search
        /></BaseIconButton>
        <UserMenu :busy="loggingOut" @logout="logout" @shortcuts="shortcuts = true" />
      </aside>
    </AppContextMenu>
    <button
      v-if="mobileMenu"
      type="button"
      class="scrim"
      aria-label="关闭菜单"
      @click="mobileMenu = false"
    ></button>
    <AppContextMenu :resolve="linkItems">
      <nav
        class="menu"
        :aria-label="module.label + '菜单'"
        @click.capture="newTabClick"
        @auxclick.capture="newTabClick"
      >
        <BaseResizeHandle
          v-if="!narrow && !hidden && !record"
          v-model="navWidth"
          class="menu-resize"
          label="调整菜单宽度"
          :min="200"
          :max="400"
          @done="saveNavWidth"
        />
        <header class="menu-head">
          <p class="identity" :title="identity?.organization.name">
            <strong>{{ identity?.organization.name }}</strong
            ><small>SAP 智能交付工作台</small>
          </p>
          <BaseIconButton
            label="收起菜单"
            kbd="["
            size="sm"
            @click="narrow ? (mobileMenu = false) : toggleMenu()"
            ><PanelLeft
          /></BaseIconButton>
        </header>
        <h2 class="menu-title">{{ module.label }}</h2>
        <label v-if="module.id === 'settings'" class="menu-search">
          <Search />
          <input
            v-model="filter"
            type="search"
            placeholder="搜索设置…"
            aria-label="搜索设置"
            @keydown.enter.prevent="openFirst"
          />
        </label>
        <section
          v-for="section in shownSections"
          :key="section.id"
          class="menu-section"
          :class="{ grouped: section.label, closed: section.label && !isOpen(section.id) }"
        >
          <h3 v-if="section.label">
            <button
              type="button"
              class="menu-group"
              :aria-expanded="isOpen(section.id)"
              :aria-controls="'menu-group-' + section.id"
              @click="toggleGroup(section.id)"
            >
              <span>{{ section.label }}</span
              ><ChevronDown class="menu-group-chevron" />
            </button>
          </h3>
          <div :id="'menu-group-' + section.id" class="menu-items">
            <div
              class="menu-items-inner"
              :inert="section.label && !isOpen(section.id) ? true : undefined"
            >
              <BaseNavItem
                v-for="item in section.items"
                :key="item.id"
                :to="item.path"
                :label="item.label"
                :planned="item.planned"
                :active="activeEntry?.id === item.id"
                ><template #icon><AppIcon :name="item.icon" :size="16" /></template
              ></BaseNavItem>
            </div>
          </div>
        </section>
        <p v-if="filter && !shownSections.length" class="menu-empty">没有匹配的设置。</p>
      </nav>
    </AppContextMenu>
    <div class="shell-main">
      <AppTabs />
      <main id="main-content" class="shell-content">
        <header v-if="!record" class="page-bar">
          <BaseIconButton
            v-if="hidden && !narrow"
            label="展开菜单"
            kbd="["
            size="sm"
            @click="showMenu"
            ><PanelLeft
          /></BaseIconButton>
          <nav class="crumbs" aria-label="当前位置">
            <template v-if="projectScoped">
              <ProjectSwitcher />
              <ChevronRight class="crumb-sep" aria-hidden="true" />
            </template>
            <template v-for="(c, i) in crumbs" :key="i">
              <ChevronRight v-if="i" class="crumb-sep" aria-hidden="true" />
              <RouterLink v-if="c.to" :to="c.to" class="crumb">{{ c.label }}</RouterLink>
              <span
                v-else
                class="crumb"
                :aria-current="i === crumbs.length - 1 ? 'page' : undefined"
                >{{ c.label }}</span
              >
            </template>
          </nav>
          <p v-if="projectError" class="page-bar-error" role="alert">{{ projectError }}</p>
          <!-- A page puts its main actions here with <Teleport defer to="#page-actions">. -->
          <div id="page-actions" class="page-actions"></div>
        </header>
        <div ref="body" class="shell-body">
          <p v-if="logoutError" class="error-note" role="alert">{{ logoutError }}</p>
          <RouterView v-slot="{ Component: page }">
            <KeepAlive :include="keptPages" :max="10">
              <component :is="wrapperOf(currentPage)" :key="currentPage"
                ><component :is="page"
              /></component>
            </KeepAlive>
          </RouterView>
        </div>
      </main>
    </div>
    <CommandPalette v-model:open="palette" />
    <BaseDialog v-model:open="shortcuts" title="键盘快捷键">
      <dl class="keys">
        <template v-for="[k, text] in keys" :key="k">
          <dt><BaseKbd :keys="k" /></dt>
          <dd>{{ text }}</dd>
        </template>
      </dl>
    </BaseDialog>
    <BaseToaster />
  </div>
</template>
<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--layout-rail) var(--nav-width, var(--layout-nav)) minmax(0, 1fr);
  height: 100dvh;
  background: var(--page);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--font-14);
  line-height: var(--leading-20);
}
.menu-hidden {
  grid-template-columns: var(--layout-rail) 0 minmax(0, 1fr);
}
.skip-link {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  z-index: 100;
  padding: var(--space-1-5) var(--space-3);
  border-radius: var(--radius-6);
  background: var(--primary);
  color: var(--on-primary);
  transform: translateY(-200%);
}
.skip-link:focus {
  transform: none;
}
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) 0;
}
.mark {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-bottom: var(--space-2);
  border-radius: var(--radius-6);
  background: var(--blue-solid-1);
  color: var(--neutral-on-solid);
  font-weight: var(--weight-550);
  text-decoration: none;
}
.rail-space {
  flex: 1;
}
.menu {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden auto;
  padding: var(--space-2) var(--space-2) var(--space-4);
  transition: opacity var(--motion-base);
}
.menu-resize {
  right: 0;
}
.menu-hidden .menu {
  visibility: hidden;
  opacity: 0;
}
.menu-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
}
.identity {
  display: grid;
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: var(--space-1) var(--space-2);
}
.identity strong,
.identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.identity strong {
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.identity small {
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
.menu-title {
  margin: 0 0 var(--space-1);
  padding: 0 var(--space-2);
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.menu-section {
  display: grid;
}
/* A labelled group (DESIGN.md 4.2): a strong title with a fold arrow, a hairline above, and its
   pages indented beneath; folding animates the height. */
.menu-section.grouped {
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}
.menu-section h3 {
  margin: 0 0 var(--space-0-5);
}
.menu-group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  height: var(--control-menu-item);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--font-12);
  font-weight: var(--weight-550);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast);
}
.menu-group span {
  flex: 1;
}
.menu-group:hover {
  background: var(--hover);
}
.menu-group:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.menu-group-chevron {
  width: 14px;
  height: 14px;
  color: var(--neutral-icon-1);
  transition: transform var(--motion-slow);
}
.closed .menu-group-chevron {
  transform: rotate(-90deg);
}
.menu-items {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--motion-slow);
}
.closed .menu-items {
  grid-template-rows: 0fr;
}
.menu-items-inner {
  display: grid;
  gap: var(--space-0-5);
  min-height: 0;
  overflow: hidden;
}
.grouped .menu-items-inner {
  padding-left: var(--space-2);
}
.menu-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-input);
  margin: var(--space-1) 0 var(--space-2);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  background: var(--panel);
  color: var(--neutral-icon-1);
  transition: box-shadow var(--motion-fast);
}
.menu-search:focus-within {
  box-shadow: 0 0 0 2px var(--focus);
}
.menu-search svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.menu-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.menu-empty {
  padding: var(--space-3) var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-12);
}
/* The tab bar takes the gap above the content panel (DESIGN.md 4.1 “标签栏”). */
.shell-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding-right: var(--layout-gap);
}
.shell-main > .tab-bar {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}
.shell-content {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  margin-bottom: var(--layout-gap);
  overflow: hidden;
  border-radius: 0 var(--radius-12) var(--radius-12) var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
/* The page header (DESIGN.md 4.1): one slim row with the project switcher and where you are. */
.page-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--layout-record-bar);
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--border);
}
.crumbs {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  color: var(--text-muted);
}
.crumb {
  overflow: hidden;
  padding: 0 var(--space-1);
  border-radius: var(--radius-4);
  color: inherit;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.crumb:hover {
  color: var(--text);
}
a.crumb:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.crumb[aria-current='page'] {
  color: var(--text);
}
.crumb-sep {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-subtle);
}
.page-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
}
.page-actions:empty {
  display: none;
}
.page-bar-error {
  margin: 0;
  color: var(--red-text-2);
  font-size: var(--font-12);
}
.shell-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* Pages that run edge to edge (the list area) bleed by these. */
  --body-pad-y: var(--space-6);
  --body-pad-x: var(--space-8);
  padding: var(--body-pad-y) var(--body-pad-x);
}
.record .shell-body {
  padding: 0;
  overflow: hidden;
}
.keys {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--space-3) var(--space-4);
  margin: 0;
}
.keys dd {
  margin: 0;
  color: var(--text-muted);
}
.scrim {
  display: none;
}
/* Low screens (DESIGN.md 4.1): less padding around the page. */
@media (max-height: 820px) {
  .shell-body {
    --body-pad-y: var(--space-4);
    --body-pad-x: var(--space-6);
  }
}
@media (max-width: 760px) {
  .shell,
  .menu-hidden {
    grid-template-columns: var(--layout-rail) minmax(0, 1fr);
  }
  .menu {
    position: fixed;
    top: 0;
    bottom: 0;
    left: var(--layout-rail);
    z-index: 50;
    width: var(--layout-nav);
    background: var(--page);
    box-shadow: var(--shadow-dialog);
    transform: translateX(calc(-100% - var(--layout-rail)));
    transition: transform var(--motion-panel);
  }
  .menu-hidden .menu {
    visibility: visible;
    opacity: 1;
  }
  .menu-open .menu {
    transform: none;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 49;
    display: block;
    border: 0;
    background: var(--scrim);
  }
  .shell-body {
    --body-pad-y: var(--space-4);
    --body-pad-x: var(--space-4);
  }
  .page-bar {
    flex-wrap: wrap;
    padding: var(--space-1) var(--space-2);
  }
  .crumbs {
    flex-basis: 100%;
  }
}
</style>
