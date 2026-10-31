<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseTag from '../../components/base/BaseTag.vue';
import { moduleHue } from '../../components/base/identity';
import { currentProject } from '../../services/projectContext';
import { assistantLink, itemLink, type Overview } from './model';

// The consultant view (spec section 2): my FSD to-dos, the FSD backlog by due date (M16),
// FSD rework after finalization (M19) and how comments are answered (M18).
const props = defineProps<{
  data: Overview;
  drill: (filter: OverviewFilter, label: string) => void;
}>();
const router = useRouter();
const open = (id: string) => void router.push(itemLink(currentProject.value, id));
const design = (id: string) => void router.push(assistantLink(currentProject.value, id, 'design'));
const mine = computed(() => [
  {
    id: 'risk',
    label: '我的 FSD 风险',
    ids: props.data.consultant.fsdRisk,
    tone: 'red',
    sub: '我负责、已延误或计划已过的 FSD',
  },
  {
    id: 'comments',
    label: '我的 FSD 待处理批注',
    ids: props.data.consultant.comments,
    tone: 'yellow',
    sub: '有未解决批注的开发项',
  },
  {
    id: 'awaiting',
    label: '待我测试',
    ids: props.data.consultant.awaiting,
    tone: '',
    sub: '开发已完成，我是顾问测试人',
  },
]);
const backlog = computed(() => {
  const b = props.data.fsdBacklog;
  const total = b.overdue.length + b.week.length + b.later.length + b.unplanned.length;
  return {
    total,
    parts: [
      { id: 'overdue', label: '已逾期', ids: b.overdue, color: 'var(--red-solid-1)' },
      { id: 'week', label: '7 天内到期', ids: b.week, color: 'var(--yellow-solid-1)' },
      { id: 'later', label: '更远', ids: b.later, color: 'var(--blue-solid-1)' },
      { id: 'unplanned', label: '未排期', ids: b.unplanned, color: 'var(--neutral-solid-1)' },
    ],
  };
});
const notes = computed(() => props.data.development.comments);
</script>
<template>
  <section class="ov-section" aria-label="我的待办">
    <div class="ov-stats">
      <button
        v-for="c in mine"
        :key="c.id"
        type="button"
        class="ov-card ov-stat"
        @click="drill({ ids: c.ids }, c.label)"
      >
        <span class="label">{{ c.label }}</span>
        <span class="value" :class="c.ids.length ? c.tone : ''">{{ c.ids.length }}</span>
        <span class="sub">{{ c.sub }}</span>
      </button>
    </div>
  </section>

  <div class="ov-cols">
    <section class="ov-section">
      <h2>FSD 积压<small>未完成的 FSD 按计划完成日分段，点分段打开开发项</small></h2>
      <div class="ov-card backlog">
        <p v-if="!backlog.total" class="ov-empty">所有 FSD 已完成或取消。</p>
        <template v-else>
          <div class="stack" role="img" :aria-label="`未完成 FSD ${backlog.total} 项`">
            <span
              v-for="p in backlog.parts.filter((x) => x.ids.length)"
              :key="p.id"
              :style="{ flexGrow: p.ids.length, background: p.color }"
            ></span>
          </div>
          <div class="legend">
            <button
              v-for="p in backlog.parts"
              :key="p.id"
              type="button"
              class="ov-cell-button"
              :disabled="!p.ids.length"
              @click="drill({ ids: p.ids }, 'FSD ' + p.label)"
            >
              <span class="swatch" :style="{ background: p.color }"></span>{{ p.label }}
              <strong>{{ p.ids.length }}</strong>
            </button>
          </div>
        </template>
      </div>
    </section>

    <section class="ov-section">
      <h2>
        批注<small
          >未解决 {{ notes.open }} 条{{
            notes.resolvedMedian !== null ? `；已解决的中位处理时长 ${notes.resolvedMedian} 天` : ''
          }}</small
        >
      </h2>
      <div class="ov-card">
        <p v-if="!notes.open" class="ov-empty">没有未解决的批注。</p>
        <template v-else>
          <p class="ov-note">
            3 天内 {{ notes.ages.within3 }} · 4–7 天 {{ notes.ages.within7 }} · 超过 7 天
            {{ notes.ages.older }}
          </p>
          <table class="ov-table">
            <tbody>
              <tr v-for="(n, index) in notes.oldest" :key="index" class="link" @click="open(n.id)">
                <td class="code">{{ n.code }}</td>
                <td class="main">{{ n.name }}</td>
                <td>
                  <BaseTag tone="neutral">{{ n.source === 'fsd' ? 'FSD' : '代码' }}</BaseTag>
                </td>
                <td class="num">{{ n.days }} 天</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </section>
  </div>

  <section class="ov-section">
    <h2>FSD 返工<small>首个定稿版本之后又出了新版本；开发或测试已开始的需要重测</small></h2>
    <div class="ov-card">
      <p v-if="!data.development.rework.length" class="ov-empty">没有定稿后又修改的 FSD。</p>
      <table v-else class="ov-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>开发名称</th>
            <th>模块</th>
            <th class="num">定稿后新版本</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data.development.rework" :key="r.id" class="link" @click="design(r.id)">
            <td class="code">{{ r.code }}</td>
            <td class="main">{{ r.name }}</td>
            <td>
              <BaseTag :tone="moduleHue(r.module)">{{ r.module }}</BaseTag>
            </td>
            <td class="num">{{ r.laterVersions }}</td>
            <td><BaseTag v-if="r.retest" tone="red">需重测</BaseTag></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<style scoped>
.backlog {
  display: grid;
  gap: var(--space-3);
}
.stack {
  display: flex;
  gap: var(--space-0-5);
  height: 12px;
  border-radius: var(--radius-full);
  overflow: hidden;
}
.stack span {
  flex-basis: 0;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.legend .ov-cell-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
}
.legend strong {
  font-weight: var(--weight-550);
}
.swatch {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-2);
}
</style>
