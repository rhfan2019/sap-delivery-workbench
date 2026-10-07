<script setup lang="ts">
import { computed } from 'vue';
import type { BundledLanguage } from 'shiki';
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ai-elements/code-block';
const props = defineProps<{ node: { value: string; lang?: string | null } }>();
const language = computed(
  () =>
    ([
      'abap',
      'sql',
      'json',
      'xml',
      'javascript',
      'typescript',
      'python',
      'java',
      'bash',
      'yaml',
      'html',
      'css',
    ].includes(props.node.lang ?? '')
      ? props.node.lang
      : 'text') as BundledLanguage,
);
</script>
<template>
  <CodeBlock :code="node.value" :language="language" class="my-3 w-full">
    <CodeBlockHeader
      ><CodeBlockTitle>{{ node.lang || '文本' }}</CodeBlockTitle
      ><CodeBlockCopyButton aria-label="复制代码"
    /></CodeBlockHeader>
  </CodeBlock>
</template>
