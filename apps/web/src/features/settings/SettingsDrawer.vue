<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { PenLine, X } from '@lucide/vue';
import './settings.css';

// The drawer of a settings list (DESIGN.md 5 “抽屉”, 6.2), after 大模型: a non-modal dialog on the
// right edge, so the list beside it stays usable. Its fields go in sections of `.s-field` rows;
// the footer carries one line of note and the actions. `wide` (720) holds a record with a tree
// or several lists, such as a role and its permissions.
// A record opened from its row is `reading` (development-discipline.md 4.1): its `.s-fields` show
// values, and the footer offers 编辑 when `editable`, which switches the same drawer in place.
const props = defineProps<{
  title: string;
  description?: string;
  busy?: boolean;
  closeLabel?: string;
  note?: string;
  wide?: boolean;
  reading?: boolean;
  editable?: boolean;
}>();
const emit = defineEmits<{ close: []; submit: []; edit: [] }>();
const id = useId();
const dialog = ref<HTMLDialogElement | null>(null);
let trigger: HTMLElement | null = null;
onMounted(() => {
  trigger = document.activeElement as HTMLElement;
  dialog.value?.show();
});
// Turning to edit puts the caret in the first field that can change.
watch(
  () => props.reading,
  (now, before) => {
    if (now || !before) return;
    void nextTick(() =>
      dialog.value
        ?.querySelector<HTMLElement>(
          '.s-fields :is(input:not([type="checkbox"]), select, textarea):enabled',
        )
        ?.focus(),
    );
  },
);
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
    <form @submit.prevent="reading || emit('submit')">
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
        ><template v-if="reading"
          ><slot name="read-actions" /><button
            v-if="editable"
            type="button"
            class="primary-button"
            @click="emit('edit')"
          >
            <PenLine :size="16" />编辑
          </button></template
        ><slot v-else name="actions" />
      </footer>
    </form>
  </dialog>
</template>
