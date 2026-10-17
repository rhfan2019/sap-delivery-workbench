<script setup lang="ts">
// Selecting text in a document or the code offers a small “批注” button beside the selection;
// only clicking it opens the comment box. Both float above the page, so nothing moves.
// `save` hands the comment on (the panels quote it into the conversation).
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { MessageSquarePlus } from '@lucide/vue';

const props = defineProps<{
  disabled?: boolean;
  save: (text: string, body: string, context: unknown) => void | Promise<void>;
}>();

type State = {
  mode: 'button' | 'form';
  text: string;
  context: unknown;
  rect: { top: number; bottom: number; left: number; right: number };
};
const state = ref<State | null>(null);
const body = ref(''),
  error = ref(''),
  saving = ref(false);
const card = ref<HTMLElement | null>(null),
  input = ref<HTMLTextAreaElement | null>(null);

const BUTTON = { width: 76, height: 32 },
  FORM = { width: 340, height: 196 },
  GAP = 8;

// Called by the viewer when the reader finishes a selection.
function offer(text: string, context: unknown = null) {
  if (props.disabled || saving.value || state.value?.mode === 'form') return;
  const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
  const r = range?.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) return;
  state.value = {
    mode: 'button',
    text,
    context,
    rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
  };
}
defineExpose({ offer });

function place(size: { width: number; height: number }) {
  const s = state.value!;
  const left = Math.min(
    Math.max(GAP, (s.rect.left + s.rect.right) / 2 - size.width / 2),
    window.innerWidth - size.width - GAP,
  );
  // Above the selection, like a toolbar; below it when there is no room above.
  const above = s.rect.top - size.height - GAP;
  const top =
    above >= GAP ? above : Math.min(s.rect.bottom + GAP, window.innerHeight - size.height - GAP);
  return { left: left + 'px', top: top + 'px' };
}

async function open() {
  if (!state.value) return;
  state.value = { ...state.value, mode: 'form' };
  body.value = '';
  error.value = '';
  await nextTick();
  input.value?.focus();
}
function close() {
  state.value = null;
  body.value = '';
  error.value = '';
}
async function submit() {
  if (!state.value || !body.value.trim() || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await props.save(state.value.text, body.value.trim(), state.value.context);
    close();
    window.getSelection()?.removeAllRanges();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

// The button goes away with the selection, on scroll, or on a click elsewhere; the open box
// only closes on Esc, Cancel, or a click outside while it is still empty.
function onSelectionChange() {
  if (state.value?.mode === 'button' && !window.getSelection()?.toString().trim()) close();
}
function onScroll() {
  if (state.value?.mode === 'button') close();
}
function onPointerDown(event: PointerEvent) {
  if (!state.value || card.value?.contains(event.target as Node)) return;
  if (state.value.mode === 'button' || !body.value.trim()) close();
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && state.value) close();
}
onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', onScroll, true);
});
</script>
<template>
  <slot />
  <Teleport to="body">
    <button
      v-if="state?.mode === 'button'"
      ref="card"
      type="button"
      class="selection-comment-button"
      :style="place(BUTTON)"
      @mousedown.prevent
      @click="open"
    >
      <MessageSquarePlus :size="15" />批注
    </button>
    <form
      v-else-if="state?.mode === 'form'"
      ref="card"
      class="selection-comment-form"
      :style="place(FORM)"
      aria-label="添加批注"
      @submit.prevent="submit"
    >
      <blockquote>
        {{ state.text.slice(0, 160) }}{{ state.text.length > 160 ? '…' : '' }}
      </blockquote>
      <textarea
        ref="input"
        v-model="body"
        rows="3"
        aria-label="批注内容"
        placeholder="写下修改意见，Ctrl + Enter 加入对话"
        @keydown.ctrl.enter.prevent="submit"
        @keydown.meta.enter.prevent="submit"
      />
      <p v-if="error" role="alert">{{ error }}</p>
      <div>
        <button type="button" @click="close">取消</button>
        <button type="submit" class="primary" :disabled="saving || !body.trim()">
          {{ saving ? '正在加入…' : '加入对话' }}
        </button>
      </div>
    </form>
  </Teleport>
</template>
<style>
.selection-comment-button,
.selection-comment-form {
  position: fixed;
  z-index: 60;
  border: 1px solid var(--input-border);
  border-radius: var(--input-radius);
  background: var(--input-bg);
  color: var(--text);
  box-shadow: 0 6px 24px color-mix(in srgb, var(--story-bg) 18%, transparent);
  font-size: var(--font-size-sm);
}
.selection-comment-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 32px;
  padding: 0 var(--space-2-5);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}
.selection-comment-button:hover {
  background: var(--hover);
}
.selection-comment-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 340px;
  padding: var(--space-2-5) var(--space-3);
}
.selection-comment-form blockquote {
  margin: 0;
  padding-left: var(--space-2);
  border-left: 3px solid var(--border);
  color: var(--muted);
  max-height: 3.2em;
  overflow: hidden;
}
.selection-comment-form textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--input-border);
  border-radius: var(--input-radius);
  padding: var(--space-1-5) var(--space-2);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
}
.selection-comment-form p {
  margin: 0;
  color: var(--error-text);
}
.selection-comment-form div {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.selection-comment-form button {
  border: 1px solid var(--control-border);
  border-radius: var(--button-radius);
  padding: var(--space-1) var(--space-3);
  background: var(--surface);
  color: var(--text);
}
.selection-comment-form button.primary {
  border-color: var(--primary);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}
.selection-comment-form button:disabled {
  opacity: 0.5;
}
</style>
