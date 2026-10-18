<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { X } from '@lucide/vue';
// Dialog (DESIGN.md 5): the scrim fades, the panel rises 16px and grows from 0.96.
const open = defineModel<boolean>('open', { default: false });
// `wide` gives forms with several columns or long lists more room.
defineProps<{ title: string; description?: string; wide?: boolean }>();
</script>
<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="base-scrim" />
      <DialogContent class="base-dialog" :class="{ wide }">
        <header>
          <DialogTitle class="title">{{ title }}</DialogTitle>
          <DialogClose class="close" aria-label="关闭"><X /></DialogClose>
        </header>
        <DialogDescription v-if="description" class="description">{{
          description
        }}</DialogDescription>
        <div class="body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
<style>
.base-scrim {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--scrim);
  animation: base-fade-in var(--motion-base);
}
.base-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 61;
  width: min(480px, calc(100vw - 32px));
  max-height: calc(100dvh - 64px);
  overflow: auto;
  padding: var(--space-5);
  border-radius: var(--radius-12);
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-dialog);
  transform: translate(-50%, -50%);
  animation: base-dialog-in var(--motion-slow);
}
.base-dialog.wide {
  width: min(680px, calc(100vw - 32px));
}
.base-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.base-dialog .title {
  margin: 0;
  font-size: var(--font-16);
  font-weight: var(--weight-550);
}
.base-dialog .close {
  display: inline-grid;
  place-items: center;
  width: var(--control-tab);
  height: var(--control-tab);
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.base-dialog .close:hover {
  background: var(--hover);
}
.base-dialog .close svg {
  width: 16px;
  height: 16px;
}
.base-dialog .description {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--font-14);
}
.base-dialog .body {
  margin-top: var(--space-4);
}
.base-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
