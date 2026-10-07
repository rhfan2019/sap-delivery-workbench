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
import type { AgentArtifact } from '../../../../../packages/contracts/abap-fsd-agent/types';
import ChatMarkdown from './ChatMarkdown.vue';
const props = withDefaults(defineProps<{ artifact: AgentArtifact; base?: string }>(), {
  base: '/admin/abap-fsd-agent',
});
const emit = defineEmits<{ close: [] }>();
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
function download(format: 'md' | 'json') {
  const a = props.artifact;
  const url = URL.createObjectURL(
    new Blob([format === 'md' ? a.markdown : JSON.stringify(a.spec, null, 2)], {
      type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download =
    (a.spec.kind === 'development' ? '开发内容-版本' : '报表功能说明书-版本') +
    a.revision +
    '.' +
    format;
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
      <FileText :size="17" /><ArtifactTitle>{{
        artifact.spec.kind === 'development' ? '开发内容' : '功能说明书'
      }}</ArtifactTitle
      ><span>版本 {{ artifact.revision }}</span
      ><ArtifactActions
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
      <span>已保存版本 · 确认状态见业务阶段</span
      ><Button variant="ghost" size="sm" @click="download('md')"
        ><Download :size="14" />Markdown</Button
      ><Button variant="ghost" size="sm" @click="download('json')">JSON</Button>
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
      <div ref="body" class="spec-body" @scroll.passive="onScroll">
        <ChatMarkdown
          :key="artifact.id"
          :content="artifact.markdown"
          :heading-prefix="'fsd-' + artifact.id"
          @outline="receiveOutline"
        />
        <details>
          <summary>查看核验证据</summary>
          <a :href="'/api' + base + '/artifacts/' + artifact.id" target="_blank" rel="noopener"
            >打开版本、上下文及证据 JSON</a
          >
        </details>
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
