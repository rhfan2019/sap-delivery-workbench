<script setup lang="ts">
import { DropdownMenuItem } from 'reka-ui';
import BaseKbd from './BaseKbd.vue';
// One menu row: coloured icon, label, a muted note and a shortcut.
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'blue' | 'green' | 'purple' | 'red' | 'yellow';
    note?: string;
    kbd?: string;
    disabled?: boolean;
    danger?: boolean;
  }>(),
  { tone: 'neutral' },
);
const emit = defineEmits<{ select: [] }>();
</script>
<template>
  <DropdownMenuItem
    class="base-menu-item"
    :class="{ danger }"
    :disabled="disabled"
    @select="emit('select')"
  >
    <span v-if="$slots.icon" class="icon" :style="{ color: `var(--${tone}-icon-1)` }"
      ><slot name="icon"
    /></span>
    <span class="text"><slot /></span>
    <span v-if="note" class="note">{{ note }}</span>
    <BaseKbd v-if="kbd" :keys="kbd" />
  </DropdownMenuItem>
</template>
<style scoped>
.icon {
  display: inline-grid;
  place-items: center;
}
.text {
  white-space: nowrap;
}
.note {
  flex: 1;
  overflow: hidden;
  color: var(--text-subtle);
  font-size: var(--font-12);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text:last-child,
.text:has(+ .base-kbd) {
  flex: 1;
}
.danger {
  color: var(--red-text-2);
}
</style>
