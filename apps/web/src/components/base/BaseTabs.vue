<script setup lang="ts">
// Text tabs (DESIGN.md 5): the selected tab sits on a light grey fill; counts follow the label.
const value = defineModel<string>({ required: true });
defineProps<{ tabs: { id: string; label: string; count?: number }[]; label?: string }>();
</script>
<template>
  <div class="base-tabs" role="tablist" :aria-label="label">
    <button
      v-for="t in tabs"
      :key="t.id"
      type="button"
      role="tab"
      :aria-selected="value === t.id"
      :class="{ selected: value === t.id }"
      @click="value = t.id"
    >
      {{ t.label }}<span v-if="t.count !== undefined" class="count">{{ t.count }}</span>
    </button>
  </div>
</template>
<style scoped>
.base-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  height: var(--control-tab);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--font-14);
  cursor: pointer;
  transition: background-color var(--motion-fast);
}
button:hover {
  background: var(--hover);
}
.selected,
.selected:hover {
  background: var(--selected);
}
button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.count {
  color: var(--text-muted);
  font-size: var(--font-12);
  font-variant-numeric: tabular-nums;
}
</style>
