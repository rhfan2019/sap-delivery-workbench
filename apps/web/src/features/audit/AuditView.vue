<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../../components/AppIcon.vue';
import { ApiError } from '../../services/session';
import { auditApi, type Facets, type RunRow } from './api';
import {
  formatDuration,
  formatTokens,
  pickFilters,
  presetRange,
  statusLabel,
  statusTone,
  stopReasonLabel,
  STATUS_LABELS,
} from './audit.mjs';
import AuditStats from './AuditStats.vue';
import AuditEvents from './AuditEvents.vue';
import AuditProposals from './AuditProposals.vue';
import './audit.css';

const route = useRoute(),
  router = useRouter();
const RANGES = [
  { id: '1d', label: '近 1 天' },
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: '90d', label: '近 90 天' },
  { id: 'custom', label: '自定义' },
];
const TABS = [
  { id: 'runs', label: '助手运行' },
  { id: 'stats', label: '统计分析' },
  { id: 'events', label: '操作审计' },
  { id: 'proposals', label: '优化建议' },
];
const tab = computed(() =>
  TABS.some((t) => t.id === route.query.tab) ? String(route.query.tab) : 'runs',
);
const range = computed(() =>
  RANGES.some((r) => r.id === route.query.range) ? String(route.query.range) : '7d',
);
const selected = computed(() => pickFilters(route.query as Record<string, unknown>));
// Relative ranges are re-evaluated on every load so "近 7 天" stays relative.
function effective() {
  const f = { ...selected.value };
  if (range.value !== 'custom') Object.assign(f, presetRange(range.value));
  return f;
}
// Snapshot of the filters used by the last reload; shared by list, stats and export.
const current = ref<Record<string, string>>({});
const facets = ref<Facets | null>(null),
  items = ref<RunRow[]>([]),
  total = ref(0),
  offset = ref(0),
  pageSize = ref(50),
  loading = ref(false),
  error = ref(''),
  search = ref('');
const projectItems = computed(
  () => facets.value?.projects.find((p) => p.id === selected.value.project_id)?.items ?? [],
);
const localValue = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

async function fail(e: unknown) {
  if (e instanceof DOMException && e.name === 'AbortError') return;
  error.value = (e as Error).message;
  if (e instanceof ApiError && e.status === 401) await router.replace('/login');
}
function update(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...patch }))
    if (typeof v === 'string' && v) query[k] = v;
  if (patch.project_id !== undefined) delete query.item_id;
  router.replace({ query });
}
function setDate(key: 'from' | 'to', value: string) {
  update({ [key]: value ? new Date(value).toISOString() : undefined });
}
let controller: AbortController | null = null;
async function load(start = 0) {
  if (tab.value !== 'runs') return;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const page = await auditApi.runs({ ...current.value, offset: start }, controller.signal);
    items.value = page.items;
    total.value = page.total;
    offset.value = page.offset;
    pageSize.value = page.page_size;
  } catch (e) {
    await fail(e);
  } finally {
    loading.value = false;
  }
}
async function loadFacets() {
  try {
    facets.value = await auditApi.facets();
  } catch (e) {
    await fail(e);
  }
}
function reload() {
  current.value = effective();
  search.value = selected.value.q ?? '';
  if (['runs', 'stats'].includes(tab.value)) void loadFacets();
  void load();
}
const exportUrl = (format: 'md' | 'json') => auditApi.exportUrl(current.value, format, true);
const open = (row: RunRow) => router.push('/workspace/audit/runs/' + row.id);
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

watch(
  () => route.fullPath,
  () => {
    if (route.path === '/workspace/audit') reload();
  },
);
onMounted(reload);
</script>
<template>
  <div class="admin-page audit-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">AUDIT</p>
        <h1>审计日志</h1>
        <p class="muted">
          复核 FSD 设计助手的每一轮运行，记录评论；查看平台操作审计和优化建议。仅企业管理员可见。
        </p>
      </div>
      <div class="toolbar-actions">
        <button class="secondary-button" :disabled="loading" @click="reload">
          <AppIcon name="refresh" :size="16" />刷新
        </button>
        <template v-if="tab === 'runs' || tab === 'stats'">
          <a class="secondary-button" :href="exportUrl('md')" download>导出分析材料</a>
          <a class="secondary-button" :href="exportUrl('json')" download>导出 JSON</a>
        </template>
      </div>
    </div>

    <nav class="admin-tabs" aria-label="审计视图">
      <button
        v-for="t in TABS"
        :key="t.id"
        :class="{ active: tab === t.id }"
        :aria-current="tab === t.id ? 'page' : undefined"
        @click="router.replace({ query: t.id === 'runs' ? {} : { tab: t.id } })"
      >
        {{ t.label }}
      </button>
    </nav>

    <template v-if="tab === 'runs' || tab === 'stats'">
      <div class="audit-filters" role="group" aria-label="筛选条件">
        <form class="filter-input" @submit.prevent="update({ q: search || undefined })">
          <AppIcon name="search" :size="16" /><input
            v-model="search"
            aria-label="搜索"
            placeholder="开发项、项目、用户或运行编号"
          />
        </form>
        <select
          class="admin-filter-select"
          aria-label="时间范围"
          :value="range"
          @change="update({ range: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="r in RANGES" :key="r.id" :value="r.id">{{ r.label }}</option>
        </select>
        <template v-if="range === 'custom'">
          <input
            type="datetime-local"
            class="admin-filter-select"
            aria-label="开始时间"
            :value="localValue(selected.from)"
            @change="setDate('from', ($event.target as HTMLInputElement).value)"
          />
          <input
            type="datetime-local"
            class="admin-filter-select"
            aria-label="结束时间"
            :value="localValue(selected.to)"
            @change="setDate('to', ($event.target as HTMLInputElement).value)"
          />
        </template>
        <select
          v-if="tab === 'runs'"
          class="admin-filter-select"
          aria-label="状态"
          :value="selected.status ?? ''"
          @change="update({ status: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">全部状态</option>
          <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">
            {{ label }}
          </option>
        </select>
        <select
          class="admin-filter-select"
          aria-label="模型"
          :value="selected.model ?? ''"
          @change="update({ model: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">全部模型</option>
          <option v-for="m in facets?.models ?? []" :key="m" :value="m">{{ m }}</option>
        </select>
        <select
          class="admin-filter-select"
          aria-label="项目"
          :value="selected.project_id ?? ''"
          @change="update({ project_id: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">全部项目</option>
          <option v-for="p in facets?.projects ?? []" :key="p.id" :value="p.id">
            {{ p.code }} {{ p.name }}
          </option>
        </select>
        <select
          class="admin-filter-select"
          aria-label="开发项"
          :disabled="!selected.project_id"
          :value="selected.item_id ?? ''"
          @change="update({ item_id: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">全部开发项</option>
          <option v-for="i in projectItems" :key="i.id" :value="i.id">
            {{ i.code }} {{ i.name }}
          </option>
        </select>
        <button
          class="text-button"
          type="button"
          @click="router.replace({ query: tab === 'stats' ? { tab: 'stats' } : {} })"
        >
          清除筛选
        </button>
      </div>
    </template>

    <p v-if="error" class="error-note" role="alert">{{ error }}</p>

    <AuditStats v-if="tab === 'stats'" :filters="current" />
    <AuditEvents v-else-if="tab === 'events'" />
    <AuditProposals v-else-if="tab === 'proposals'" />
    <section v-else class="surface">
      <div class="admin-table-wrap">
        <table class="admin-table audit-table">
          <thead>
            <tr>
              <th>开始时间</th>
              <th>开发项</th>
              <th>用户</th>
              <th>模型</th>
              <th>状态</th>
              <th>结束原因</th>
              <th class="num">耗时</th>
              <th class="num">模型 / 工具</th>
              <th class="num">工具失败</th>
              <th class="num">Token</th>
              <th class="num">评论</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id" class="clickable" @click="open(row)">
              <td class="date-cell">
                <RouterLink
                  class="text-link"
                  :to="'/workspace/audit/runs/' + row.id"
                  :title="row.id"
                  @click.stop
                  >{{ when(row.started_at) }}</RouterLink
                >
              </td>
              <td :title="row.project.name + ' / ' + row.item.name">
                {{ row.item.code }} <span class="muted">{{ row.item.name }}</span>
              </td>
              <td>{{ row.user_name }}</td>
              <td class="truncate" :title="row.model ?? ''">{{ row.model ?? '—' }}</td>
              <td>
                <span class="audit-status" :class="statusTone(row.status)">{{
                  statusLabel(row.status)
                }}</span>
              </td>
              <td>
                {{ stopReasonLabel(row.stop_reason) }}
                <span v-if="row.document_version" class="admin-badge"
                  >文档 v{{ row.document_version }}</span
                >
              </td>
              <td class="num">{{ formatDuration(row.duration_ms) }}</td>
              <td class="num">{{ row.model_calls }} / {{ row.tool_calls }}</td>
              <td class="num" :class="{ 'audit-danger': row.tool_failures }">
                {{ row.tool_failures || '—' }}
              </td>
              <td class="num">{{ formatTokens(row.prompt_tokens + row.completion_tokens) }}</td>
              <td class="num">{{ row.comments || '—' }}</td>
            </tr>
            <tr v-if="!loading && !items.length">
              <td colspan="11" class="table-empty">当前筛选条件下没有运行记录。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="loading" class="loading-state" role="status">正在读取运行记录…</p>
      <div class="admin-pagination">
        <span class="muted"
          >共 {{ total }} 轮 · 第 {{ Math.floor(offset / pageSize) + 1 }} /
          {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span
        >
        <button
          class="secondary-button"
          :disabled="!offset || loading"
          @click="load(Math.max(0, offset - pageSize))"
        >
          上一页
        </button>
        <button
          class="secondary-button"
          :disabled="offset + pageSize >= total || loading"
          @click="load(offset + pageSize)"
        >
          下一页
        </button>
      </div>
    </section>
  </div>
</template>
