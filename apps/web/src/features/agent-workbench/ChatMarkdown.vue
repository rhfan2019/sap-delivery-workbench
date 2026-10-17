<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useMutationObserver } from '@vueuse/core';
import { createOutline, type OutlineItem } from './outline.mjs';
import { MessageResponse } from '@/components/ai-elements/message';
import { assistantMarkdownRenderers } from './markdown-renderers';
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
/* DESIGN.md 6: reading type for replies and documents. */
.chat-markdown {
  font-size: var(--font-size-lg);
  line-height: 26px;
  color: var(--text);
  overflow-wrap: anywhere;
}
.chat-markdown :deep(p) {
  margin: 0 0 var(--space-3);
}
.chat-markdown :deep(:is(ul, ol)) {
  margin: 0 0 var(--space-3);
  padding-left: 1.4em;
}
.chat-markdown :deep(li) {
  margin: var(--space-1) 0;
}
.chat-markdown :deep(li > p) {
  margin: 0;
}
.chat-markdown :deep(:is(h1, h2, h3, h4)) {
  margin: var(--space-6) 0 var(--space-2);
  font-weight: var(--font-weight-semibold);
  color: var(--text);
}
.chat-markdown :deep(:is(h1, h2, h3, h4):first-child) {
  margin-top: 0;
}
.chat-markdown :deep(h1) {
  font-size: var(--font-size-2xl);
  line-height: 28px;
}
.chat-markdown :deep(h2) {
  font-size: var(--font-size-xl);
  line-height: 26px;
}
.chat-markdown :deep(:is(h3, h4)) {
  font-size: var(--font-size-lg);
  line-height: 22px;
}
.chat-markdown :deep(strong) {
  font-weight: var(--font-weight-semibold);
}
.chat-markdown :deep(pre) {
  max-width: 100%;
  overflow: auto;
  margin: 0 0 var(--space-3);
  padding: var(--space-3) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  line-height: 20px;
  white-space: pre;
}
.chat-markdown :deep(code) {
  padding: var(--space-0-5) var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  font-family: var(--font-mono);
  font-size: 0.85em;
}
.chat-markdown :deep(pre code) {
  padding: 0;
  background: none;
}
.chat-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow: auto;
  margin: var(--space-1) 0 var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--font-size-md);
  line-height: 22px;
}
.chat-markdown :deep(:is(th, td)) {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--table-border);
  text-align: left;
  white-space: normal;
  min-width: 80px;
}
.chat-markdown :deep(tr:last-child td) {
  border-bottom: 0;
}
.chat-markdown :deep(th) {
  background: var(--table-header-bg);
  font-weight: var(--table-header-weight);
}
.chat-markdown :deep(a) {
  color: var(--link);
  text-decoration: none;
}
.chat-markdown :deep(a:hover) {
  text-decoration: underline;
}
.chat-markdown :deep(blockquote) {
  margin: 0 0 var(--space-3);
  padding-left: var(--space-3);
  border-left: 3px solid var(--border-strong);
  color: var(--muted);
}
.chat-markdown :deep(hr) {
  margin: var(--space-5) 0;
  border: 0;
  border-top: 1px solid var(--border);
}
</style>
