<script setup lang="ts">
// A system event in a timeline (DESIGN.md 6.3): one grey line, tags may sit inside, time right.
defineProps<{ time?: string }>();
</script>
<template>
  <div class="base-event">
    <span class="mark"
      ><slot name="icon"><span class="dot"></span></slot
    ></span>
    <span class="text"><slot /></span>
    <span v-if="time" class="time">{{ time }}</span>
  </div>
</template>
<style scoped>
.base-event {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 24px;
  color: var(--text-muted);
  font-size: var(--font-14);
}
.mark {
  display: inline-grid;
  place-items: center;
  width: 16px;
  color: var(--neutral-icon-1);
}
.mark :deep(svg) {
  width: 16px;
  height: 16px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-icon-2);
}
.text {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}
.text :deep(strong) {
  color: var(--text);
  font-weight: var(--weight-550);
}
.time {
  margin-left: auto;
  font-size: var(--font-12);
}
</style>
