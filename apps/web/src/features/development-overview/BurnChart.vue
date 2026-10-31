<script setup lang="ts">
import { computed } from 'vue';
import { addDays, daysBetween } from '@sap-delivery-workbench/contracts/delivery/overview';
import { shortDate, type Flow } from './model';

// M22 burn-down with the freeze back-calculation (spec section 5): FSD and development effort
// still open each day (current estimates), the ideal line to the code freeze, and the pace the
// freeze needs against the pace of the last four weeks.
const props = defineProps<{ flow: Flow }>();
const W = 600;
const H = 180;
const chart = computed(() => {
  const f = props.flow;
  const start = f.days[0];
  const today = f.days[f.days.length - 1];
  const end = f.freeze && f.freeze > today ? f.freeze : addDays(today, 1);
  const span = Math.max(1, daysBetween(start, end));
  const max = Math.max(1, ...f.remaining, f.ideal?.from.value ?? 0);
  const x = (date: string) => (daysBetween(start, date) / span) * W;
  const y = (v: number) => H - (v / max) * (H - 4);
  const line = f.days.map((d, i) => `${x(d)},${y(f.remaining[i])}`).join(' L');
  return {
    start,
    end,
    max,
    line: 'M' + line,
    ideal: f.ideal
      ? `M${x(f.ideal.from.date)},${y(f.ideal.from.value)} L${x(f.ideal.to.date)},${y(0)}`
      : '',
    // From today straight to zero at the freeze: the pace the freeze asks for.
    needed:
      f.freeze && f.freeze > today
        ? `M${x(today)},${y(f.pace.remaining)} L${x(f.freeze)},${y(0)}`
        : '',
    freezeX: f.freeze && f.freeze >= start ? x(f.freeze) : null,
    todayX: x(today),
  };
});
const verdict = computed(() => {
  const p = props.flow.pace;
  if (!props.flow.freeze) return { tone: '', text: '项目未设开发冻结日期，无法倒推节奏。' };
  if (p.requiredPerWeek === null)
    return {
      tone: p.remaining ? 'red' : '',
      text: p.remaining
        ? `开发冻结已到，仍有 ${p.remaining} 人天未完成。`
        : '开发冻结前的工作已全部完成。',
    };
  const short = p.recentPerWeek < p.requiredPerWeek;
  return {
    tone: short ? 'red' : 'green',
    text: `距开发冻结 ${p.weeksLeft} 周，剩余 ${p.remaining} 人天，需要每周完成 ${p.requiredPerWeek} 人天；近 4 周平均 ${p.recentPerWeek} 人天/周${short ? '，按现在的节奏赶不上' : '，节奏够用'}。`,
  };
});
</script>
<template>
  <div class="ov-card chart">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`燃尽图：最高 ${chart.max} 人天`"
    >
      <line class="grid" x1="0" :y1="H" :x2="W" :y2="H" />
      <path v-if="chart.ideal" class="ideal" :d="chart.ideal" />
      <path v-if="chart.needed" class="needed" :d="chart.needed" />
      <path class="actual" :d="chart.line" />
      <line class="today" :x1="chart.todayX" y1="0" :x2="chart.todayX" :y2="H" />
      <line
        v-if="chart.freezeX !== null"
        class="freeze"
        :x1="chart.freezeX"
        y1="0"
        :x2="chart.freezeX"
        :y2="H"
      />
    </svg>
    <div class="axis">
      <span>{{ shortDate(chart.start) }}</span
      ><span>最高 {{ chart.max }} 人天</span
      ><span>{{ flow.freeze ? '开发冻结 ' + shortDate(flow.freeze) : shortDate(chart.end) }}</span>
    </div>
    <p class="legend">
      <span class="key"><span class="mark actual"></span>剩余人天</span>
      <span v-if="chart.ideal" class="key"><span class="mark ideal"></span>理想线</span>
      <span v-if="chart.needed" class="key"><span class="mark needed"></span>冻结倒推线</span>
      <span class="key"><span class="mark today"></span>今天</span>
      <span v-if="chart.freezeX !== null" class="key"
        ><span class="mark freeze"></span>开发冻结</span
      >
    </p>
    <p class="verdict" :class="verdict.tone">{{ verdict.text }}</p>
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
svg path,
svg line {
  fill: none;
  vector-effect: non-scaling-stroke;
}
.grid {
  stroke: var(--border);
}
.actual {
  stroke: var(--blue-solid-1);
  stroke-width: 2;
}
.ideal {
  stroke: var(--border-emphasis);
  stroke-dasharray: 4 4;
}
.needed {
  stroke: var(--yellow-solid-1);
  stroke-dasharray: 4 4;
  stroke-width: 2;
}
.today {
  stroke: var(--blue-border-2);
}
.freeze {
  stroke: var(--red-solid-1);
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
.mark {
  width: 14px;
  height: 0;
  border-top: 2px solid var(--blue-solid-1);
}
.mark.ideal {
  border-top: 2px dashed var(--border-emphasis);
}
.mark.needed {
  border-top: 2px dashed var(--yellow-solid-1);
}
.mark.today {
  border-top-color: var(--blue-border-2);
}
.mark.freeze {
  border-top-color: var(--red-solid-1);
}
.verdict {
  margin: 0;
  font-size: var(--font-14);
}
.verdict.red {
  color: var(--red-text-2);
}
.verdict.green {
  color: var(--green-text-2);
}
</style>
