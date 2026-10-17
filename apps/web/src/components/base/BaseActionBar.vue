<script setup lang="ts">
// Floating action bar (DESIGN.md 5): groups of ghost buttons with shortcuts, each group its own
// white pill. Put BaseButton variant="ghost" inside each <div> group slot.
</script>
<template>
  <div class="base-action-bar" role="toolbar"><slot /></div>
</template>
<style scoped>
.base-action-bar {
  display: inline-flex;
  justify-content: center;
  white-space: nowrap;
  align-items: center;
  gap: var(--space-2);
}
.base-action-bar > :deep(*) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-floating);
}
.base-action-bar :deep(.base-button) {
  height: var(--control-icon);
  border-radius: var(--radius-8);
}
</style>
