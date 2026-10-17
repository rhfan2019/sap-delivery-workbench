<script setup lang="ts">
import { RouterLink } from 'vue-router';
import BaseTooltip from './BaseTooltip.vue';
// Square icon button with an accessible name; shows the name as a tooltip unless told not to.
// With `to` it is a link (the icon rail).
withDefaults(
  defineProps<{
    label: string;
    size?: 'md' | 'sm';
    pressed?: boolean;
    tooltip?: boolean;
    kbd?: string;
    to?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
  }>(),
  { size: 'md', tooltip: true, side: 'top' },
);
// Declared so the click reaches the button itself, not the tooltip wrapper around it.
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>
<template>
  <BaseTooltip v-if="tooltip" :text="label" :kbd="kbd" :side="side">
    <component
      :is="to ? RouterLink : 'button'"
      :to="to"
      :type="to ? undefined : 'button'"
      class="base-icon-button"
      :class="[size, { pressed }]"
      :aria-label="label"
      :aria-pressed="to ? undefined : (pressed ?? undefined)"
      :aria-current="to && pressed ? 'page' : undefined"
      @click="emit('click', $event)"
    >
      <slot />
    </component>
  </BaseTooltip>
  <component
    :is="to ? RouterLink : 'button'"
    v-else
    :to="to"
    :type="to ? undefined : 'button'"
    class="base-icon-button"
    :class="[size, { pressed }]"
    :aria-label="label"
    :aria-pressed="to ? undefined : (pressed ?? undefined)"
    :aria-current="to && pressed ? 'page' : undefined"
    @click="emit('click', $event)"
  >
    <slot />
  </component>
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
