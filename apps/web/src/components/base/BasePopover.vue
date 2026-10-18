<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
// A floating panel for filters, pickers and small forms.
const open = defineModel<boolean>('open', { default: false });
withDefaults(
  defineProps<{ align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'right' }>(),
  {
    align: 'start',
    side: 'bottom',
  },
);
</script>
<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child><slot name="trigger" /></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="base-surface base-popover"
        :align="align"
        :side="side"
        :side-offset="6"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
<style>
.base-popover {
  padding: var(--space-3);
}
</style>
