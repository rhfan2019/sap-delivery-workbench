<script setup lang="ts">
// What one turn did: a live status line while it runs, then one summary line that opens into
// grouped activity and, per call, a readable preview (docs/specs/agent-conversation-ux.md 4).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check, ChevronRight, LoaderCircle, TriangleAlert } from '@lucide/vue';
import { Shimmer } from '@/components/ai-elements/shimmer';
import {
  activitiesFromSteps,
  activitySummary,
  objectsText,
  sectionsOf,
  stepObjects,
  toolLabel,
} from './session-model.mjs';
import { formatElapsed, waitHint } from './presentation.mjs';
import type { AgentStep } from '@sap-delivery-workbench/contracts/agent-core/types';

const props = defineProps<{
  steps: AgentStep[];
  live?: boolean;
  note?: { text: string; at: number };
  status?: string;
  runId?: string;
  startedAt?: string;
  finishedAt?: string | null;
  clockOffsetMs?: number;
}>();

const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
const tick = () => (now.value = Date.now());
onMounted(() => {
  if (props.live) ticker = setInterval(tick, 1000);
});
watch(
  () => props.live,
  (live) => {
    clearInterval(ticker);
    if (live) ticker = setInterval(tick, 1000);
  },
);
onBeforeUnmount(() => clearInterval(ticker));

const activities = computed(() => activitiesFromSteps(props.steps));
const elapsed = computed(() => {
  if (!props.startedAt) return '';
  const end = props.live
    ? now.value + (props.clockOffsetMs ?? 0)
    : props.finishedAt
      ? Date.parse(props.finishedAt)
      : NaN;
  const ms = end - Date.parse(props.startedAt);
  return Number.isFinite(ms) ? '用时 ' + formatElapsed(ms) : '';
});
const hint = computed(() => (props.live && props.note ? waitHint(now.value - props.note.at) : ''));
const outcome = computed(
  () =>
    ({ failed: '未完成', cancelled: '已停止', waiting_user: '等待你的确认' })[props.status ?? ''] ??
    '已完成',
);
const summary = computed(() =>
  [outcome.value, elapsed.value, activitySummary(props.steps)].filter(Boolean).join(' · '),
);

const expanded = ref(false);
// Rows the user opened; while running, the row in progress is open by itself.
const opened = ref<Record<string, boolean>>({});
const isOpen = (id: string, running: boolean) => opened.value[id] ?? (props.live && running);
const toggle = (id: string, running: boolean) => (opened.value[id] = !isOpen(id, running));

function sqlOf(step: AgentStep) {
  const input = step.input as Record<string, unknown> | string;
  return typeof input === 'object' && typeof input?.sqlQuery === 'string' ? input.sqlQuery : '';
}
function changesOf(step: AgentStep) {
  const input = step.input as { changes?: { section?: string; summary?: string }[] };
  return Array.isArray(input?.changes) ? input.changes.filter((c) => c?.section) : [];
}
function reasonOf(step: AgentStep) {
  const input = step.input as { reason?: string };
  return typeof input?.reason === 'string' ? input.reason : '';
}
function callLine(step: AgentStep) {
  const objects = stepObjects(step);
  const groups = [...new Set(objects.map((o) => o.group))].map((group) => ({
    group,
    names: objects.filter((o) => o.group === group).map((o) => o.name),
  }));
  return [
    toolLabel(step.name ?? ''),
    groups.length ? objectsText(groups) : sectionsOf(step.input).join('、'),
  ]
    .filter(Boolean)
    .join(' · ');
}
const seconds = (ms?: number) => (ms && ms >= 1000 ? (ms / 1000).toFixed(1) + ' 秒' : '');
const copied = ref('');
async function copyRunId() {
  try {
    await navigator.clipboard.writeText(props.runId ?? '');
    copied.value = '已复制';
  } catch {
    copied.value = '复制失败';
  }
}
</script>
<template>
  <section class="run-activity" :aria-label="live ? '执行进度' : '执行记录'">
    <template v-if="live">
      <div class="flex items-center gap-2 text-sm" role="status">
        <LoaderCircle class="size-4 shrink-0 animate-spin text-muted-foreground" />
        <Shimmer as="span" class="min-w-0">{{ note?.text || '正在处理…' }}</Shimmer>
        <span v-if="elapsed" class="shrink-0 text-xs text-muted-foreground">· {{ elapsed }}</span>
      </div>
      <p v-if="hint" class="mt-1 pl-6 text-xs text-muted-foreground">{{ hint }}</p>
    </template>
    <button
      v-else
      type="button"
      class="run-summary"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <ChevronRight
        class="size-4 shrink-0 transition-transform"
        :class="{ 'rotate-90': expanded }"
      />
      <span>{{ summary }}</span>
    </button>
    <div v-if="live || expanded" class="run-rows">
      <ol v-if="activities.length">
        <li v-for="a in activities" :key="a.id">
          <button
            type="button"
            class="run-row"
            :aria-expanded="isOpen(a.id, a.status === 'running')"
            @click="toggle(a.id, a.status === 'running')"
          >
            <LoaderCircle
              v-if="a.status === 'running'"
              class="size-4 shrink-0 animate-spin text-muted-foreground"
            />
            <Check v-else class="size-4 shrink-0 text-emerald-700" />
            <span class="shrink-0 font-medium">{{ a.title }}</span>
            <span class="min-w-0 flex-1 text-muted-foreground">{{ a.detail }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">
              <template v-if="a.count > 1">{{ a.count }} 次</template>
              <span v-if="a.failures" class="text-amber-700">
                · {{ a.failures }} 次未成功</span
              ></span
            >
          </button>
          <ul v-if="isOpen(a.id, a.status === 'running')" class="run-calls">
            <li
              v-for="s in a.steps"
              :key="s.stepId"
              :class="{ 'opacity-70': s.status === 'failed' }"
            >
              <p class="flex gap-2">
                <span class="min-w-0 flex-1">{{ callLine(s) }}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{{
                  s.status === 'running' ? '执行中' : seconds(s.durationMs)
                }}</span>
              </p>
              <pre v-if="sqlOf(s)" class="run-code">{{ sqlOf(s) }}</pre>
              <ul v-if="changesOf(s).length" class="run-changes">
                <li v-for="c in changesOf(s)" :key="c.section">
                  <strong>{{ c.section }}</strong
                  ><span v-if="c.summary">：{{ c.summary }}</span>
                </li>
              </ul>
              <p v-if="reasonOf(s)" class="text-muted-foreground">原因：{{ reasonOf(s) }}</p>
              <template v-if="s.preview">
                <div v-if="s.preview.kind === 'table'" class="run-table">
                  <table>
                    <thead>
                      <tr>
                        <th v-for="c in s.preview.columns" :key="c">{{ c }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, i) in s.preview.rows" :key="i">
                        <td v-for="(v, j) in row" :key="j">{{ v }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p class="text-xs text-muted-foreground">
                    {{
                      s.preview.total > s.preview.rows.length
                        ? `共 ${s.preview.total} 行，显示前 ${s.preview.rows.length} 行`
                        : `共 ${s.preview.total} 行`
                    }}
                  </p>
                </div>
                <ul v-else-if="s.preview.kind === 'objects'" class="run-changes">
                  <li v-for="o in s.preview.items" :key="o.name + o.type">
                    <strong>{{ o.name }}</strong>
                    <span class="text-muted-foreground"> {{ o.type }} {{ o.description }}</span>
                  </li>
                  <li v-if="!s.preview.items.length" class="text-muted-foreground">没有找到</li>
                </ul>
                <p v-else-if="s.preview.kind === 'error'" class="flex gap-1 text-amber-800">
                  <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{{ s.preview.text }}
                </p>
                <pre v-else-if="s.preview.text" class="run-text">{{ s.preview.text }}</pre>
              </template>
              <details
                v-if="s.summary && s.status !== 'running' && s.preview?.kind !== 'text'"
                class="run-raw"
              >
                <summary>原始结果</summary>
                <pre>{{ s.summary }}</pre>
              </details>
            </li>
          </ul>
        </li>
      </ol>
      <p v-if="!live && runId" class="run-meta">
        运行编号 {{ runId }}
        <button type="button" @click="copyRunId">{{ copied || '复制' }}</button>
      </p>
    </div>
  </section>
</template>
<style scoped>
.run-activity {
  width: 100%;
  font-size: 0.875rem;
}
.run-activity ol,
.run-activity ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.run-summary {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  max-width: 100%;
  border-radius: 0.375rem;
  padding: 0.125rem 0.25rem 0.125rem 0;
  color: var(--color-muted-foreground);
  font-size: 0.8125rem;
  text-align: left;
}
.run-summary:hover {
  color: var(--color-foreground);
}
.run-rows {
  margin-top: 0.5rem;
  border-left: 2px solid var(--color-border);
  padding-left: 0.75rem;
}
.run-rows > ol {
  display: grid;
  gap: 0.25rem;
}
.run-row {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 0.5rem;
  border-radius: 0.375rem;
  padding: 0.125rem 0;
  text-align: left;
}
.run-row > svg {
  align-self: center;
}
.run-row:hover .font-medium {
  text-decoration: underline;
}
.run-calls {
  display: grid;
  gap: 0.5rem;
  margin: 0.25rem 0 0.5rem 1.5rem;
  font-size: 0.8125rem;
}
.run-code,
.run-text,
.run-raw pre {
  margin-top: 0.25rem;
  max-height: 8rem;
  overflow: auto;
  border-radius: 0.375rem;
  background: var(--color-muted);
  padding: 0.375rem 0.5rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
}
.run-changes {
  margin-top: 0.25rem;
  display: grid;
  gap: 0.125rem;
}
.run-table {
  margin-top: 0.25rem;
  max-width: 100%;
  overflow-x: auto;
}
.run-table table {
  border-collapse: collapse;
  font-size: 0.75rem;
}
.run-table th,
.run-table td {
  border: 1px solid var(--color-border);
  padding: 0.125rem 0.5rem;
  text-align: left;
  white-space: nowrap;
}
.run-table th {
  background: var(--color-muted);
  font-weight: 500;
}
.run-raw summary {
  cursor: pointer;
  color: var(--color-muted-foreground);
  font-size: 0.75rem;
}
.run-meta {
  margin-top: 0.5rem;
  color: var(--color-muted-foreground);
  font-size: 0.75rem;
  word-break: break-all;
}
.run-meta button {
  margin-left: 0.5rem;
  text-decoration: underline;
}
</style>
