<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseTabs from '../base/BaseTabs.vue';
import './dashboard.css';

// 每周进展 (docs/DESIGN.md 12.4): one chart for the weekly counts. 累计 shows the items in the
// list and how many finished each phase at each week's end, with the items added as bars; 每周
// shows what was added and finished in each week. A small table under the chart gives every
// number, aligned to the weeks, the latest week in bold.
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

const LEFT = 110;
const RIGHT = 610;
const BASE = 200;
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
  const x = (i: number) => LEFT + (n > 1 ? (i * (RIGHT - LEFT)) / (n - 1) : 0);
  const max = Math.max(1, ...props.added, ...series.flatMap((s) => s.values));
  const step = max > 20 ? 10 : max > 8 ? 4 : 2;
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => BASE - (v / top) * 180;
  const grid = [];
  for (let g = 0; g <= top; g += step) grid.push({ y: y(g), value: g });
  const lines = series.map((s) => ({
    ...s,
    points: s.values.map((v, i) => `${x(i)},${y(v)}`).join(' '),
    endY: y(s.values.at(-1) ?? 0),
    labelY: 0,
  }));
  // End labels never overlap: each sits at least 14px below the one above it.
  let last = -Infinity;
  for (const l of [...lines].sort((a, b) => a.endY - b.endY)) {
    l.labelY = Math.max(l.endY + 4, last + 14);
    last = l.labelY;
  }
  const rows = [{ key: 'added', label: '新增开发项', values: props.added }, ...series];
  return {
    cum,
    grid,
    lines,
    xs: props.labels.map((label, i) => ({ label, x: x(i) })),
    bars: props.added.map((v, i) => ({ x: x(i), y: y(v), v })),
    area: cum
      ? `${props.total.map((v, i) => `${x(i)},${y(v)}`).join(' ')} ${RIGHT},${BASE} ${LEFT},${BASE}`
      : '',
    rows: rows.map((r, k) => ({ ...r, y: 258 + k * 22 })),
    height: 258 + rows.length * 22,
    x,
  };
});
const summary = computed(() =>
  chart.value.lines.map((l) => `${l.label} ${l.values.at(-1) ?? 0}`).join('，'),
);
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
    <svg
      :viewBox="`0 0 700 ${chart.height}`"
      role="img"
      :aria-label="`每周进展（${chart.cum ? '累计' : '每周'}）：${summary}`"
    >
      <template v-for="g in chart.grid" :key="g.value">
        <line class="grid" :x1="LEFT" :x2="RIGHT" :y1="g.y" :y2="g.y" />
        <text class="axis" :x="LEFT - 10" :y="g.y + 4" text-anchor="end">{{ g.value }}</text>
      </template>
      <polygon v-if="chart.area" class="area" :points="chart.area" />
      <template v-for="(b, i) in chart.bars" :key="'b' + i">
        <rect class="bar" :x="b.x - 11" :y="b.y" width="22" :height="BASE - b.y" rx="6" />
        <text v-if="b.v" class="bar-value" :x="b.x" :y="b.y - 5" text-anchor="middle">
          {{ b.v }}
        </text>
      </template>
      <template v-for="l in chart.lines" :key="l.key">
        <polyline :class="['line', l.key]" :points="l.points" />
        <circle :class="['dot', l.key]" :cx="RIGHT" :cy="l.endY" r="4" />
        <text class="end" :x="RIGHT + 10" :y="l.labelY">{{ l.values.at(-1) }} {{ l.label }}</text>
      </template>
      <text
        v-for="t in chart.xs"
        :key="t.label"
        class="axis"
        :x="t.x"
        :y="BASE + 22"
        text-anchor="middle"
      >
        {{ t.label }}
      </text>
      <line class="grid" x1="0" x2="700" y1="236" y2="236" />
      <template v-for="r in chart.rows" :key="'r' + r.key">
        <rect :class="['swatch', r.key]" x="0" :y="r.y - 7" width="12" height="4" rx="2" />
        <text class="row-name" x="18" :y="r.y">{{ r.label }}</text>
        <text
          v-for="(v, i) in r.values"
          :key="i"
          class="row-value"
          :class="{ latest: i === r.values.length - 1 }"
          :x="chart.x(i)"
          :y="r.y"
          text-anchor="middle"
        >
          {{ v }}
        </text>
      </template>
    </svg>
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
svg {
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
.area {
  fill: color-mix(in srgb, var(--neutral-solid-1) 5%, transparent);
}
.bar {
  fill: var(--neutral-fill-3);
}
.bar-value {
  fill: var(--text-muted);
  font-size: var(--font-11);
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
.dot,
.swatch {
  fill: var(--series);
}
/* One colour per series, shared by its line, end dot and table swatch. */
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
.end,
.row-value {
  fill: var(--text);
  font-size: var(--font-12);
}
.row-name {
  fill: var(--text-muted);
  font-size: var(--font-12);
}
.row-value.latest {
  font-weight: var(--weight-550);
}
</style>
