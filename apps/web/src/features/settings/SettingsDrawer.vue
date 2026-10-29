<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue';
import { X } from '@lucide/vue';
import './settings.css';

// The drawer of a settings list (DESIGN.md 5 “抽屉”, 6.2), after 大模型: a non-modal dialog on the
// right edge, so the list beside it stays usable. Its fields go in sections of `.s-field` rows;
// the footer carries one line of note and the actions. `wide` (720) holds a record with a tree
// or several lists, such as a role and its permissions.
defineProps<{
  title: string;
  description?: string;
  busy?: boolean;
  closeLabel?: string;
  note?: string;
  wide?: boolean;
}>();
const emit = defineEmits<{ close: []; submit: [] }>();
const id = useId();
const dialog = ref<HTMLDialogElement | null>(null);
let trigger: HTMLElement | null = null;
onMounted(() => {
  trigger = document.activeElement as HTMLElement;
  dialog.value?.show();
});
onUnmounted(() => {
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
});
</script>
<template>
  <dialog
    ref="dialog"
    class="s-drawer"
    :class="{ wide }"
    :aria-labelledby="id"
    @cancel.prevent="emit('close')"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <form @submit.prevent="emit('submit')">
      <header class="s-drawer-head">
        <div>
          <h2 :id="id">{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          :aria-label="closeLabel ?? '关闭'"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="20" />
        </button>
      </header>
      <div class="s-drawer-body"><slot /></div>
      <footer class="s-drawer-foot">
        <span>{{ note }}</span
        ><slot name="actions" />
      </footer>
    </form>
  </dialog>
</template>
