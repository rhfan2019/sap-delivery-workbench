<script setup lang="ts">
// Loading placeholder in the shape of what is coming (DESIGN.md 5); it breathes, it does not spin.
withDefaults(defineProps<{ width?: string; height?: string }>(), { width: '100%', height: '14px' });
</script>
<template>
  <span class="base-skeleton" :style="{ width, height }" aria-hidden="true"></span>
</template>
<style scoped>
.base-skeleton {
  display: block;
  border-radius: var(--radius-4);
  background: var(--neutral-fill-1);
  animation: base-pulse calc(var(--duration-slow) * 5) ease-in-out infinite;
}
</style>
