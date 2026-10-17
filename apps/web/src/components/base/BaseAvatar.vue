<script setup lang="ts">
import { computed } from 'vue';
// Avatar (DESIGN.md 5): a rounded square with the first letter; the hue follows the name, so the
// same person always has the same colour.
const props = withDefaults(
  defineProps<{
    name: string;
    size?: 20 | 24 | 32;
    hue?: 'blue' | 'green' | 'purple' | 'red' | 'yellow' | 'neutral';
  }>(),
  { size: 24 },
);
const hues = ['blue', 'green', 'purple', 'red', 'yellow'] as const;
const tone = computed(() => {
  if (props.hue) return props.hue;
  let sum = 0;
  for (const ch of props.name) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[sum % hues.length];
});
const initial = computed(() => (props.name.trim()[0] ?? '?').toUpperCase());
</script>
<template>
  <span
    class="base-avatar"
    :class="'s' + size"
    :style="{ background: `var(--${tone}-solid-1)` }"
    :title="name"
    aria-hidden="true"
    >{{ initial }}</span
  >
</template>
<style scoped>
.base-avatar {
  display: inline-grid;
  flex-shrink: 0;
  place-items: center;
  border-radius: var(--radius-4);
  color: var(--neutral-on-solid);
  font-weight: var(--weight-550);
  line-height: 1;
  user-select: none;
}
.s20 {
  width: 20px;
  height: 20px;
  font-size: var(--font-11);
}
.s24 {
  width: 24px;
  height: 24px;
  font-size: var(--font-12);
}
.s32 {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-6);
  font-size: var(--font-14);
}
</style>
