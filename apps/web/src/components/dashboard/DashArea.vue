<script setup lang="ts">
import { computed } from 'vue';
import './dashboard.css';

// A trend as a filled line (docs/DESIGN.md 12): one series over time, an optional dashed target
// line, the first and last labels under it. Drawn once with a stroke reveal, no bounce.
const props = defineProps<{
  values: number[];
  labels: string[];
  target?: (number | null)[];
  label: string;
}>();
const W = 600;
const H = 160;
const chart = computed(() => {
  const n = props.values.length;
  const all = [...props.values, ...(props.target ?? []).filter((v): v is number => v !== null)];
  const max = Math.max(1, ...all);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => H - (v / max) * (H - 8);
  const line = props.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const target = (props.target ?? [])
    .map((v, i) => (v === null ? '' : `${x(i)},${y(v)}`))
    .filter(Boolean);
  return {
    line,
    area: `${line} L${W},${H} L0,${H} Z`,
    target: target.length > 1 ? 'M' + target.join(' L') : '',
    max: Math.round(max),
  };
});
</script>
<template>
  <figure class="dash-area">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="label">
      <line class="grid" x1="0" :y1="H / 2" :x2="W" :y2="H / 2" />
      <line class="grid" x1="0" :y1="H" :x2="W" :y2="H" />
      <path class="fill" :d="chart.area" />
      <path v-if="chart.target" class="target" :d="chart.target" />
      <path class="stroke" :d="chart.line" pathLength="1" />
    </svg>
    <figcaption>
      <span>{{ labels[0] }}</span
      ><span>最高 {{ chart.max }}</span
      ><span>{{ labels[labels.length - 1] }}</span>
    </figcaption>
  </figure>
</template>
<style scoped>
/* The chart takes the height its card has left, at least 160px. */
.dash-area {
  display: grid;
  flex: 1;
  grid-template-rows: minmax(160px, 1fr) auto;
  gap: var(--space-1);
  margin: 0;
}
svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.grid {
  stroke: var(--chart-grid);
  vector-effect: non-scaling-stroke;
}
.fill {
  fill: color-mix(in srgb, var(--chart-1) 14%, transparent);
}
.stroke {
  fill: none;
  stroke: var(--chart-1);
  stroke-width: 2.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.target {
  fill: none;
  stroke: var(--text-subtle);
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}
@media (prefers-reduced-motion: no-preference) {
  .stroke {
    stroke-dasharray: 1;
    animation: draw var(--duration-slow) ease-out both;
    animation-duration: calc(var(--duration-slow) * 3);
  }
}
@keyframes draw {
  from {
    stroke-dashoffset: 1;
  }
}
figcaption {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--font-12);
  font-variant-numeric: tabular-nums;
}
</style>
