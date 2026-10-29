<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { ArrowRightToLine, CopyX, Plus, X } from '@lucide/vue';
import AppIcon from './AppIcon.vue';
import AppContextMenu, { type ContextItem } from './AppContextMenu.vue';
import BaseIconButton from './base/BaseIconButton.vue';
import {
  activateTab,
  activeTabId,
  closeOtherTabs,
  closeTab,
  closeTabsRight,
  openInNewTab,
  tabIcon,
  tabLabel,
  tabs,
} from '../services/tabs';

// The tab bar above the content panel (DESIGN.md 4.1 “标签栏”, docs/specs/workbench-tabs.md).
const strip = ref<HTMLElement | null>(null);
watch(
  activeTabId,
  async (id) => {
    await nextTick();
    strip.value
      ?.querySelector(`[data-tab-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
  { immediate: true },
);
// A wheel turns into sideways scrolling when the tabs overflow.
function wheel(event: WheelEvent) {
  if (!strip.value || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  strip.value.scrollLeft += event.deltaY;
}
// Middle click closes, as in a browser; holding it down must not start auto-scrolling.
function aux(event: MouseEvent, id: string) {
  if (event.button !== 1) return;
  event.preventDefault();
  void closeTab(id);
}
function resolve(target: EventTarget | null): ContextItem[] | null {
  const id = (target as Element | null)?.closest?.('[data-tab-id]')?.getAttribute('data-tab-id');
  if (!id) return null;
  const last = tabs.value[tabs.value.length - 1]?.id === id;
  return [
    { label: '关闭', icon: X, run: () => closeTab(id) },
    ...(tabs.value.length > 1
      ? [{ label: '关闭其他标签', icon: CopyX, run: () => closeOtherTabs(id) }]
      : []),
    ...(last
      ? []
      : [{ label: '关闭右侧标签', icon: ArrowRightToLine, run: () => closeTabsRight(id) }]),
  ];
}
</script>
<template>
  <nav class="tab-bar" aria-label="标签页">
    <AppContextMenu :resolve="resolve">
      <div ref="strip" class="tab-strip" @wheel.passive="wheel">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{ active: tab.id === activeTabId }"
          :data-tab-id="tab.id"
          :title="tabLabel(tab.path)"
          @mousedown.middle.prevent
          @auxclick="aux($event, tab.id)"
        >
          <button
            type="button"
            class="tab-main"
            :aria-current="tab.id === activeTabId ? 'page' : undefined"
            @click="activateTab(tab.id)"
          >
            <AppIcon :name="tabIcon(tab.path)" :size="14" />
            <span class="tab-label">{{ tabLabel(tab.path) }}</span>
          </button>
          <button
            type="button"
            class="tab-close"
            :aria-label="'关闭' + tabLabel(tab.path)"
            @click="closeTab(tab.id)"
          >
            <X />
          </button>
        </div>
      </div>
    </AppContextMenu>
    <BaseIconButton label="新标签页" size="sm" @click="openInNewTab('/home')"
      ><Plus
    /></BaseIconButton>
  </nav>
</template>
<style scoped>
.tab-bar {
  display: flex;
  align-items: flex-end;
  gap: var(--space-1);
  min-width: 0;
  height: var(--layout-tab-bar);
  padding-right: var(--space-1);
}
.tab-bar > :deep(.base-icon-button) {
  align-self: center;
}
.tab-strip {
  display: flex;
  align-items: flex-end;
  gap: var(--space-0-5);
  min-width: 0;
  height: 100%;
  overflow: auto hidden;
  scrollbar-width: none;
}
.tab-strip::-webkit-scrollbar {
  display: none;
}
.tab {
  display: flex;
  flex: 0 1 var(--layout-tab-max);
  align-items: center;
  min-width: var(--layout-tab-min);
  height: var(--control-tab);
  border-radius: var(--radius-8) var(--radius-8) 0 0;
  color: var(--text-muted);
  transition:
    background-color var(--motion-fast),
    color var(--motion-fast);
}
.tab:hover {
  background: var(--hover);
  color: var(--text);
}
.tab.active {
  background: var(--panel);
  color: var(--text);
}
.tab-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  height: 100%;
  padding: 0 var(--space-1) 0 var(--space-2);
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: var(--font-12);
  cursor: pointer;
}
.tab-main :deep(svg) {
  flex-shrink: 0;
  color: var(--neutral-icon-1);
}
.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-close {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: var(--space-5);
  height: var(--space-5);
  margin-right: var(--space-1);
  padding: 0;
  border: 0;
  border-radius: var(--radius-4);
  background: none;
  color: var(--text-subtle);
  cursor: pointer;
}
.tab-close svg {
  width: 14px;
  height: 14px;
}
.tab-close:hover {
  background: var(--pressed);
  color: var(--text);
}
.tab-main:focus-visible,
.tab-close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
