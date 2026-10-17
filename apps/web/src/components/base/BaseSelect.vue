<script setup lang="ts">
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui';
import { Check, ChevronDown } from '@lucide/vue';
// A select that opens a menu-styled list (DESIGN.md 5).
const value = defineModel<string>({ default: '' });
defineProps<{
  options: { value: string; label: string }[];
  placeholder?: string;
  label?: string;
}>();
</script>
<template>
  <SelectRoot v-model="value">
    <SelectTrigger class="base-select" :aria-label="label">
      <SelectValue :placeholder="placeholder" /><ChevronDown class="chevron" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="base-surface" position="popper" :side-offset="6">
        <SelectViewport>
          <SelectItem v-for="o in options" :key="o.value" :value="o.value" class="base-menu-item">
            <SelectItemText>{{ o.label }}</SelectItemText>
            <SelectItemIndicator class="base-select-check"><Check /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
<style scoped>
.base-select {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 140px;
  height: var(--control-input);
  padding: 0 var(--space-2) 0 var(--space-2-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: var(--font-14);
  cursor: pointer;
  transition: border-color var(--motion-fast);
}
.base-select:hover {
  border-color: var(--border-emphasis);
}
.base-select:focus-visible,
.base-select[data-state='open'] {
  outline: none;
  border-color: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
}
.base-select[data-placeholder] {
  color: var(--text-subtle);
}
.chevron {
  width: 14px;
  height: 14px;
  color: var(--neutral-icon-1);
}
</style>
<style>
.base-select-check {
  margin-left: auto;
  display: inline-grid;
}
</style>
