<script setup lang="ts">
import { ref } from 'vue';
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ai-elements/code-block';

// The program with line numbers. Selecting text reports it with the line it starts on,
// for a comment anchored on that text.
const props = defineProps<{ code: string; title: string }>();
const emit = defineEmits<{ select: [text: string, line: number] }>();
const body = ref<HTMLElement | null>(null);

function selected() {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (!text || !body.value?.contains(selection!.anchorNode)) return;
  // Line numbers are rendered beside the code; keep only text that exists in the source.
  const lines = text.split('\n').map((l) => l.replace(/^\s*\d+\s?/, ''));
  const anchor = lines.find((l) => l.trim() && props.code.includes(l.trim()))?.trim();
  if (!anchor) return;
  const at = props.code.indexOf(anchor);
  emit('select', anchor, props.code.slice(0, at).split('\n').length);
}
</script>
<template>
  <div ref="body" class="code-view" @mouseup="selected" @keyup="selected">
    <CodeBlock :code="code" language="abap" show-line-numbers class="w-full">
      <CodeBlockHeader
        ><CodeBlockTitle>{{ title }}</CodeBlockTitle
        ><CodeBlockCopyButton aria-label="复制整份代码"
      /></CodeBlockHeader>
    </CodeBlock>
  </div>
</template>
<style scoped>
.code-view {
  max-height: 70vh;
  overflow: auto;
}
</style>
