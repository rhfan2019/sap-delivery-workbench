<script setup lang="ts">
import { computed } from 'vue';
import { hueOfName, type Hue } from './identity';
// Avatar (DESIGN.md 5, 2.2.1): a rounded square with the first letter; the hue follows the name,
// so the same person always has the same colour. Without a name it is a dashed empty square.
// A default slot replaces the letter (the assistant's icon).
const props = withDefaults(
  defineProps<{
    name: string;
    size?: 20 | 24 | 32;
    hue?: Hue;
  }>(),
  { size: 24 },
);
const tone = computed(() => props.hue ?? hueOfName(props.name));
const empty = computed(() => !props.name.trim());
const initial = computed(() => (props.name.trim()[0] ?? '?').toUpperCase());
</script>
<template>
  <span
    class="base-avatar"
    :class="['s' + size, { empty }]"
    :style="empty ? undefined : { background: `var(--${tone}-solid-1)` }"
    :title="name || undefined"
    aria-hidden="true"
    ><slot>{{ empty ? '' : initial }}</slot></span
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
.empty {
  border: 1px dashed var(--border-emphasis);
}
.base-avatar :deep(svg) {
  width: 60%;
  height: 60%;
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
