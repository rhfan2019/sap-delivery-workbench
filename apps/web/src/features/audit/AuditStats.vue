<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { auditApi, type Stats } from './api';
import { formatDuration, formatPercent, formatTokens, toolLabel } from './audit.mjs';

const props = defineProps<{ filters: Record<string, string> }>();
const data = ref<Stats | null>(null),
  loading = ref(false),
  error = ref('');
let sequence = 0;
async function load() {
  const mine = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const result = await auditApi.stats(props.filters);
    if (mine === sequence) data.value = result;
  } catch (e) {
    if (mine === sequence) error.value = (e as Error).message;
  } finally {
    if (mine === sequence) loading.value = false;
  }
}
watch(() => props.filters, load, { immediate: true });
const maxReason = computed(() =>
  Math.max(1, ...(data.value?.stop_reasons.map((c) => c.count) ?? [])),
);
const maxDay = computed(() => Math.max(1, ...(data.value?.daily.map((d) => d.total) ?? [])));
</script>
<template>
  <p v-if="error" class="error-note" role="alert">{{ error }}</p>
  <p v-if="loading && !data" class="loading-state" role="status">正在统计…</p>
  <div v-if="data" class="audit-stats" :aria-busy="loading">
    <div class="audit-kpis">
      <div class="surface audit-kpi">
        <span class="muted">运行轮次</span><strong>{{ data.totals.runs }}</strong>
        <small class="muted">完成 {{ data.totals.completed }} · 提问 {{ data.totals.asked }}</small>
      </div>
      <div class="surface audit-kpi">
        <span class="muted">失败率</span><strong>{{ formatPercent(data.failure_rate) }}</strong>
        <small class="muted"
          >失败 {{ data.totals.failed }} · 中断 {{ data.totals.interrupted }} · 停止
          {{ data.totals.cancelled }}</small
        >
      </div>
      <div class="surface audit-kpi">
        <span class="muted">平均耗时</span
        ><strong>{{ formatDuration(data.totals.avg_duration_ms) }}</strong>
        <small class="muted">提问率 {{ formatPercent(data.ask_rate) }}</small>
      </div>
      <div class="surface audit-kpi">
        <span class="muted">工具失败率</span
        ><strong>{{ formatPercent(data.tool_failure_rate) }}</strong>
        <small class="muted"
          >失败 {{ data.totals.tool_failures }} / {{ data.totals.tool_calls }}</small
        >
      </div>
      <div class="surface audit-kpi">
        <span class="muted">Token</span
        ><strong>{{
          formatTokens(data.totals.prompt_tokens + data.totals.completion_tokens)
        }}</strong>
        <small class="muted"
          >输入 {{ formatTokens(data.totals.prompt_tokens) }} · 输出
          {{ formatTokens(data.totals.completion_tokens) }}</small
        >
      </div>
    </div>

    <section class="surface audit-section">
      <h2>结束原因分布</h2>
      <p v-if="!data.stop_reasons.length" class="muted">该时间段内没有运行。</p>
      <ul class="audit-bars">
        <li v-for="c in data.stop_reasons" :key="c.reason">
          <span class="mono">{{ c.reason }}</span>
          <span class="muted">{{ c.title }}</span>
          <span class="audit-bar"><i :style="{ width: (c.count / maxReason) * 100 + '%' }" /></span>
          <strong>{{ c.count }}</strong>
        </li>
      </ul>
    </section>

    <section class="surface audit-section">
      <h2>工具调用</h2>
      <p class="muted">失败多的工具排在前面；失败通常意味着提示词或工具说明需要补充。</p>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>工具</th>
              <th class="num">调用</th>
              <th class="num">失败</th>
              <th class="num">平均耗时</th>
              <th class="num">最长</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in data.tools" :key="t.name">
              <td>
                {{ toolLabel(t.name) }} <span class="muted mono">{{ t.name }}</span>
              </td>
              <td class="num">{{ t.calls }}</td>
              <td class="num" :class="{ 'audit-danger': t.failures }">{{ t.failures }}</td>
              <td class="num">{{ formatDuration(t.avg_ms) }}</td>
              <td class="num">{{ formatDuration(t.max_ms) }}</td>
            </tr>
            <tr v-if="!data.tools.length">
              <td colspan="5" class="table-empty">没有工具调用。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="surface audit-section">
      <h2>按模型</h2>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>模型</th>
              <th class="num">轮次</th>
              <th class="num">失败 / 中断</th>
              <th class="num">平均耗时</th>
              <th class="num">最长</th>
              <th class="num">Token</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in data.models" :key="m.model ?? 'none'">
              <td>{{ m.model ?? '—' }}</td>
              <td class="num">{{ m.runs }}</td>
              <td class="num" :class="{ 'audit-danger': m.failures }">{{ m.failures }}</td>
              <td class="num">{{ formatDuration(m.avg_duration_ms) }}</td>
              <td class="num">{{ formatDuration(m.max_duration_ms) }}</td>
              <td class="num">{{ formatTokens(m.tokens) }}</td>
            </tr>
            <tr v-if="!data.models.length">
              <td colspan="6" class="table-empty">没有运行。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="surface audit-section">
      <h2>按天趋势</h2>
      <ul class="audit-bars">
        <li v-for="d in data.daily" :key="d.day">
          <span class="mono">{{ d.day }}</span>
          <span class="muted">失败 {{ d.failed }} / {{ d.total }}</span>
          <span class="audit-bar"
            ><i :style="{ width: (d.total / maxDay) * 100 + '%' }" /><b
              :style="{ width: (d.failed / maxDay) * 100 + '%' }"
          /></span>
          <strong>{{ d.total }}</strong>
        </li>
      </ul>
    </section>
  </div>
</template>
