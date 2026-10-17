<script setup lang="ts">
import { RouterLink } from 'vue-router';
// A row of the secondary menu (DESIGN.md 4.1): icon, label, count; the current page is grey.
defineProps<{ to: string; label: string; count?: number; active?: boolean }>();
</script>
<template>
  <RouterLink
    :to="to"
    class="base-nav-item"
    :class="{ active }"
    :aria-current="active ? 'page' : undefined"
  >
    <span v-if="$slots.icon" class="icon"><slot name="icon" /></span>
    <span class="label">{{ label }}</span>
    <span v-if="count !== undefined" class="count">{{ count }}</span>
  </RouterLink>
</template>
<style scoped>
.base-nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-nav-item);
  padding: 0 var(--space-2);
  border-radius: var(--radius-6);
  color: var(--text-muted);
  font-size: var(--font-14);
  text-decoration: none;
  transition:
    background-color var(--motion-fast),
    color var(--motion-fast);
}
.base-nav-item:hover {
  background: var(--hover);
  color: var(--text);
}
.active,
.active:hover {
  background: var(--selected);
  color: var(--text);
}
.active .label {
  font-weight: var(--weight-550);
}
.icon {
  display: inline-grid;
  place-items: center;
  color: var(--neutral-icon-1);
}
.active .icon {
  color: var(--text);
}
.icon :deep(svg) {
  width: 16px;
  height: 16px;
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  color: var(--text-muted);
  font-size: var(--font-12);
  font-variant-numeric: tabular-nums;
}
.base-nav-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
</style>
