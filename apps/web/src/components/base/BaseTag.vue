<script setup lang="ts">
// Tag (DESIGN.md 5): a hue's light fill and dark text; "outline" is a neutral chip with a border
// (labels like ‹› Account in Plain). Status tags carry their words, never colour alone.
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'blue' | 'green' | 'purple' | 'red' | 'yellow';
    variant?: 'fill' | 'outline';
    strike?: boolean;
  }>(),
  { tone: 'neutral', variant: 'fill' },
);
</script>
<template>
  <span
    class="base-tag"
    :class="['is-' + variant, { strike }]"
    :style="
      variant === 'fill'
        ? { background: `var(--${tone}-fill-1)`, color: `var(--${tone}-text-1)` }
        : undefined
    "
    ><span v-if="$slots.icon" class="icon" :style="{ color: `var(--${tone}-icon-1)` }"
      ><slot name="icon" /></span
    ><slot
  /></span>
</template>
<style scoped>
.base-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 20px;
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-4);
  font-size: var(--font-12);
  font-weight: var(--weight-475);
  line-height: var(--leading-16);
  white-space: nowrap;
}
.is-outline {
  padding: 0 var(--space-2) 0 var(--space-1);
  border-radius: var(--radius-6);
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-weight: var(--weight-400);
}
.is-outline .icon {
  color: var(--neutral-icon-1) !important;
}
.icon {
  display: inline-grid;
  place-items: center;
}
.icon :deep(svg) {
  width: 12px;
  height: 12px;
}
.strike {
  text-decoration: line-through;
}
</style>
