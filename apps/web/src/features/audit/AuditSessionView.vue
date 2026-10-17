<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../../components/AppIcon.vue';
import { ApiError } from '../../services/session';
import { auditApi, type Trend } from './api';
import {
  formatDuration,
  formatTokens,
  sparkPoints,
  statusLabel,
  statusTone,
  stopReasonLabel,
  withGrowth,
} from './audit.mjs';
import './audit.css';

const route = useRoute(),
  router = useRouter();
const data = ref<Trend | null>(null),
  loading = ref(false),
  error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await auditApi.trend(String(route.params.id));
  } catch (e) {
    data.value = null;
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 401) await router.replace('/login');
  } finally {
    loading.value = false;
  }
}
watch(
  () => route.params.id,
  (v) => v && load(),
  { immediate: true },
);
const rounds = computed(() => withGrowth(data.value?.rounds ?? []));
const W = 640,
  H = 120;
const series = computed(() => [
  { key: 'duration', label: '耗时', cls: 's1', values: rounds.value.map((r) => r.duration_ms) },
  { key: 'tokens', label: 'Token', cls: 's2', values: rounds.value.map((r) => r.tokens) },
  { key: 'tools', label: '工具调用', cls: 's3', values: rounds.value.map((r) => r.tool_calls) },
]);
const change = (c: number | null) =>
  c === null ? '' : (c > 0 ? '+' : '') + Math.round(c * 100) + '%';
</script>
<template>
  <div class="admin-page audit-page">
    <RouterLink class="back-link" to="/workspace/audit"
      ><AppIcon name="back" :size="16" />返回审计日志</RouterLink
    >
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="loading && !data" class="loading-state" role="status">正在读取会话轮次…</p>
    <template v-if="data">
      <div class="page-heading">
        <div>
          <h1 class="audit-title">{{ data.session.title || data.session.id }}</h1>
          <p class="muted">
            {{ data.session.project.code }} {{ data.session.project.name }} /
            {{ data.session.item.code }} {{ data.session.item.name }} · 共 {{ rounds.length }} 轮
          </p>
        </div>
      </div>
      <section class="surface audit-section">
        <h2>逐轮趋势</h2>
        <p class="muted">每条线按自身最大值归一；某轮比上一轮增长超过 30% 时在表格中高亮。</p>
        <div v-for="s in series" :key="s.key" class="audit-spark">
          <span>{{ s.label }}</span>
          <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="s.label + '趋势'">
            <polyline
              :class="s.cls"
              fill="none"
              :points="
                sparkPoints(s.values, W, H)
                  .map((p) => p.join(','))
                  .join(' ')
              "
            />
            <circle
              v-for="(p, i) in sparkPoints(s.values, W, H)"
              :key="i"
              :class="s.cls"
              :cx="p[0]"
              :cy="p[1]"
              r="3"
            />
          </svg>
        </div>
      </section>
      <section class="surface audit-section">
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>开始</th>
                <th>状态</th>
                <th>结束原因</th>
                <th class="num">耗时</th>
                <th class="num">Token</th>
                <th class="num">模型 / 工具</th>
                <th class="num">工具失败</th>
                <th class="num">评论</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rounds" :key="r.id" :class="{ 'audit-flagged': r.flagged }">
                <td>
                  <RouterLink class="text-link" :to="'/workspace/audit/runs/' + r.id">{{
                    i + 1
                  }}</RouterLink>
                </td>
                <td class="date-cell">
                  {{ new Date(r.started_at).toLocaleString('zh-CN', { hour12: false }) }}
                </td>
                <td>
                  <span class="audit-status" :class="statusTone(r.status)">{{
                    statusLabel(r.status)
                  }}</span>
                </td>
                <td>{{ stopReasonLabel(r.stop_reason) }}</td>
                <td class="num">
                  {{ formatDuration(r.duration_ms) }}
                  <small class="muted">{{ change(r.duration_change) }}</small>
                </td>
                <td class="num">
                  {{ formatTokens(r.tokens) }}
                  <small class="muted">{{ change(r.token_change) }}</small>
                </td>
                <td class="num">{{ r.model_calls }} / {{ r.tool_calls }}</td>
                <td class="num">{{ r.tool_failures || '—' }}</td>
                <td class="num">{{ r.comments || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
