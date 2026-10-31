<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseTag from '../../components/base/BaseTag.vue';
import { moduleHue } from '../../components/base/identity';
import { currentProject } from '../../services/projectContext';
import AwaitingTest from './AwaitingTest.vue';
import { itemLink, pct, type Overview } from './model';

// The tester view (spec section 2, test lead): readiness for SIT by module (M21), testing
// planned past its milestone (M20), testers still to assign, developed items waiting for a test.
const props = defineProps<{
  data: Overview;
  drill: (filter: OverviewFilter, label: string) => void;
}>();
const router = useRouter();
const open = (id: string) => void router.push(itemLink(currentProject.value, id));
const r = computed(() => props.data.readiness);
const cards = computed(() => [
  {
    id: 'ready',
    label: 'SIT 就绪',
    value: `${r.value.all.ready} / ${r.value.all.total}`,
    tone: '',
    sub: `开发与顾问测试均已完成（${pct(r.value.all.ready, r.value.all.total)}%）`,
    open: () => props.drill({ ids: r.value.all.notReady }, '未就绪'),
  },
  {
    id: 'sit',
    label: '顾问测试晚于 SIT 开始',
    value: String(props.data.development.gates.consultant_test ?? 0),
    tone: props.data.development.gates.consultant_test ? 'red' : '',
    sub: '计划完成在 SIT 开始之后',
    open: () => props.drill({ phase: 'consultant_test', gate: true }, '顾问测试晚于 SIT'),
  },
  {
    id: 'uat',
    label: '用户测试晚于 UAT 完成',
    value: String(props.data.development.gates.user_test ?? 0),
    tone: props.data.development.gates.user_test ? 'red' : '',
    sub: '计划完成在 UAT 完成之后',
    open: () => props.drill({ phase: 'user_test', gate: true }, '用户测试晚于 UAT'),
  },
  {
    id: 'tester',
    label: '测试负责人缺口',
    value: String(r.value.noTester.length),
    tone: r.value.noTester.length ? 'yellow' : '',
    sub: '顾问测试或用户测试未指定负责人',
    open: () => props.drill({ ids: r.value.noTester }, '测试负责人缺口'),
  },
]);
</script>
<template>
  <section class="ov-section" aria-label="测试">
    <div class="ov-stats">
      <button v-for="c in cards" :key="c.id" type="button" class="ov-card ov-stat" @click="c.open">
        <span class="label">{{ c.label }}</span>
        <span class="value" :class="c.tone">{{ c.value }}</span>
        <span class="sub">{{ c.sub }}</span>
      </button>
    </div>
  </section>

  <div class="ov-cols">
    <section class="ov-section">
      <h2>模块就绪度<small>开发与顾问测试均已完成 / 仍需测试的开发项，点模块看未就绪的</small></h2>
      <div class="ov-card rates">
        <div v-for="(row, m) in r.byModule" :key="m" class="ov-bar">
          <span class="line"
            ><BaseTag :tone="moduleHue(String(m))">{{ m }}</BaseTag
            ><button
              type="button"
              class="ov-cell-button"
              :disabled="!row.notReady.length"
              @click="drill({ ids: row.notReady }, m + ' 未就绪')"
            >
              <strong>{{ row.ready }} / {{ row.total }}（{{ pct(row.ready, row.total) }}%）</strong>
            </button></span
          >
          <span class="track"
            ><span class="fill green" :style="{ width: pct(row.ready, row.total) + '%' }"></span
          ></span>
        </div>
      </div>
    </section>

    <section class="ov-section">
      <h2>开发完成待测<small>按等待天数排序</small></h2>
      <AwaitingTest :rows="data.development.awaitingTest" @open="open" />
    </section>
  </div>
</template>
<style scoped>
.rates {
  display: grid;
  gap: var(--space-4);
}
</style>
