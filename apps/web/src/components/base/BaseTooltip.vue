<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui';
import BaseKbd from './BaseKbd.vue';
// Dark hint that appears after a short pause (DESIGN.md 5).
withDefaults(
  defineProps<{ text: string; kbd?: string; side?: 'top' | 'right' | 'bottom' | 'left' }>(),
  {
    side: 'top',
  },
);
</script>
<template>
  <TooltipProvider :delay-duration="400">
    <TooltipRoot>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="base-tooltip" :side="side" :side-offset="6"
          >{{ text }}<BaseKbd v-if="kbd" :keys="kbd" tone="inverse"
        /></TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
<style>
.base-tooltip {
  z-index: 80;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-6);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-size: var(--font-12);
  line-height: var(--leading-16);
  animation: base-pop-in var(--motion-base);
}
</style>
