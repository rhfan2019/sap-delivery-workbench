<script setup lang="ts">
// A drag handle on the right edge of a panel (DESIGN.md 4.1): drag or use ←/→ to change the
// panel's width between min and max. The parent keeps the width and must be position: relative.
const width = defineModel<number>({ required: true });
const props = withDefaults(
  defineProps<{ min: number; max: number; label: string; step?: number }>(),
  {
    step: 24,
  },
);
const emit = defineEmits<{ done: [width: number] }>();
const clamp = (value: number) => Math.round(Math.min(props.max, Math.max(props.min, value)));

function start(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const from = event.clientX,
    initial = width.value;
  document.documentElement.classList.add('is-resizing');
  const move = (e: PointerEvent) => (width.value = clamp(initial + e.clientX - from));
  const stop = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    document.documentElement.classList.remove('is-resizing');
    emit('done', width.value);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}
function nudge(delta: number) {
  width.value = clamp(width.value + delta);
  emit('done', width.value);
}
</script>
<template>
  <div
    class="base-resize-handle"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="width"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="start"
    @dblclick="emit('done', width)"
    @keydown.left.prevent="nudge(-step)"
    @keydown.right.prevent="nudge(step)"
  />
</template>
<style>
.base-resize-handle {
  position: absolute;
  top: 0;
  right: calc(var(--space-1) * -1);
  bottom: 0;
  z-index: 5;
  width: var(--space-2);
  cursor: col-resize;
  touch-action: none;
}
.base-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: transparent;
  transition: background var(--motion-fast);
}
.base-resize-handle:hover::after,
.base-resize-handle:focus-visible::after,
.is-resizing .base-resize-handle::after {
  background: var(--blue-solid-1);
}
.base-resize-handle:focus-visible {
  outline: none;
}
/* While dragging, the page does not select text and keeps the resize cursor everywhere. */
.is-resizing,
.is-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
</style>
