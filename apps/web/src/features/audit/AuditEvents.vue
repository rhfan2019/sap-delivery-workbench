<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import { auditApi, type AuditEvent } from './api';
import { presetRange } from './audit.mjs';

const OUTCOMES = { success: '成功', failure: '失败', denied: '拒绝' } as const;
const items = ref<AuditEvent[]>([]),
  actions = ref<string[]>([]),
  total = ref(0),
  offset = ref(0),
  pageSize = ref(50),
  loading = ref(false),
  error = ref(''),
  expanded = ref<string | null>(null);
const filters = ref({ range: '7d', action: '', outcome: '', q: '' });
let controller: AbortController | null = null;
async function load(start = 0) {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    const page = await auditApi.events(
      {
        ...(presetRange(filters.value.range) ?? {}),
        action: filters.value.action,
        outcome: filters.value.outcome,
        q: filters.value.q,
        offset: start,
      },
      controller.signal,
    );
    items.value = page.items;
    actions.value = page.actions;
    total.value = page.total;
    offset.value = page.offset;
    pageSize.value = page.page_size;
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });
onMounted(() => load());
</script>
<template>
  <div class="audit-filters" role="group" aria-label="操作审计筛选">
    <form class="filter-input" @submit.prevent="load()">
      <AppIcon name="search" :size="16" /><input
        v-model="filters.q"
        aria-label="搜索操作人或操作"
        placeholder="操作人或操作"
      />
    </form>
    <select
      v-model="filters.range"
      class="admin-filter-select"
      aria-label="时间范围"
      @change="load()"
    >
      <option value="1d">近 1 天</option>
      <option value="7d">近 7 天</option>
      <option value="30d">近 30 天</option>
      <option value="90d">近 90 天</option>
    </select>
    <select v-model="filters.action" class="admin-filter-select" aria-label="操作" @change="load()">
      <option value="">全部操作</option>
      <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
    </select>
    <select
      v-model="filters.outcome"
      class="admin-filter-select"
      aria-label="结果"
      @change="load()"
    >
      <option value="">全部结果</option>
      <option v-for="(label, key) in OUTCOMES" :key="key" :value="key">{{ label }}</option>
    </select>
  </div>
  <p v-if="error" class="error-note" role="alert">{{ error }}</p>
  <section class="surface">
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>操作</th>
            <th>结果</th>
            <th>对象</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in items" :key="e.id">
            <td class="date-cell">{{ when(e.occurred_at) }}</td>
            <td>
              {{ e.actor ?? '—' }} <span class="muted">{{ e.actor_login }}</span>
            </td>
            <td class="mono">{{ e.action }}</td>
            <td>
              <span
                class="audit-status"
                :class="e.outcome === 'success' ? 'ok' : e.outcome === 'denied' ? 'warn' : 'danger'"
                >{{ OUTCOMES[e.outcome] ?? e.outcome }}</span
              >
            </td>
            <td class="mono muted" :title="e.subject_id ?? ''">
              {{ e.subject_type ?? '—' }} {{ e.subject_id?.slice(0, 8) ?? '' }}
            </td>
            <td>
              <template v-if="Object.keys(e.details).length">
                <button class="text-button" @click="expanded = expanded === e.id ? null : e.id">
                  {{ expanded === e.id ? '收起' : '查看' }}
                </button>
                <pre v-if="expanded === e.id" class="audit-excerpt">{{
                  JSON.stringify(e.details, null, 2)
                }}</pre>
              </template>
              <span v-else class="muted">—</span>
            </td>
          </tr>
          <tr v-if="!loading && !items.length">
            <td colspan="6" class="table-empty">当前筛选条件下没有审计记录。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="loading" class="loading-state" role="status">正在读取审计记录…</p>
    <div class="admin-pagination">
      <span class="muted"
        >共 {{ total }} 条 · 第 {{ Math.floor(offset / pageSize) + 1 }} /
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
</template>
