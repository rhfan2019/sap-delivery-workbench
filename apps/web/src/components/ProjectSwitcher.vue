<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Check, ChevronsUpDown, Search, Star } from '@lucide/vue';
import BasePopover from './base/BasePopover.vue';
import {
  projects,
  currentProject,
  defaultProject,
  selectProject,
  setDefaultProject,
} from '../services/projectContext';

// The project switcher of the page header (DESIGN.md 4.1): search, projects grouped by customer,
// and “set as default”. Archived projects stay out (they open from 设置 → 企业 → 项目), unless
// current.
const open = ref(false);
const query = ref('');
const search = ref<HTMLInputElement | null>(null);
const current = computed(() => projects.value.find((p) => p.id === currentProject.value));
const label = computed(() =>
  current.value
    ? current.value.shortName || current.value.name
    : projects.value.length
      ? '选择项目'
      : '暂无项目',
);
const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  const shown = projects.value.filter(
    (p) =>
      (p.status !== 'archived' || p.id === currentProject.value) &&
      (!q ||
        [p.name, p.shortName, p.code, p.customerName].some((t) => t?.toLowerCase().includes(q))),
  );
  const byCustomer = new Map<string, typeof shown>();
  for (const p of shown) {
    const key = p.customerName || '未指定客户';
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), p]);
  }
  return [...byCustomer].map(([customer, items]) => ({ customer, items }));
});
const matches = computed(() => groups.value.flatMap((g) => g.items));
watch(open, async (value) => {
  query.value = '';
  if (value) {
    await nextTick();
    search.value?.focus();
  }
});
async function choose(id: string) {
  open.value = false;
  await selectProject(id);
}
function chooseFirst() {
  const first = matches.value[0];
  if (first) void choose(first.id);
}
</script>
<template>
  <BasePopover v-model:open="open" align="start">
    <template #trigger>
      <button
        type="button"
        class="switcher"
        :title="current ? current.name + ' · ' + current.customerName : undefined"
        :disabled="!projects.length"
        aria-label="切换项目"
      >
        <span class="switcher-name">{{ label }}</span>
        <ChevronsUpDown class="switcher-chevron" />
      </button>
    </template>
    <div class="switcher-panel">
      <label class="switcher-search">
        <Search />
        <input
          ref="search"
          v-model="query"
          type="search"
          placeholder="搜索项目、编号或客户…"
          aria-label="搜索项目"
          @keydown.enter.prevent="chooseFirst"
        />
      </label>
      <div class="switcher-list" role="listbox" aria-label="项目">
        <section v-for="g in groups" :key="g.customer">
          <h4>{{ g.customer }}</h4>
          <button
            v-for="p in g.items"
            :key="p.id"
            type="button"
            role="option"
            class="switcher-option"
            :aria-selected="p.id === currentProject"
            @click="choose(p.id)"
          >
            <Check
              class="switcher-check"
              :style="{ visibility: p.id === currentProject ? 'visible' : 'hidden' }"
            />
            <span class="switcher-option-name">{{ p.name }}</span>
            <small v-if="p.id === defaultProject">默认</small>
            <small v-else-if="p.status === 'archived'">已归档</small>
          </button>
        </section>
        <p v-if="!matches.length" class="switcher-empty">没有匹配的项目。</p>
      </div>
      <button
        type="button"
        class="switcher-option switcher-default"
        :disabled="!currentProject || currentProject === defaultProject"
        @click="setDefaultProject"
      >
        <Star class="switcher-star" />
        <span class="switcher-option-name">{{
          currentProject && currentProject === defaultProject ? '已是默认项目' : '设为默认项目'
        }}</span>
      </button>
    </div>
  </BasePopover>
</template>
<style scoped>
.switcher {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 100%;
  height: var(--control-nav-item);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-weight: var(--weight-550);
  cursor: pointer;
  transition: background-color var(--motion-fast);
}
.switcher:hover:not(:disabled),
.switcher[data-state='open'] {
  background: var(--hover);
}
.switcher:disabled {
  color: var(--text-muted);
  cursor: default;
}
.switcher:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.switcher-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switcher-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--neutral-icon-1);
}
.switcher-panel {
  display: grid;
  gap: var(--space-2);
  width: min(320px, calc(100vw - var(--space-8)));
}
.switcher-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-input);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  color: var(--neutral-icon-1);
}
.switcher-search:focus-within {
  box-shadow: 0 0 0 2px var(--focus);
}
.switcher-search svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.switcher-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.switcher-list {
  max-height: 320px;
  overflow: auto;
}
.switcher-list h4 {
  margin: var(--space-2) 0 var(--space-0-5);
  padding: 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
.switcher-list section:first-child h4 {
  margin-top: 0;
}
.switcher-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: var(--control-menu-item);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.switcher-option:hover:not(:disabled),
.switcher-option:focus-visible {
  outline: none;
  background: var(--hover);
}
.switcher-option:disabled {
  color: var(--text-subtle);
  cursor: default;
}
.switcher-option small {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.switcher-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switcher-check,
.switcher-star {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.switcher-star {
  color: var(--yellow-icon-1);
}
.switcher-default {
  border-top: 1px solid var(--border);
  border-radius: 0;
  padding-top: var(--space-1);
  height: auto;
  min-height: var(--control-menu-item);
}
.switcher-empty {
  margin: 0;
  padding: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-12);
}
</style>
