<script setup lang="ts">
// Empty state (DESIGN.md 5): an icon tile, a title, two lines of explanation and one action.
defineProps<{ title: string; text?: string }>();
</script>
<template>
  <div class="base-empty">
    <span v-if="$slots.icon" class="tile"><slot name="icon" /></span>
    <p class="title">{{ title }}</p>
    <p v-if="text" class="text">{{ text }}</p>
    <div v-if="$slots.default" class="action"><slot /></div>
  </div>
</template>
<style scoped>
.base-empty {
  display: grid;
  justify-items: center;
  gap: var(--space-1);
  padding: var(--space-6) var(--space-4);
  text-align: center;
}
.tile {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-bottom: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--panel);
  color: var(--text-muted);
}
.tile :deep(svg) {
  width: 16px;
  height: 16px;
}
.title {
  margin: 0;
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.text {
  max-width: 34ch;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-14);
  line-height: var(--leading-20);
}
.action {
  margin-top: var(--space-3);
}
</style>
