<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import { ChevronDown } from '@lucide/vue';
// A collapsible group of a details panel (DESIGN.md 5); the body animates its height.
const open = defineModel<boolean>('open', { default: true });
defineProps<{ title: string }>();
</script>
<template>
  <CollapsibleRoot v-model:open="open" class="base-section">
    <CollapsibleTrigger class="head">
      <span>{{ title }}</span
      ><span class="aside"><slot name="aside" /></span><ChevronDown class="chevron" />
    </CollapsibleTrigger>
    <CollapsibleContent class="base-section-body"><slot /></CollapsibleContent>
  </CollapsibleRoot>
</template>
<style scoped>
.base-section {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
}
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: var(--control-tab);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--font-12);
  font-weight: var(--weight-550);
  text-align: left;
  cursor: pointer;
}
.aside {
  margin-left: auto;
  color: var(--text-muted);
  font-weight: var(--weight-400);
}
.chevron {
  width: 16px;
  height: 16px;
  color: var(--neutral-icon-1);
  transition: transform var(--motion-base);
}
.head[data-state='closed'] .chevron {
  transform: rotate(-90deg);
}
</style>
<style>
.base-section-body {
  overflow: hidden;
}
.base-section-body[data-state='open'] {
  animation: base-open var(--motion-base);
}
.base-section-body[data-state='closed'] {
  animation: base-close var(--motion-base);
}
</style>
