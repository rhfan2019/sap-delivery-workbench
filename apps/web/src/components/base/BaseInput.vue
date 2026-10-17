<script setup lang="ts">
// Text field (DESIGN.md 5): 32px, 6px corners; focus draws a blue ring. An icon may lead.
const value = defineModel<string>({ default: '' });
withDefaults(
  defineProps<{ placeholder?: string; type?: string; disabled?: boolean; label?: string }>(),
  { type: 'text' },
);
</script>
<template>
  <label class="base-input" :class="{ disabled }">
    <span v-if="$slots.icon" class="icon"><slot name="icon" /></span>
    <input
      v-model="value"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="label || placeholder"
    />
    <slot name="end" />
  </label>
</template>
<style scoped>
.base-input {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-input);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  background: var(--panel);
  color: var(--text);
  transition:
    border-color var(--motion-fast),
    box-shadow var(--motion-fast);
}
.base-input:hover {
  border-color: var(--border-emphasis);
}
.base-input:focus-within {
  border-color: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
}
.icon {
  display: inline-grid;
  place-items: center;
  color: var(--neutral-icon-1);
}
.icon :deep(svg) {
  width: 16px;
  height: 16px;
}
input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
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
.disabled {
  opacity: 0.5;
}
</style>
