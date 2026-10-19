<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { Download, ExternalLink, Eye, EyeOff } from '@lucide/vue';
import { api } from '../../services/session';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import ChatMarkdown from './ChatMarkdown.vue';

// What an assistant produced for an item, without the conversation: the newest version and
// the newest one labelled 定稿 (docs/specs/agent-workspace-start-and-composer.md 6.4).
// Shown in the item drawer to whoever holds agent.*:view; "在助手中打开" only with :run.
const props = defineProps<{
  projectId: string;
  itemId: string;
  stage: 'design' | 'development';
  canRun: boolean;
}>();
interface Output {
  sessionId: string;
  sessionTitle: string | null;
  version: number;
  labels: string[];
  createdAt: string;
  length?: number;
  planLength?: number;
  codeLines?: number;
}
const agent = computed(() => (props.stage === 'design' ? 'abap-fsd-agent' : 'abap-dev-agent'));
const base = computed(
  () => `/projects/${props.projectId}/development-items/${props.itemId}/${agent.value}`,
);
const title = computed(() => (props.stage === 'design' ? '功能说明书' : '开发方案与代码'));
const outputs = ref<{ latest: Output | null; final: Output | null } | null>(null);
const error = ref('');
const shown = ref(''),
  content = ref(''),
  loading = ref('');

// One row per distinct version: the final one first, the newest after it unless they match.
const rows = computed(() => {
  const o = outputs.value;
  if (!o) return [];
  const same = (a: Output | null, b: Output | null) =>
    !!a && !!b && a.sessionId === b.sessionId && a.version === b.version;
  const list: { key: string; label: string; output: Output }[] = [];
  if (o.final)
    list.push({
      key: 'final',
      label: same(o.final, o.latest) ? '定稿 · 最新' : '定稿',
      output: o.final,
    });
  if (o.latest && !same(o.final, o.latest))
    list.push({ key: 'latest', label: '最新', output: o.latest });
  return list;
});
const keyOf = (o: Output) => `${o.sessionId}:${o.version}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
const size = (o: Output) =>
  props.stage === 'design'
    ? `${Math.ceil((o.length ?? 0) / 1000)} 千字`
    : `代码 ${o.codeLines ?? 0} 行`;
const downloadUrl = (o: Output, target = '') =>
  `/api${base.value}/outputs/${o.sessionId}/${o.version}?download=${target || '1'}`;
const openUrl = (o: Output) =>
  `/projects/${props.projectId}/development-items/${props.itemId}/${props.stage}?session=${o.sessionId}`;

async function toggle(o: Output) {
  if (shown.value === keyOf(o)) {
    shown.value = '';
    return;
  }
  loading.value = keyOf(o);
  error.value = '';
  try {
    const r = await api<{ markdown?: string; plan?: string; code?: string }>(
      `${base.value}/outputs/${o.sessionId}/${o.version}`,
    );
    content.value =
      props.stage === 'design'
        ? (r.markdown ?? '')
        : [r.plan, r.code ? '```abap\n' + r.code + '\n```' : ''].filter(Boolean).join('\n\n');
    shown.value = keyOf(o);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = '';
  }
}
onMounted(async () => {
  try {
    outputs.value = await api(`${base.value}/outputs`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
<template>
  <section class="item-outputs" :aria-label="title">
    <h4>{{ title }}</h4>
    <p v-if="error" class="outputs-note" role="alert">{{ error }}</p>
    <p v-else-if="outputs && !rows.length" class="outputs-note">尚无成果</p>
    <ul v-else>
      <li v-for="r in rows" :key="r.key">
        <div class="output-row">
          <BaseTag :tone="r.key === 'final' ? 'green' : undefined">{{ r.label }}</BaseTag>
          <span class="output-meta"
            >第 {{ r.output.version }} 版 · {{ when(r.output.createdAt) }} ·
            {{ size(r.output) }}</span
          >
          <span class="output-actions">
            <BaseButton
              variant="ghost"
              size="sm"
              :loading="loading === keyOf(r.output)"
              @click="toggle(r.output)"
              ><template #icon
                ><EyeOff v-if="shown === keyOf(r.output)" :size="14" /><Eye v-else :size="14"
              /></template>
              {{ shown === keyOf(r.output) ? '收起' : '查看' }}</BaseButton
            >
            <template v-if="stage === 'design'">
              <a class="output-link" :href="downloadUrl(r.output)" download
                ><Download :size="14" />下载</a
              >
            </template>
            <template v-else>
              <a
                v-if="r.output.planLength"
                class="output-link"
                :href="downloadUrl(r.output, 'plan')"
                download
                ><Download :size="14" />方案</a
              >
              <a
                v-if="r.output.codeLines"
                class="output-link"
                :href="downloadUrl(r.output, 'code')"
                download
                ><Download :size="14" />代码</a
              >
            </template>
            <RouterLink v-if="canRun" class="output-link" :to="openUrl(r.output)"
              ><ExternalLink :size="14" />在助手中打开</RouterLink
            >
          </span>
        </div>
        <div v-if="shown === keyOf(r.output)" class="output-body">
          <ChatMarkdown :content="content" />
        </div>
      </li>
    </ul>
  </section>
</template>
<style scoped>
.item-outputs + .item-outputs {
  margin-top: var(--space-4);
}
h4 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
  color: var(--text-muted);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
}
li + li {
  border-top: 1px solid var(--border);
}
.output-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.output-meta {
  min-width: 0;
  font-size: var(--font-12);
  color: var(--text-muted);
}
.output-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}
.output-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: var(--control-button);
  padding: 0 var(--space-2);
  border-radius: var(--radius-6);
  font-size: var(--font-12);
  color: var(--text-muted);
  text-decoration: none;
}
.output-link:hover {
  background: var(--hover);
  color: var(--text);
}
.output-body {
  max-height: 480px;
  overflow: auto;
  padding: var(--space-3);
  border-top: 1px solid var(--border);
}
.outputs-note {
  margin: 0;
  font-size: var(--font-12);
  color: var(--text-muted);
}
</style>
