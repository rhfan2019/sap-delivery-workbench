<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { CornerUpLeft, X } from '@lucide/vue';
import BaseButton from './BaseButton.vue';
import BaseKbd from './BaseKbd.vue';
// Composer that opens above the action bar (DESIGN.md 5): a title row, the text, a tool row and
// the send button. Ctrl + Enter sends, Esc closes.
const text = defineModel<string>({ default: '' });
withDefaults(
  defineProps<{ title: string; placeholder?: string; send?: string; busy?: boolean }>(),
  { placeholder: '输入内容…', send: '发送' },
);
const emit = defineEmits<{ submit: []; close: [] }>();
const input = ref<HTMLTextAreaElement | null>(null);
onMounted(() => nextTick(() => input.value?.focus()));
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
  else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && text.value.trim()) {
    event.preventDefault();
    emit('submit');
  }
}
</script>
<template>
  <section class="base-composer" @keydown="key">
    <header>
      <CornerUpLeft class="lead" /><span class="title"
        ><slot name="title">{{ title }}</slot></span
      ><BaseKbd keys="esc" /><button
        type="button"
        class="close"
        aria-label="关闭"
        @click="emit('close')"
      >
        <X />
      </button>
    </header>
    <div class="field">
      <textarea
        ref="input"
        v-model="text"
        rows="3"
        :placeholder="placeholder"
        :aria-label="title"
      />
    </div>
    <footer>
      <span class="tools"><slot name="tools" /></span>
      <BaseButton
        variant="primary"
        size="sm"
        kbd="Ctrl+Enter"
        :disabled="!text.trim()"
        :loading="busy"
        @click="emit('submit')"
        >{{ send }}</BaseButton
      >
    </footer>
  </section>
</template>
<style scoped>
.base-composer {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-floating);
  animation: base-from-bottom var(--motion-base);
}
header {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.lead {
  width: 14px;
  height: 14px;
}
.title {
  flex: 1;
}
.title :deep(strong) {
  color: var(--text);
  font-weight: var(--weight-475);
}
.close {
  display: inline-grid;
  place-items: center;
  padding: var(--space-0-5);
  border: 0;
  border-radius: var(--radius-4);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.close:hover {
  background: var(--hover);
}
.close svg {
  width: 14px;
  height: 14px;
}
.field {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-8);
  transition:
    border-color var(--motion-fast),
    box-shadow var(--motion-fast);
}
.field:focus-within {
  border-color: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
}
textarea {
  display: block;
  width: 100%;
  min-height: 64px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  outline: none;
  resize: vertical;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--font-14);
  line-height: var(--leading-20);
}
textarea::placeholder {
  color: var(--text-subtle);
}
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tools {
  display: inline-flex;
  gap: var(--space-0-5);
}
</style>
