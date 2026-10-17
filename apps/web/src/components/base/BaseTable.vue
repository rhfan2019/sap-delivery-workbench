<script setup lang="ts">
// Table look (DESIGN.md 5): no vertical lines, small grey header, 44px rows, grey on hover.
// Holds a plain <table>; the development list puts TanStack Table's rows in it (batch 3).
</script>
<template>
  <div class="base-table"><slot /></div>
</template>
<style scoped>
.base-table {
  overflow: auto;
}
.base-table :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-14);
}
.base-table :deep(th) {
  height: var(--control-table-head);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
  text-align: left;
  white-space: nowrap;
}
.base-table :deep(td) {
  height: var(--control-table-row);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.base-table :deep(tbody tr) {
  transition: background-color var(--motion-fast);
}
.base-table :deep(tbody tr:hover) {
  background: var(--hover);
}
.base-table :deep(tbody tr[aria-selected='true']) {
  background: var(--blue-bg-2);
}
.base-table :deep(.primary-cell) {
  font-weight: var(--weight-550);
}
.base-table :deep(.muted-cell) {
  color: var(--text-muted);
}
</style>
