<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import BaseTag from '../../components/base/BaseTag.vue';
import { moduleHue } from '../../components/base/identity';
import { currentProject } from '../../services/projectContext';
import AwaitingTest from './AwaitingTest.vue';
import { openFrom, itemLink, pct, shortDate, type Overview } from './model';

// The tester view (spec section 2, test lead): readiness for SIT by module (M21), testing
// planned past its milestone (M20), testers still to assign, developed items waiting for a test.
const props = defineProps<{
  data: Overview;
  drill: (filter: OverviewFilter, label: string) => void;
}>();
const router = useRouter();
const open = (id: string) => void openFrom(router, itemLink(currentProject.value, id));
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
  <section class="ov-section">
    <h2>
      SIT 进场预测<small v-if="data.sitForecast"
        >SIT 开始 {{ shortDate(data.sitForecast.sit) }}；未完成的计划按本项目平均滞后
        {{ data.sitForecast.slip.days }} 天顺延（{{
          data.sitForecast.slip.samples
            ? `依据 ${data.sitForecast.slip.samples} 个已完成阶段`
            : '还没有已完成阶段，按 0 天'
        }}）</small
      >
    </h2>
    <div class="ov-card">
      <p v-if="!data.sitForecast" class="ov-empty">
        项目未设 SIT 开始日期。在“设置 → 项目 → 计划与健康”中维护后即可预测。
      </p>
      <table v-else class="ov-table">
        <thead>
          <tr>
            <th>模块</th>
            <th class="num">现在已就绪</th>
            <th class="num">预计 SIT 时就绪</th>
            <th class="num">仍需测试</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, m) in data.sitForecast.byModule" :key="m">
            <td>
              <BaseTag :tone="moduleHue(String(m))">{{ m }}</BaseTag>
            </td>
            <td class="num">{{ row.readyNow }}</td>
            <td class="num">{{ row.predicted }}</td>
            <td class="num">{{ row.total }}</td>
            <td>
              <button
                v-if="row.missing.length"
                type="button"
                class="ov-cell-button"
                @click="drill({ ids: row.missing }, m + ' 预计赶不上 SIT')"
              >
                {{ row.missing.length }} 项赶不上
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <section v-if="data.development.rework.some((r) => r.retest)" class="ov-section">
    <h2>需重测<small>FSD 定稿后又修改，而开发或测试已经开始的开发项</small></h2>
    <div class="ov-card">
      <span class="ov-tags">
        <button
          v-for="r in data.development.rework.filter((x) => x.retest)"
          :key="r.id"
          type="button"
          class="ov-cell-button"
          @click="open(r.id)"
        >
          {{ r.code }} {{ r.name }}（定稿后 {{ r.laterVersions }} 个新版本）
        </button>
      </span>
    </div>
  </section>
</template>
<style scoped>
.rates {
  display: grid;
  gap: var(--space-4);
}
</style>
