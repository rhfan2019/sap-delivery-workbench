<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useMutationObserver } from '@vueuse/core';
import { createOutline, type OutlineItem } from './outline.mjs';
import { MessageResponse } from '@/components/ai-elements/message';
import { assistantMarkdownRenderers } from '../assistant-ui/markdown-renderers';
const props = defineProps<{ content: string; headingPrefix?: string; streaming?: boolean }>();
const emit = defineEmits<{ outline: [items: OutlineItem[]]; rendered: [content: string] }>();
const container = ref<HTMLElement | null>(null);
let outlineFrame = 0;
function scheduleOutline() {
  if (outlineFrame) return;
  outlineFrame = requestAnimationFrame(() => {
    outlineFrame = 0;
    collectOutline();
    if (
      container.value?.querySelector('p,h1,h2,h3,table,ul,ol,pre') &&
      container.value.textContent?.trim()
    )
      emit('rendered', props.content);
  });
}
function collectOutline() {
  if (!props.headingPrefix || !container.value) return;
  const headings = [...container.value.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')];
  const items = createOutline(
    headings.map((h) => ({ level: Number(h.tagName.slice(1)), text: h.textContent ?? '' })),
    props.headingPrefix,
  );
  headings.forEach((heading, index) => {
    heading.id = items[index]!.id;
    heading.tabIndex = -1;
  });
  emit('outline', items);
}
// Stream Markdown loads renderers asynchronously, beyond Vue's initial nextTick.
useMutationObserver(container, scheduleOutline, {
  childList: true,
  subtree: true,
  characterData: true,
});
onBeforeUnmount(() => cancelAnimationFrame(outlineFrame));
watch(
  () => [props.content, props.headingPrefix],
  async () => {
    await nextTick();
    scheduleOutline();
  },
  { immediate: true, flush: 'post' },
);
</script>
<template>
  <div ref="container" class="chat-markdown elements-markdown">
    <MessageResponse
      :content="content"
      :mode="streaming ? 'streaming' : 'static'"
      :node-renderers="assistantMarkdownRenderers"
      :harden-options="{ allowedProtocols: ['http', 'https', 'mailto'], allowDataImages: false }"
      :link-options="{ safetyCheck: false }"
      :enable-animate="false"
      :controls="false"
      locale="zh-CN"
    />
  </div>
</template>
<style scoped>
.chat-markdown {
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.chat-markdown :deep(p) {
  margin: 0 0 7px;
}
.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3) {
  line-height: 1.5;
  margin: 16px 0 7px;
  font-weight: 650;
}
.chat-markdown :deep(h1) {
  font-size: 22px;
}
.chat-markdown :deep(h2) {
  font-size: 19px;
}
.chat-markdown :deep(h3) {
  font-size: 16px;
}
.chat-markdown :deep(pre) {
  max-width: 100%;
  overflow: auto;
  background: #f4f5f7;
  border-radius: 8px;
  padding: 14px;
  font:
    12px/1.7 ui-monospace,
    monospace;
  white-space: pre;
}
.chat-markdown :deep(code) {
  font-size: 0.9em;
  background: #f1f3f5;
  padding: 2px 4px;
  border-radius: 3px;
}
.chat-markdown :deep(pre code) {
  padding: 0;
  background: none;
}
.chat-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
  margin: 16px 0;
}
.chat-markdown :deep(th),
.chat-markdown :deep(td) {
  padding: 9px 12px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  white-space: normal;
  min-width: 80px;
}
.chat-markdown :deep(th) {
  background: #f7f8fa;
  font-weight: 600;
}
.chat-markdown :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}
.chat-markdown :deep(blockquote) {
  margin: 12px 0;
  padding-left: 16px;
  border-left: 3px solid #cbd5e1;
  color: #64748b;
}
</style>
