<script setup lang="ts">
// One "label / value" row of a details panel (DESIGN.md 5); an empty value reads 未设置.
defineProps<{ label: string; empty?: boolean }>();
</script>
<template>
  <div class="base-property-row">
    <dt>{{ label }}</dt>
    <dd :class="{ empty }"><slot v-if="!empty" /><template v-else>未设置</template></dd>
  </div>
</template>
<style scoped>
.base-property-row {
  display: grid;
  grid-template-columns: minmax(96px, 40%) 1fr;
  align-items: center;
  gap: var(--space-3);
  min-height: 28px;
}
dt {
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  margin: 0;
  font-size: var(--font-12);
}
.empty {
  color: var(--text-muted);
}
</style>
