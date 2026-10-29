<script setup lang="ts">
import { onMounted, onUnmounted, ref, type Component } from 'vue';
import { MoreHorizontal } from '@lucide/vue';

// The ⋯ at the end of a settings list row (DESIGN.md 5 “设置列表表格”): less frequent actions such
// as “设为默认” and “删除”; a danger item is red.
export interface RowMenuItem {
  label: string;
  icon: Component;
  run: () => unknown;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}
defineProps<{ label: string; items: RowMenuItem[] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
function outside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false;
}
function pick(item: RowMenuItem) {
  open.value = false;
  void item.run();
}
onMounted(() => document.addEventListener('pointerdown', outside));
onUnmounted(() => document.removeEventListener('pointerdown', outside));
</script>
<template>
  <div ref="root" class="row-menu" @keydown.esc.stop="open = false">
    <button
      type="button"
      class="icon-button"
      :aria-label="label"
      :aria-expanded="open"
      @click="open = !open"
    >
      <MoreHorizontal :size="19" />
    </button>
    <div v-if="open" class="row-menu-panel">
      <button
        v-for="item in items"
        :key="item.label"
        type="button"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        :title="item.title"
        @click="pick(item)"
      >
        <component :is="item.icon" :size="15" />{{ item.label }}
      </button>
    </div>
  </div>
</template>
<style scoped>
.row-menu {
  position: relative;
}
.row-menu > .icon-button {
  width: 28px;
  height: 30px;
}
.row-menu-panel {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 5;
  min-width: 168px;
  padding: var(--space-1-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--panel);
}
.row-menu-panel button {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2-5) var(--space-3);
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.row-menu-panel button:hover {
  background: var(--hover);
}
.row-menu-panel button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.row-menu-panel .danger {
  color: var(--red-text-2);
}
</style>
