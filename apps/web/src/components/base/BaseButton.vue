<script setup lang="ts">
import BaseKbd from './BaseKbd.vue';
// Buttons (DESIGN.md 5): one ink primary per view; secondary, ghost and danger around it.
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'md' | 'sm';
    kbd?: string;
    loading?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
);
</script>
<template>
  <button
    :type="type"
    class="base-button"
    :class="[variant, size]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <span v-if="loading" class="spinner" aria-hidden="true"></span><slot name="icon" /><span
      v-if="$slots.default"
      class="label"
      ><slot /></span
    ><BaseKbd v-if="kbd" :keys="kbd" :tone="variant === 'primary' ? 'inverse' : 'default'" />
  </button>
</template>
<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1-5);
  height: var(--control-button);
  padding: 0 var(--space-3) 0 var(--space-2-5);
  border: 1px solid transparent;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--font-14);
  line-height: var(--leading-20);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--motion-fast),
    border-color var(--motion-fast),
    color var(--motion-fast),
    box-shadow var(--motion-fast);
}
.base-button:not(:has(svg)) {
  padding-left: var(--space-3);
}
.base-button.sm {
  height: var(--control-tab);
  padding: 0 var(--space-2);
  font-size: var(--font-12);
}
.base-button :deep(svg) {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.primary {
  background: var(--primary);
  color: var(--on-primary);
  box-shadow: var(--shadow-button);
}
.primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
.secondary {
  background: var(--panel);
  border-color: var(--border-strong);
}
.secondary:hover:not(:disabled),
.ghost:hover:not(:disabled) {
  background: var(--hover);
}
.secondary:active:not(:disabled),
.ghost:active:not(:disabled) {
  background: var(--selected);
}
.danger {
  color: var(--red-text-2);
}
.danger:hover:not(:disabled) {
  background: var(--red-fill-1);
}
.base-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
.base-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: base-spin var(--duration-spin) linear infinite;
}
@keyframes base-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
