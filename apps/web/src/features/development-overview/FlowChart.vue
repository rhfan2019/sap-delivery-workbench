<script setup lang="ts">
import { computed, ref } from 'vue';
import { OPTIONS, PHASES, type PhaseKey } from '@sap-delivery-workbench/contracts/delivery/fields';
import BaseTabs from '../../components/base/BaseTabs.vue';
import { shortDate, type Flow } from './model';

// M22 cumulative flow: how many items of a phase were in each status each day, stacked, replayed
// from the phase status history. A widening blue band is work piling up; the slope of the green
// band is the throughput.
const props = defineProps<{ flow: Flow }>();
const phase = ref<PhaseKey>('development');
const tabs = PHASES.map((p) => ({ id: p.key, label: p.label }));
// Bottom to top; colours are the status semantics (DESIGN.md 2.2).
const LAYERS = [
  { status: 'completed', color: 'var(--green-solid-1)' },
  { status: 'cancelled', color: 'var(--neutral-fill-3)' },
  { status: 'delayed', color: 'var(--red-solid-1)' },
  { status: 'in_progress', color: 'var(--blue-solid-1)' },
  { status: 'not_started', color: 'var(--neutral-border-2)' },
];
const W = 600;
const H = 180;
const chart = computed(() => {
  const days = props.flow.days;
  const series = props.flow.status[phase.value];
  const totals = days.map((_, i) => LAYERS.reduce((n, l) => n + series[l.status][i], 0));
  const max = Math.max(1, ...totals);
  const x = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * W : W / 2);
  const y = (v: number) => H - (v / max) * H;
  const base = days.map(() => 0);
  const areas = LAYERS.map((l) => {
    const lower = [...base];
    const upper = base.map((b, i) => b + series[l.status][i]);
    upper.forEach((u, i) => (base[i] = u));
    const top = upper.map((v, i) => `${x(i)},${y(v)}`).join(' L');
    const bottom = lower
      .map((v, i) => `${x(i)},${y(v)}`)
      .reverse()
      .join(' L');
    return { ...l, d: `M${top} L${bottom} Z` };
  });
  const last = days.length - 1;
  return {
    areas,
    max,
    first: days[0],
    last: days[last],
    now: LAYERS.map((l) => ({ ...l, value: series[l.status][last] })).reverse(),
  };
});
</script>
<template>
  <div class="ov-card chart">
    <BaseTabs v-model="phase" :tabs="tabs" label="阶段" />
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`累积流图：${chart.first} 至 ${chart.last}`"
    >
      <path v-for="a in chart.areas" :key="a.status" :d="a.d" :fill="a.color" />
    </svg>
    <div class="axis">
      <span>{{ shortDate(chart.first) }}</span
      ><span>最多 {{ chart.max }} 项</span><span>{{ shortDate(chart.last) }}</span>
    </div>
    <p class="legend">
      今天：
      <span v-for="l in chart.now" :key="l.status" class="key"
        ><span class="swatch" :style="{ background: l.color }"></span>{{ OPTIONS.status[l.status] }}
        {{ l.value }}</span
      >
    </p>
  </div>
</template>
<style scoped>
.chart {
  display: grid;
  gap: var(--space-3);
}
svg {
  width: 100%;
  height: 180px;
  display: block;
}
.axis {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--font-12);
  font-variant-numeric: tabular-nums;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.key {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.swatch {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-2);
}
</style>
