<script setup lang="ts">
import BaseTooltip from './BaseTooltip.vue';
// Square icon button with an accessible name; shows the name as a tooltip unless told not to.
withDefaults(
  defineProps<{
    label: string;
    size?: 'md' | 'sm';
    pressed?: boolean;
    tooltip?: boolean;
    kbd?: string;
  }>(),
  { size: 'md', tooltip: true },
);
</script>
<template>
  <BaseTooltip v-if="tooltip" :text="label" :kbd="kbd">
    <button
      type="button"
      class="base-icon-button"
      :class="[size, { pressed }]"
      :aria-label="label"
      :aria-pressed="pressed ?? undefined"
    >
      <slot />
    </button>
  </BaseTooltip>
  <button
    v-else
    type="button"
    class="base-icon-button"
    :class="[size, { pressed }]"
    :aria-label="label"
    :aria-pressed="pressed ?? undefined"
  >
    <slot />
  </button>
</template>
<style scoped>
.base-icon-button {
  display: inline-grid;
  place-items: center;
  width: var(--control-icon);
  height: var(--control-icon);
  padding: 0;
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color var(--motion-fast),
    color var(--motion-fast);
}
.sm {
  width: var(--control-tab);
  height: var(--control-tab);
}
.base-icon-button :deep(svg) {
  width: 16px;
  height: 16px;
}
.base-icon-button:hover {
  background: var(--hover);
  color: var(--text);
}
.base-icon-button:active,
.pressed {
  background: var(--selected);
  color: var(--text);
}
.base-icon-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
</style>
