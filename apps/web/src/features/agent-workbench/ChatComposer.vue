<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { AtSign, Paperclip, Plus, Square, ArrowUp, LoaderCircle } from '@lucide/vue';
import BaseMenu from '../../components/base/BaseMenu.vue';
import BaseMenuItem from '../../components/base/BaseMenuItem.vue';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import {
  PROMPT_INPUT_KEY,
  type PromptInputContext,
} from '@/components/ai-elements/prompt-input/types';
import { composerState } from './presentation.mjs';
const text = defineModel<string>({ required: true });
const props = defineProps<{
  // A model is available for the next message (spec 4.3).
  ready: boolean;
  busy: boolean;
  blocked: boolean;
  loading: boolean;
  stopping: boolean;
  dragging: boolean;
  quiet?: boolean;
  // Empty by default: the start page already says what to write (spec 3).
  placeholder?: string;
}>();
const emit = defineEmits<{
  send: [];
  stop: [];
  attach: [];
  reference: [];
  files: [files: File[]];
}>();
const state = computed(() => composerState({ ...props, text: text.value }));
function submit() {
  if (state.value.canSend) emit('send');
}
// Platform owns remote file identity and draft lifecycle; Elements consumes this context.
const context: PromptInputContext = {
  textInput: text,
  files: ref([]),
  fileInputRef: ref(null),
  isLoading: computed(() => props.busy),
  setTextInput: (value) => {
    text.value = value;
  },
  addFiles: (files) => {
    if (!props.busy && !props.blocked && !props.loading) emit('files', Array.from(files));
  },
  removeFile: () => {},
  clearFiles: () => {},
  clearInput: () => {
    text.value = '';
  },
  openFileDialog: () => emit('attach'),
  submitForm: submit,
};
provide(PROMPT_INPUT_KEY, context);
</script>
<template>
  <PromptInput
    class="elements-composer"
    :class="{ 'ring-2 ring-primary': dragging }"
    @keydown.escape="state.canStop && emit('stop')"
  >
    <div v-if="$slots.default" class="w-full px-3 pt-3"><slot /></div>
    <PromptInputBody>
      <PromptInputTextarea
        aria-label="输入消息"
        :placeholder="placeholder ?? ''"
        :readonly="blocked && !busy"
        maxlength="20000"
        class="min-h-20 px-4 py-3"
      />
    </PromptInputBody>
    <!-- One type size for the SAP system and the model; the key hint lives on the send button. -->
    <PromptInputFooter class="composer-footer">
      <PromptInputTools>
        <!-- Upload, or reference what the item already has (spec 4.1). -->
        <BaseMenu side="top">
          <template #trigger>
            <PromptInputButton aria-label="添加资料" :disabled="busy || blocked || loading"
              ><Plus class="size-5"
            /></PromptInputButton>
          </template>
          <BaseMenuItem kbd="U" @select="emit('attach')"
            ><template #icon><Paperclip :size="14" /></template>上传文件或图片</BaseMenuItem
          >
          <BaseMenuItem kbd="@" @select="emit('reference')"
            ><template #icon><AtSign :size="14" /></template>引用开发项资料…</BaseMenuItem
          >
          <p class="composer-menu-note">也可以直接粘贴截图或拖入文件</p>
        </BaseMenu>
      </PromptInputTools>
      <div class="flex min-w-0 items-center gap-2">
        <slot name="tools" />
        <PromptInputButton
          v-if="busy"
          aria-label="停止生成"
          :disabled="!state.canStop"
          class="size-10 rounded-full bg-primary text-primary-foreground"
          @click="emit('stop')"
          ><LoaderCircle v-if="stopping" class="size-4 animate-spin" /><Square
            v-else
            class="size-4"
            fill="currentColor"
        /></PromptInputButton>
        <PromptInputSubmit
          v-else
          aria-label="发送消息"
          title="发送（Enter）· Shift + Enter 换行"
          :disabled="!state.canSend"
          class="size-10 rounded-full"
          ><ArrowUp class="size-5"
        /></PromptInputSubmit>
      </div>
    </PromptInputFooter>
  </PromptInput>
</template>
<style scoped>
.composer-menu-note {
  margin: var(--space-1) 0 0;
  padding: var(--space-1) var(--space-2);
  border-top: 1px solid var(--border);
  font-size: var(--font-11);
  color: var(--text-muted);
}
.composer-footer {
  container-type: inline-size;
}
@container (max-width: 560px) {
  .composer-footer :deep(.context-trigger.collapsible .context-value) {
    display: none;
  }
}
</style>
