<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseTabs from '../base/BaseTabs.vue';
import './dashboard.css';

// 每周进展 (docs/DESIGN.md 12.4): one chart for the weekly counts. 累计 shows the items in the
// list and how many finished each phase at each week's end, with the items added as bars; 每周
// shows what was added and finished in each week. The legend gives the latest week's numbers;
// hovering a week shows all of that week's numbers in a tip (user 2026-11-01).
const props = defineProps<{
  labels: string[];
  added: number[];
  total: number[];
  completed: { key: string; label: string; values: number[] }[];
}>();
const mode = ref('cum');
const modes = [
  { id: 'cum', label: '累计' },
  { id: 'week', label: '每周' },
];
const perWeek = (values: number[]) => values.map((v, i) => v - (i ? values[i - 1]! : 0));

const WIDTH = 700;
const LEFT = 36;
const RIGHT = 684;
const BASE = 280;
const chart = computed(() => {
  const cum = mode.value === 'cum';
  const series = [
    ...(cum ? [{ key: 'total', label: '开发项总数', values: props.total }] : []),
    ...props.completed.map((c) => ({
      key: c.key,
      label: c.label,
      values: cum ? c.values : perWeek(c.values),
    })),
  ];
  const n = props.labels.length;
  const gap = n > 1 ? (RIGHT - LEFT) / (n - 1) : 0;
  const x = (i: number) => LEFT + i * gap;
  const max = Math.max(1, ...props.added, ...series.flatMap((s) => s.values));
  const step = max > 20 ? 10 : max > 8 ? 4 : 2;
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => BASE - (v / top) * (BASE - 20);
  const grid = [];
  for (let g = 0; g <= top; g += step) grid.push({ y: y(g), value: g });
  return {
    cum,
    grid,
    gap,
    x,
    y,
    lines: series.map((s) => ({
      ...s,
      points: s.values.map((v, i) => `${x(i)},${y(v)}`).join(' '),
      endY: y(s.values.at(-1) ?? 0),
    })),
    xs: props.labels.map((label, i) => ({ label, x: x(i) })),
    bars: props.added.map((v, i) => ({ x: x(i), y: y(v) })),
    area: cum
      ? `${props.total.map((v, i) => `${x(i)},${y(v)}`).join(' ')} ${RIGHT},${BASE} ${LEFT},${BASE}`
      : '',
    legend: [{ key: 'added', label: '新增开发项', values: props.added }, ...series],
  };
});
const summary = computed(() =>
  chart.value.legend.map((l) => `${l.label} ${l.values.at(-1) ?? 0}`).join('，'),
);

// The week under the pointer, and its tip on whichever side of the guide has room.
const hover = ref<number | null>(null);
const tip = computed(() => {
  const i = hover.value;
  if (i === null) return null;
  const left = (chart.value.x(i) / WIDTH) * 100;
  return {
    week: props.labels[i],
    left,
    flip: left > 60,
    rows: chart.value.legend.map((l) => ({ key: l.key, label: l.label, value: l.values[i] ?? 0 })),
  };
});
</script>
<template>
  <div class="weekly">
    <div class="weekly-tools">
      <p class="weekly-hint">
        {{
          chart.cum
            ? '近 8 周的累计个数：开发项总数与各阶段完成；柱为每周新增'
            : '近 8 周每周的个数：新增与各阶段完成'
        }}
      </p>
      <BaseTabs v-model="mode" :tabs="modes" label="口径" />
    </div>
    <div class="weekly-plot">
      <svg
        :viewBox="`0 0 ${WIDTH} ${BASE + 28}`"
        role="img"
        :aria-label="`每周进展（${chart.cum ? '累计' : '每周'}），最近一周：${summary}`"
        @mouseleave="hover = null"
      >
        <template v-for="g in chart.grid" :key="g.value">
          <line class="grid" :x1="LEFT" :x2="RIGHT" :y1="g.y" :y2="g.y" />
          <text class="axis" :x="LEFT - 10" :y="g.y + 4" text-anchor="end">{{ g.value }}</text>
        </template>
        <polygon v-if="chart.area" class="area" :points="chart.area" />
        <rect
          v-for="(b, i) in chart.bars"
          :key="'b' + i"
          class="bar"
          :class="{ on: hover === i }"
          :x="b.x - 11"
          :y="b.y"
          width="22"
          :height="BASE - b.y"
          rx="6"
        />
        <line
          v-if="hover !== null"
          class="guide"
          :x1="chart.x(hover)"
          :x2="chart.x(hover)"
          y1="16"
          :y2="BASE"
        />
        <template v-for="l in chart.lines" :key="l.key">
          <polyline :class="['line', l.key]" :points="l.points" />
          <circle
            :class="['dot', l.key]"
            :cx="hover === null ? RIGHT : chart.x(hover)"
            :cy="hover === null ? l.endY : chart.y(l.values[hover] ?? 0)"
            r="4"
          />
        </template>
        <text
          v-for="(t, i) in chart.xs"
          :key="t.label"
          class="axis"
          :class="{ on: hover === i }"
          :x="t.x"
          :y="BASE + 22"
          text-anchor="middle"
        >
          {{ t.label }}
        </text>
        <rect
          v-for="(t, i) in chart.xs"
          :key="'h' + i"
          class="hit"
          :x="t.x - chart.gap / 2"
          y="0"
          :width="chart.gap || WIDTH"
          :height="BASE + 28"
          @mouseenter="hover = i"
        />
      </svg>
      <div
        v-if="tip"
        class="weekly-tip"
        :class="{ flip: tip.flip }"
        :style="{ left: tip.left + '%' }"
        aria-hidden="true"
      >
        <span class="tip-week">{{ tip.week }} 当周</span>
        <span v-for="r in tip.rows" :key="r.key" class="tip-row">
          <i :class="['swatch', r.key]" />{{ r.label }}<b>{{ r.value }}</b>
        </span>
      </div>
    </div>
    <ul class="weekly-legend">
      <li v-for="l in chart.legend" :key="l.key">
        <i :class="['swatch', l.key]" />{{ l.label }}<b>{{ l.values.at(-1) ?? 0 }}</b>
      </li>
    </ul>
  </div>
</template>
<style scoped>
.weekly {
  display: grid;
  gap: var(--space-3);
}
.weekly-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.weekly-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.weekly-plot {
  position: relative;
}
svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  font-family: var(--font-sans);
  font-variant-numeric: tabular-nums;
}
.grid {
  stroke: var(--border);
}
.axis {
  fill: var(--text-subtle);
  font-size: var(--font-11);
}
.axis.on {
  fill: var(--text);
  font-weight: var(--weight-550);
}
.area {
  fill: color-mix(in srgb, var(--neutral-solid-1) 5%, transparent);
}
.bar {
  fill: var(--neutral-fill-3);
}
.bar.on {
  fill: var(--border-emphasis);
}
.guide {
  stroke: var(--text-subtle);
  stroke-dasharray: 2 3;
}
.hit {
  fill: transparent;
}
.line {
  fill: none;
  stroke: var(--series);
  stroke-width: 3;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.line.total {
  stroke-width: 2;
  stroke-dasharray: 5 4;
}
.dot {
  fill: var(--series);
  stroke: var(--panel);
  stroke-width: 2;
}
/* One colour per series, shared by its line, dot and swatches. */
.total {
  --series: var(--neutral-icon-1);
}
.fsd {
  --series: var(--accent-hover);
}
.development {
  --series: var(--chart-1);
}
.consultant_test {
  --series: var(--chart-2);
}
.added {
  --series: var(--neutral-fill-3);
}
.swatch {
  display: inline-block;
  flex: none;
  width: var(--space-3);
  height: var(--space-1);
  border-radius: var(--radius-full);
  background: var(--series);
}

/* The latest week's numbers, one chip per series. */
.weekly-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5) var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.weekly-legend li {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
}
.weekly-legend b {
  color: var(--text);
  font-weight: var(--weight-550);
  font-variant-numeric: tabular-nums;
}

/* The hovered week's numbers, beside the guide line. */
.weekly-tip {
  position: absolute;
  top: 0;
  display: grid;
  gap: var(--space-1);
  min-width: 148px;
  margin-left: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-12);
  background: var(--tooltip-bg);
  box-shadow: var(--shadow-popover);
  color: var(--tooltip-text);
  font-size: var(--font-12);
  pointer-events: none;
}
.weekly-tip.flip {
  margin-left: 0;
  transform: translateX(calc(-100% - var(--space-3)));
}
.tip-week {
  font-weight: var(--weight-550);
}
.tip-row {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
}
.tip-row b {
  margin-left: auto;
  padding-left: var(--space-3);
  font-weight: var(--weight-550);
  font-variant-numeric: tabular-nums;
}
/* On the ink tip the ink and pale series turn light so their swatches still show. */
.tip-row .swatch.added {
  --series: var(--neutral-fill-1);
}
.tip-row .swatch.development {
  --series: var(--tooltip-text);
}
</style>
