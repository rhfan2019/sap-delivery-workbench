<script setup lang="ts">
// A one-line band in a hue's light fill (DESIGN.md 5): status events, waiting for a decision.
withDefaults(defineProps<{ tone?: 'neutral' | 'blue' | 'green' | 'purple' | 'red' | 'yellow' }>(), {
  tone: 'blue',
});
</script>
<template>
  <div class="base-banner" :style="{ background: `var(--${tone}-fill-1)` }">
    <span v-if="$slots.icon" class="icon" :style="{ color: `var(--${tone}-icon-1)` }"
      ><slot name="icon"
    /></span>
    <span class="text"><slot /></span>
    <span v-if="$slots.action" class="action"><slot name="action" /></span>
  </div>
</template>
<style scoped>
.base-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 38px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-8);
  color: var(--text);
  font-size: var(--font-14);
}
.icon {
  display: inline-grid;
  place-items: center;
}
.icon :deep(svg) {
  width: 16px;
  height: 16px;
}
.text :deep(strong) {
  font-weight: var(--weight-550);
}
.action {
  margin-left: auto;
}
</style>
