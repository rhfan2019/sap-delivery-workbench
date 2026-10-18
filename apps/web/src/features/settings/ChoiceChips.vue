<script setup lang="ts">
// A set of toggle chips for a multiple choice (modules, scopes): pressed chips are selected.
const value = defineModel<string[]>({ default: () => [] });
defineProps<{ options: { value: string; label: string }[]; label: string; disabled?: boolean }>();
function toggle(option: string) {
  value.value = value.value.includes(option)
    ? value.value.filter((v) => v !== option)
    : [...value.value, option];
}
</script>
<template>
  <div class="chips" role="group" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="chip"
      :aria-pressed="value.includes(o.value)"
      :disabled="disabled"
      @click="toggle(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>
<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
}
.chip {
  height: var(--control-tab);
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  background: var(--panel);
  color: var(--text-muted);
  font: inherit;
  font-size: var(--font-12);
  cursor: pointer;
  transition:
    background var(--motion-fast),
    color var(--motion-fast),
    border-color var(--motion-fast);
}
.chip:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.chip[aria-pressed='true'] {
  border-color: var(--blue-border-3);
  background: var(--blue-fill-1);
  color: var(--blue-text-1);
  font-weight: var(--weight-550);
}
.chip:disabled {
  cursor: default;
  opacity: 0.6;
}
.chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
</style>
