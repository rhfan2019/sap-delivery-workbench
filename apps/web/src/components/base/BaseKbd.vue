<script setup lang="ts">
import { computed } from 'vue';
// Keyboard hint (DESIGN.md 5): "Ctrl+Enter" renders as two keys.
const props = withDefaults(defineProps<{ keys: string; tone?: 'default' | 'inverse' }>(), {
  tone: 'default',
});
const parts = computed(() => props.keys.split('+').map((k) => (k === 'Enter' ? '↵' : k)));
</script>
<template>
  <span class="base-kbd" :class="tone" aria-hidden="true"
    ><kbd v-for="key in parts" :key="key">{{ key }}</kbd></span
  >
</template>
<style scoped>
.base-kbd {
  display: inline-flex;
  gap: var(--space-0-5);
}
kbd {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-4);
  background: var(--panel);
  color: var(--text-muted);
  font: inherit;
  font-size: var(--font-11);
  font-weight: var(--weight-550);
  line-height: 1;
}
.inverse kbd {
  border-color: color-mix(in srgb, var(--on-primary) 30%, transparent);
  background: transparent;
  color: color-mix(in srgb, var(--on-primary) 80%, transparent);
}
</style>
