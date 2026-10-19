<script setup lang="ts">
import { RouterLink } from 'vue-router';
import BaseTooltip from './BaseTooltip.vue';
// Square icon button with an accessible name; shows the name as a tooltip unless told not to.
// With `to` it is a link (the icon rail). Disabled with a tooltip it stays hoverable
// (aria-disabled) so the tooltip can say why; the click is swallowed.
const props = withDefaults(
  defineProps<{
    label: string;
    size?: 'md' | 'sm';
    pressed?: boolean;
    tooltip?: boolean;
    kbd?: string;
    to?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    disabled?: boolean;
  }>(),
  { size: 'md', tooltip: true, side: 'top' },
);
// Declared so the click reaches the button itself, not the tooltip wrapper around it.
const emit = defineEmits<{ click: [event: MouseEvent] }>();
function click(event: MouseEvent) {
  if (!props.disabled) return emit('click', event);
  event.preventDefault();
  event.stopImmediatePropagation();
}
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
      :aria-disabled="disabled || undefined"
      @click="click"
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
    :disabled="to ? undefined : disabled"
    :aria-disabled="(to && disabled) || undefined"
    @click="click"
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
.base-icon-button:is(:disabled, [aria-disabled='true']) {
  opacity: 0.5;
  cursor: default;
}
.base-icon-button:hover:not(:disabled, [aria-disabled='true']) {
  background: var(--hover);
  color: var(--text);
}
.base-icon-button:active:not(:disabled, [aria-disabled='true']),
.pressed {
  background: var(--selected);
  color: var(--text);
}
.base-icon-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--focus);
}
</style>
