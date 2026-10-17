<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui';
// A dropdown menu (DESIGN.md 5): put BaseMenuItem, BaseMenuSeparator and BaseMenuLabel inside.
withDefaults(
  defineProps<{ align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'right' | 'left' }>(),
  {
    align: 'start',
    side: 'bottom',
  },
);
</script>
<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="base-surface" :align="align" :side="side" :side-offset="6">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
