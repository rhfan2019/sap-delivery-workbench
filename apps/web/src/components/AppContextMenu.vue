<script setup lang="ts">
import { ref, type Component } from 'vue';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from 'reka-ui';
// The shell's right-click menu (DESIGN.md 4.1 “标签栏”): `resolve` names the rows for what was
// clicked, or nothing, which leaves the browser's own menu.
export interface ContextItem {
  label: string;
  icon: Component;
  run: () => unknown;
}
const props = defineProps<{ resolve: (target: EventTarget | null) => ContextItem[] | null }>();
const items = ref<ContextItem[]>([]);
function pick(event: MouseEvent) {
  const found = props.resolve(event.target);
  if (!found?.length) {
    event.stopPropagation();
    return;
  }
  items.value = found;
}
</script>
<template>
  <ContextMenuRoot :modal="false">
    <ContextMenuTrigger as-child @contextmenu.capture="pick"><slot /></ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="base-surface">
        <ContextMenuItem
          v-for="item in items"
          :key="item.label"
          class="base-menu-item"
          @select="item.run()"
        >
          <component :is="item.icon" class="context-icon" />{{ item.label }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
<style scoped>
.context-icon {
  color: var(--neutral-icon-1);
}
</style>
