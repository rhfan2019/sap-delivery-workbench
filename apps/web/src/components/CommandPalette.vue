<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { CornerDownLeft, FolderOpen, Search } from '@lucide/vue';
import AppIcon from './AppIcon.vue';
import BaseKbd from './base/BaseKbd.vue';
import { menus, visible } from '../features/navigation';
import { identity } from '../services/session';
import { openPage } from '../services/tabs';
import { currentProject, projectAccess, projects, selectProject } from '../services/projectContext';

// Command palette (Ctrl K): go to any page or switch project by typing.
const open = defineModel<boolean>('open', { default: false });
const query = ref('');
const index = ref(0);
const input = ref<HTMLInputElement | null>(null);
type Entry = { id: string; label: string; note: string; icon?: string; run: () => void };
const entries = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  const allowed = { organization: identity.value?.permissions ?? [], project: projectAccess.value };
  const pages: Entry[] = menus
    .filter((m) => visible(m, allowed))
    .map((m) => ({
      id: 'page:' + m.id,
      label: m.label,
      note: m.planned ? '规划中' : m.path.startsWith('/settings') ? '设置' : '页面',
      icon: m.icon,
      run: () => void openPage(m.path),
    }));
  const switches: Entry[] = projects.value
    .filter((p) => p.id !== currentProject.value)
    .map((p) => ({
      id: 'project:' + p.id,
      label: '切换到 ' + p.name,
      note: '项目',
      run: () => void selectProject(p.id),
    }));
  return [...pages, ...switches].filter((e) => !q || e.label.toLowerCase().includes(q));
});
watch(open, async (value) => {
  if (!value) return;
  query.value = '';
  index.value = 0;
  await nextTick();
  input.value?.focus();
});
watch(query, () => (index.value = 0));
function choose(entry?: Entry) {
  if (!entry) return;
  open.value = false;
  entry.run();
}
function key(event: KeyboardEvent) {
  const n = entries.value.length;
  if (event.key === 'ArrowDown') index.value = (index.value + 1) % Math.max(n, 1);
  else if (event.key === 'ArrowUp') index.value = (index.value - 1 + n) % Math.max(n, 1);
  else if (event.key === 'Enter') choose(entries.value[index.value]);
  else return;
  event.preventDefault();
}
</script>
<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="base-scrim" />
      <DialogContent class="palette" :aria-describedby="undefined" @keydown="key">
        <DialogTitle class="sr-only">命令面板</DialogTitle>
        <label class="field">
          <Search class="lead" />
          <input
            ref="input"
            v-model="query"
            placeholder="搜索页面，或输入项目名切换项目…"
            aria-label="搜索命令"
          />
          <BaseKbd keys="esc" />
        </label>
        <ul role="listbox" aria-label="结果">
          <li
            v-for="(e, i) in entries"
            :key="e.id"
            role="option"
            :aria-selected="i === index"
            :class="{ current: i === index }"
            @mousemove="index = i"
            @click="choose(e)"
          >
            <AppIcon v-if="e.icon" :name="e.icon" :size="16" /><FolderOpen v-else class="icon" />
            <span class="label">{{ e.label }}</span>
            <span class="note">{{ e.note }}</span>
            <CornerDownLeft v-if="i === index" class="enter" />
          </li>
          <li v-if="!entries.length" class="empty">没有匹配的页面或项目</li>
        </ul>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
<style scoped>
.palette {
  position: fixed;
  top: 18vh;
  left: 50%;
  z-index: 61;
  width: min(560px, calc(100vw - 32px));
  overflow: hidden;
  border-radius: var(--radius-12);
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-dialog);
  transform: translateX(-50%);
  animation: base-from-top var(--motion-base);
}
.field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--border);
}
.lead {
  width: 16px;
  height: 16px;
  color: var(--neutral-icon-1);
}
input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--font-14);
}
input::placeholder {
  color: var(--text-subtle);
}
ul {
  max-height: 360px;
  margin: 0;
  padding: var(--space-1) 0;
  overflow: auto;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-nav-item);
  margin: 0 var(--space-1);
  padding: 0 var(--space-3);
  border-radius: var(--radius-6);
  color: var(--text);
  font-size: var(--font-14);
  cursor: pointer;
}
li :deep(svg) {
  flex-shrink: 0;
  color: var(--neutral-icon-1);
}
.icon,
.enter {
  width: 16px;
  height: 16px;
}
.current {
  background: var(--hover);
}
.label {
  flex: 1;
}
.note {
  color: var(--text-subtle);
  font-size: var(--font-12);
}
.empty {
  color: var(--text-muted);
  cursor: default;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
