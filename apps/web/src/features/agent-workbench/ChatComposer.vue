<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { Plus, Square, ArrowUp, Check, ChevronDown, LoaderCircle } from '@lucide/vue';
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
import {
  ModelSelector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorEmpty,
  ModelSelectorItem,
  ModelSelectorName,
  ModelSelectorGroup,
} from '@/components/ai-elements/model-selector';
import { Button } from '@/components/ui/button';
import { composerState } from './presentation.mjs';
import type { ModelRecord } from '../models/types';
const text = defineModel<string>({ required: true });
const modelId = defineModel<string>('modelId', { required: true });
const props = defineProps<{
  models: ModelRecord[];
  busy: boolean;
  blocked: boolean;
  loading: boolean;
  stopping: boolean;
  dragging: boolean;
  quiet?: boolean;
}>();
const emit = defineEmits<{ send: []; stop: []; attach: []; files: [files: File[]] }>();
const state = computed(() => composerState({ ...props, text: text.value, modelId: modelId.value }));
const modelOpen = ref(false);
const selectedName = computed(
  () =>
    props.models.find((m) => m.id === modelId.value)?.name ??
    (props.loading ? '加载模型…' : '选择模型'),
);
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
        placeholder="描述需求，或继续追问…"
        :readonly="blocked && !busy"
        maxlength="20000"
        class="min-h-20 px-4 py-3"
      />
    </PromptInputBody>
    <!-- One type size for the hint, the SAP system and the model; the hint gives way first. -->
    <PromptInputFooter class="composer-footer">
      <PromptInputTools>
        <PromptInputButton
          aria-label="添加文件或图片"
          :disabled="busy || blocked || loading"
          @click="emit('attach')"
          ><Plus class="size-5"
        /></PromptInputButton>
        <span class="composer-hint whitespace-nowrap text-xs text-muted-foreground"
          >Enter 发送 · Shift + Enter 换行</span
        >
      </PromptInputTools>
      <div class="flex min-w-0 items-center gap-2">
        <slot name="tools" />
        <ModelSelector v-model:open="modelOpen">
          <ModelSelectorTrigger as-child
            ><Button
              type="button"
              variant="ghost"
              size="sm"
              class="min-w-0 max-w-48 shrink text-xs font-normal text-muted-foreground"
              aria-label="选择模型"
              :disabled="busy || loading || blocked"
              ><span class="truncate">{{ selectedName }}</span
              ><ChevronDown class="size-4" /></Button
          ></ModelSelectorTrigger>
          <ModelSelectorContent
            title="选择模型"
            class="elements-overlay"
            :aria-describedby="undefined"
          >
            <ModelSelectorInput placeholder="搜索模型…" aria-label="搜索模型" />
            <ModelSelectorList
              ><ModelSelectorEmpty>没有匹配的模型</ModelSelectorEmpty>
              <ModelSelectorGroup heading="可用模型">
                <ModelSelectorItem
                  v-for="m in models"
                  :key="m.id"
                  :value="m.name + ' ' + m.id"
                  @select="
                    modelId = m.id;
                    modelOpen = false;
                  "
                >
                  <ModelSelectorName>{{ m.name }}</ModelSelectorName
                  ><Check v-if="modelId === m.id" class="ml-auto size-4" />
                </ModelSelectorItem>
              </ModelSelectorGroup>
            </ModelSelectorList>
          </ModelSelectorContent>
        </ModelSelector>
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
          :disabled="!state.canSend"
          class="size-10 rounded-full"
          ><ArrowUp class="size-5"
        /></PromptInputSubmit>
      </div>
    </PromptInputFooter>
  </PromptInput>
</template>
<style scoped>
.composer-footer {
  container-type: inline-size;
}
@container (max-width: 560px) {
  .composer-hint {
    display: none;
  }
}
</style>
