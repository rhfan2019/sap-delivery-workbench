<script setup lang="ts">
import { onMounted, ref } from 'vue';
import BaseBanner from '../../components/base/BaseBanner.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { api } from '../../services/session';
import { HEALTH, shortDate, type Health, type PortfolioRow } from './model';

// The portfolio view (spec section 2, delivery director and PMO): one row per project, the
// health the project reports beside the colour computed from its numbers (M23, highlighted when
// the report is rosier), and how fresh the data is (M24). A row opens that project's overview.
const emit = defineEmits<{ open: [projectId: string] }>();
const rows = ref<PortfolioRow[] | null>(null);
const error = ref('');
onMounted(async () => {
  try {
    rows.value = (await api<{ projects: PortfolioRow[] }>('/development-portfolio')).projects;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const RANK: Record<Health, number> = { green: 0, yellow: 1, red: 2 };
const rosier = (r: PortfolioRow) => !!r.reported && RANK[r.reported.overall] < RANK[r.signal.color];
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—');
</script>
<template>
  <section class="ov-section">
    <h2>
      项目组合<small
        >按计算信号排序；自报健康度比数据乐观时标出“不一致”。信号的依据见每行说明</small
      >
    </h2>
    <BaseBanner v-if="error" tone="red">{{ error }}</BaseBanner>
    <BaseSkeleton v-else-if="!rows" height="240px" />
    <div v-else class="ov-card scroll">
      <p v-if="!rows.length" class="ov-empty">没有可查看的进行中项目。</p>
      <table v-else class="ov-table">
        <thead>
          <tr>
            <th>项目</th>
            <th>计算信号</th>
            <th>自报健康度</th>
            <th class="num">风险</th>
            <th class="num">开发完成</th>
            <th>开发冻结</th>
            <th class="num">预算</th>
            <th>最近更新</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="link" @click="emit('open', r.id)">
            <td>
              <span class="main">{{ r.name }}</span>
              <span class="code sub">{{ r.code }}</span>
            </td>
            <td>
              <BaseTag :tone="r.signal.color">{{ HEALTH[r.signal.color] }}</BaseTag>
              <span v-if="r.signal.reasons.length" class="reasons">{{
                r.signal.reasons.map((x) => x.text).join('；')
              }}</span>
            </td>
            <td>
              <span v-if="r.reported" class="ov-tags">
                <BaseTag :tone="r.reported.overall">{{ HEALTH[r.reported.overall] }}</BaseTag>
                <span class="sub">{{ shortDate(r.reported.reportedOn) }}</span>
                <BaseTag v-if="rosier(r)" tone="red" variant="outline">不一致</BaseTag>
              </span>
              <span v-else class="ov-muted">未登记</span>
            </td>
            <td class="num">
              {{ r.risk }} / {{ r.items }}<span class="sub">（{{ pctOf(r.risk, r.items) }}）</span>
            </td>
            <td class="num">{{ pctOf(r.developmentDone, r.items) }}</td>
            <td>
              <template v-if="r.freeze.achieved">已冻结</template>
              <template v-else-if="r.freeze.date"
                >{{ shortDate(r.freeze.date) }}
                <span class="sub">{{
                  r.freeze.days! >= 0 ? `还有 ${r.freeze.days} 天` : `已过 ${-r.freeze.days!} 天`
                }}</span>
                <BaseTag v-if="r.freezeLate" tone="red">晚于冻结 {{ r.freezeLate }}</BaseTag>
              </template>
              <span v-else class="ov-muted">未设</span>
            </td>
            <td class="num">
              <template v-if="r.budget?.budgetDays">{{
                pctOf(r.budget.plannedDays, r.budget.budgetDays)
              }}</template>
              <span v-else class="ov-muted">—</span>
            </td>
            <td>
              <template v-if="r.lastOn">{{
                r.staleDays === 0 ? '今天' : r.staleDays + ' 天前'
              }}</template>
              <span v-else class="ov-muted">无记录</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<style scoped>
.sub {
  margin-left: var(--space-1-5);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.reasons {
  display: block;
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
.ov-table td {
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
}
</style>
