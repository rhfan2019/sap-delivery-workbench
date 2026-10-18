<script setup lang="ts">
// A row of counts above a list (Plain's “Owners & admins · Support · Viewer”).
defineProps<{ stats: { label: string; value: number | string; tone?: 'red' | 'yellow' }[] }>();
</script>
<template>
  <dl class="stat-grid">
    <div v-for="s in stats" :key="s.label" class="stat">
      <dd :class="s.tone">{{ s.value }}</dd>
      <dt>{{ s.label }}</dt>
    </div>
  </dl>
</template>
<style scoped>
.stat-grid {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
.stat {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: var(--space-0-5);
  padding: var(--space-3) var(--space-2);
  border-left: 1px solid var(--border);
}
.stat:first-child {
  border-left: 0;
}
dd {
  margin: 0;
  font-size: var(--font-20);
  line-height: var(--leading-28);
  font-variant-numeric: tabular-nums;
}
dd.red {
  color: var(--red-text-2);
}
dd.yellow {
  color: var(--yellow-text-2);
}
dt {
  color: var(--text-muted);
  font-size: var(--font-12);
}
@media (max-width: 560px) {
  .stat-grid {
    grid-auto-flow: row;
  }
  .stat {
    border-left: 0;
    border-top: 1px solid var(--border);
  }
  .stat:first-child {
    border-top: 0;
  }
}
</style>
