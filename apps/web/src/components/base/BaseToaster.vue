<script setup lang="ts">
import { CheckCircle2, CircleAlert, Info, X } from '@lucide/vue';
import { dismiss, toasts } from './toast';
// Mounted once; shows the messages queued with toast().
const icons = { neutral: Info, green: CheckCircle2, red: CircleAlert };
</script>
<template>
  <div class="base-toaster" role="status" aria-live="polite">
    <TransitionGroup name="base-toast">
      <div v-for="t in toasts" :key="t.id" class="base-toast">
        <component :is="icons[t.tone]" class="icon" :style="{ color: `var(--${t.tone}-icon-1)` }" />
        <span>{{ t.text }}</span>
        <button type="button" aria-label="关闭" @click="dismiss(t.id)"><X /></button>
      </div>
    </TransitionGroup>
  </div>
</template>
<style scoped>
.base-toaster {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 90;
  display: grid;
  gap: var(--space-2);
}
.base-toast {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 260px;
  padding: var(--space-2-5) var(--space-3);
  border-radius: var(--radius-8);
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-popover);
  font-size: var(--font-14);
}
.icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
button {
  display: inline-grid;
  place-items: center;
  margin-left: auto;
  padding: var(--space-0-5);
  border: 0;
  border-radius: var(--radius-4);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
button:hover {
  background: var(--hover);
}
button svg {
  width: 14px;
  height: 14px;
}
.base-toast-enter-active,
.base-toast-leave-active {
  transition:
    opacity var(--motion-base),
    transform var(--motion-base);
}
.base-toast-enter-from,
.base-toast-leave-to {
  opacity: 0;
  transform: translateX(8px);
}
</style>
