<script setup lang="ts">
import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactActions,
  ArtifactAction,
} from '@/components/ai-elements/artifact';
import { Button } from '@/components/ui/button';
import { X, Download, FileText } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { visibleOutline, type OutlineItem } from './outline.mjs';
import type { AgentArtifactRef } from '@sap-delivery-workbench/contracts/agent-core/types';
import ChatMarkdown from './ChatMarkdown.vue';
const props = withDefaults(
  defineProps<{ artifact: AgentArtifactRef & { markdown: string }; closable?: boolean }>(),
  {
    closable: true,
  },
);
// `select` reports text the reader selects in the document, for adding a comment.
const emit = defineEmits<{ close: []; select: [text: string] }>();
function selected() {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (text && body.value?.contains(selection!.anchorNode)) emit('select', text);
}
const body = ref<HTMLElement | null>(null),
  nav = ref<HTMLElement | null>(null);
const headings = ref<OutlineItem[]>([]),
  collapsed = ref(new Set<string>()),
  activeHeading = ref(''),
  showOutline = ref(true);
const visibleHeadings = computed(() => visibleOutline(headings.value, collapsed.value));
let scrollFrame = 0;
function toggle(id: string) {
  const next = new Set(collapsed.value);
  next.has(id) ? next.delete(id) : next.add(id);
  collapsed.value = next;
}
async function receiveOutline(items: OutlineItem[]) {
  headings.value = items;
  await nextTick();
  onScroll();
}
function onScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    if (!body.value) return;
    const top = body.value.getBoundingClientRect().top + 32;
    const nodes = [
      ...body.value.querySelectorAll<HTMLElement>(
        '.chat-markdown h1,.chat-markdown h2,.chat-markdown h3,.chat-markdown h4,.chat-markdown h5,.chat-markdown h6',
      ),
    ];
    activeHeading.value =
      nodes.filter((h) => h.getBoundingClientRect().top <= top).at(-1)?.id ?? nodes[0]?.id ?? '';
    let parent = headings.value.find((h) => h.id === activeHeading.value)?.parentId;
    const expanded = new Set(collapsed.value);
    while (parent) {
      expanded.delete(parent);
      parent = headings.value.find((h) => h.id === parent)?.parentId;
    }
    collapsed.value = expanded;
    nextTick(() => {
      const item = nav.value?.querySelector<HTMLElement>('[aria-current="location"]');
      if (!item || !nav.value) return;
      const rect = item.getBoundingClientRect(),
        pane = nav.value.getBoundingClientRect();
      if (rect.top < pane.top || rect.bottom > pane.bottom)
        nav.value.scrollTop += rect.top - pane.top - 16;
    });
  });
}
function jump(item: OutlineItem) {
  const target = body.value?.querySelector<HTMLElement>('#' + CSS.escape(item.id));
  if (!target || !body.value) return;
  target.focus({ preventScroll: true });
  body.value.scrollTo({
    top:
      body.value.scrollTop +
      target.getBoundingClientRect().top -
      body.value.getBoundingClientRect().top -
      12,
  });
  activeHeading.value = item.id;
}
watch(
  () => props.artifact.id,
  () => {
    headings.value = [];
    collapsed.value = new Set();
    activeHeading.value = '';
    if (body.value) body.value.scrollTop = 0;
  },
);
onBeforeUnmount(() => cancelAnimationFrame(scrollFrame));
function download() {
  const url = URL.createObjectURL(
    new Blob([props.artifact.markdown], { type: 'text/markdown;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `功能说明书-第${props.artifact.revision}版.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <Artifact
    class="spec-panel assistant-elements h-full rounded-none border-0"
    aria-label="已保存功能说明书"
  >
    <ArtifactHeader>
      <FileText :size="17" /><ArtifactTitle>功能说明书</ArtifactTitle
      ><span>第 {{ artifact.revision }} 版</span
      ><span v-for="label in artifact.labels ?? []" :key="label" class="spec-label">{{
        label
      }}</span
      ><ArtifactActions v-if="closable"
        ><ArtifactAction label="关闭说明书" @click="emit('close')"><X :size="18" /></ArtifactAction
      ></ArtifactActions>
    </ArtifactHeader>
    <div class="spec-toolbar">
      <Button
        variant="ghost"
        size="sm"
        :aria-expanded="showOutline"
        @click="showOutline = !showOutline"
        >目录</Button
      >
      <slot name="actions" /><Button variant="ghost" size="sm" @click="download"
        ><Download :size="14" />Markdown</Button
      >
    </div>
    <div class="spec-reading">
      <nav v-show="showOutline" ref="nav" class="spec-outline" aria-label="说明书章节目录">
        <div
          v-for="item in visibleHeadings"
          :key="item.id"
          class="outline-row"
          :style="{ paddingLeft: Math.min(item.depth, 4) * 12 + 'px' }"
        >
          <Button
            variant="ghost"
            size="sm"
            v-if="headings.some((h) => h.parentId === item.id)"
            class="outline-toggle"
            :aria-label="(collapsed.has(item.id) ? '展开 ' : '折叠 ') + item.label"
            :aria-expanded="!collapsed.has(item.id)"
            @click="toggle(item.id)"
          >
            {{ collapsed.has(item.id) ? '▸' : '▾' }}
          </Button>
          <span v-else class="outline-spacer"></span>
          <Button
            variant="ghost"
            size="sm"
            :aria-current="activeHeading === item.id ? 'location' : undefined"
            @click="jump(item)"
          >
            {{ item.label }}
          </Button>
        </div>
      </nav>
      <div ref="body" class="spec-body" @scroll.passive="onScroll" @mouseup="selected">
        <slot />
        <ChatMarkdown
          :key="artifact.id"
          :content="artifact.markdown"
          :heading-prefix="'fsd-' + artifact.id"
          @outline="receiveOutline"
        />
      </div>
    </div>
  </Artifact>
</template>
<style scoped>
.spec-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
  border-left: 1px solid #e8edf2;
  min-height: 0;
}
.spec-panel header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px;
  font-size: 13px;
  border-bottom: 1px solid #edf0f3;
  color: #334155;
}
.spec-label {
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  padding: 1px 8px;
}
.spec-panel header span {
  font-size: 11px;
  color: #94a3b8;
}
.spec-panel header button {
  margin-left: auto;
}
.spec-panel button {
  display: flex;
  gap: 5px;
  align-items: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: #64748b;
  padding: 7px;
  border-radius: 6px;
  min-height: 32px;
}
.spec-panel button:hover {
  background: #f1f3f5;
}
.spec-toolbar {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  gap: 8px;
  font-size: 11px;
}
.spec-toolbar span {
  margin-right: auto;
  color: #a0763d;
}
.spec-toolbar button {
  font-size: 11px;
}
.spec-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 24px 36px;
}
.spec-reading {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.spec-outline {
  flex: 0 0 170px;
  min-width: 0;
  overflow: auto;
  padding: 10px 6px;
  border-right: 1px solid #e8edf2;
}
.outline-row {
  display: flex;
  align-items: start;
}
.outline-row button {
  font-size: 12px;
  text-align: left;
  line-height: 1.6;
  overflow-wrap: anywhere;
  color: #475569;
  min-width: 0;
}
.outline-row .outline-toggle,
.outline-spacer {
  flex: 0 0 20px;
  width: 20px;
  padding: 6px 2px;
}
.outline-row button[aria-current] {
  color: #1d4ed8;
  background: #eff6ff;
  font-weight: 600;
}
.spec-body {
  min-width: 0;
}
.spec-panel {
  container-type: inline-size;
}
@container (max-width: 560px) {
  .spec-reading {
    flex-direction: column;
  }
  .spec-outline {
    flex: 0 0 auto;
    max-height: 140px;
    border-right: 0;
    border-bottom: 1px solid #e8edf2;
  }
}
.spec-toolbar {
  flex-wrap: wrap;
}
.spec-body details {
  font-size: 12px;
  color: #64748b;
  margin-top: 20px;
}
.spec-body a {
  color: #2563eb;
}
button:focus-visible {
  outline: 2px solid #2563eb;
}
</style>
