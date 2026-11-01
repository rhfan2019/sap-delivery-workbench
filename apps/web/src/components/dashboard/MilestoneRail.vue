<script setup lang="ts">
import { computed, ref } from 'vue';
import { useElementSize } from '@vueuse/core';
import { AlertTriangle, Check, Flag } from '@lucide/vue';
import { milestoneState } from '@sap-delivery-workbench/contracts/projects/options';
import { daysBetween } from '@sap-delivery-workbench/contracts/delivery/overview';
import './dashboard.css';

// The project's milestones on a progress rail (docs/DESIGN.md 12): dates to scale, the part up
// to today filled, faint month names behind, each milestone a node that says achieved, overdue
// or still to come. Names sit under the rail in up to three rows so close dates do not collide.
export interface RailMilestone {
  key?: string | null;
  name: string;
  plannedOn: string | null;
  achievedOn: string | null;
}
// `cards`: that many of the next milestones also as cards under the rail, each with a status
// strip along its foot (overdue red, due within a week yellow, the next one blue).
const props = defineProps<{ milestones: RailMilestone[]; today: string; cards?: number }>();
const rail = ref<HTMLElement | null>(null);
const { width } = useElementSize(rail);
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const at = (date: string) => Date.parse(date + 'T00:00:00Z');

const view = computed(() => {
  const dated = props.milestones
    .filter((m) => m.achievedOn || m.plannedOn)
    .map((m, i) => {
      const date = (m.achievedOn ?? m.plannedOn)!;
      return {
        key: m.key || m.name + i,
        name: m.name,
        date,
        state: milestoneState(m, props.today),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!dated.length) return null;
  const first = Math.min(at(dated[0]!.date), at(props.today));
  const last = Math.max(at(dated.at(-1)!.date), at(props.today));
  const span = Math.max(1, last - first);
  // A little room at both ends, so the first and last names fit.
  const pos = (date: string) => 4 + ((at(date) - first) / span) * 92;
  // Greedy rows: a name goes in the first row whose last name ends before it starts.
  const px = width.value || 800;
  const ends: number[] = [];
  const stops = dated.map((s) => {
    const x = pos(s.date);
    const left = (x / 100) * px;
    const w = Math.max(64, s.name.length * 13 + 8);
    let row = ends.findIndex((end) => end < left - w / 2);
    if (row < 0) row = ends.length < 3 ? ends.length : ends.indexOf(Math.min(...ends));
    ends[row] = left + w / 2 + 8;
    const days = daysBetween(props.today, s.date);
    return {
      ...s,
      x,
      row,
      when:
        s.state === 'achieved'
          ? '已达成'
          : days === 0
            ? '今天'
            : days > 0
              ? `${days} 天后`
              : `已过 ${-days} 天`,
    };
  });
  // Month names from the first full month in range.
  const months: { label: string; x: number }[] = [];
  const d = new Date(first);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getTime() <= last) {
    months.push({ label: d.getUTCMonth() + 1 + ' 月', x: pos(d.toISOString().slice(0, 10)) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const done = stops.filter((s) => s.state === 'achieved').length;
  const next = stops.find((s) => s.state !== 'achieved');
  const coming = stops
    .filter((s) => s.state !== 'achieved')
    .slice(0, props.cards ?? 0)
    .map((s, i) => ({
      ...s,
      tone:
        s.state === 'delayed' ? 'red' : s.state === 'due' ? 'yellow' : i === 0 ? 'blue' : 'neutral',
      status:
        s.state === 'delayed'
          ? '已延期'
          : s.state === 'due'
            ? '即将到期'
            : i === 0
              ? '下一个'
              : '未到',
    }));
  return { stops, months, rows: ends.length, now: pos(props.today), done, next, coming };
});
</script>
<template>
  <p v-if="!view" class="dash-empty">
    项目还没有排期的里程碑。在“项目 → 计划与健康”中维护开发冻结、SIT、UAT 与上线日期。
  </p>
  <div v-else class="rail-wrap">
    <p class="rail-sum">
      已达成 <strong>{{ view.done }}</strong> / {{ view.stops.length }} 个里程碑<template
        v-if="view.next"
        ><span class="rail-sep">·</span>下一个：{{ view.next.name }}
        <span :class="['rail-when', view.next.state]">{{ view.next.when }}</span></template
      >
    </p>
    <div ref="rail" class="rail" :style="{ '--rows': view.rows }">
      <span
        v-for="m in view.months"
        :key="m.label + m.x"
        class="rail-month"
        :style="{ left: m.x + '%' }"
        >{{ m.label }}</span
      >
      <span class="rail-track"></span>
      <span class="rail-fill" :style="{ width: view.now + '%' }"></span>
      <span class="rail-today" :style="{ left: view.now + '%' }"
        ><span>今天 {{ md(today) }}</span></span
      >
      <ol class="rail-stops" aria-label="里程碑">
        <li
          v-for="s in view.stops"
          :key="s.key"
          :class="s.state"
          :style="{ left: s.x + '%', '--row': s.row }"
          :title="`${s.name} · ${s.date} · ${s.when}`"
        >
          <span class="rail-node"
            ><Check v-if="s.state === 'achieved'" /><AlertTriangle
              v-else-if="s.state === 'delayed'" /><Flag v-else
          /></span>
          <span class="rail-stem"></span>
          <span class="rail-label"
            ><strong>{{ s.name }}</strong
            ><small>{{ md(s.date) }} · {{ s.when }}</small></span
          >
        </li>
      </ol>
    </div>
    <ul v-if="view.coming.length" class="rail-cards">
      <li v-for="c in view.coming" :key="c.key" class="rail-card">
        <strong>{{ c.name }}</strong>
        <span class="rail-card-date">{{ c.date }}</span>
        <span class="rail-card-foot" :class="c.tone"
          ><span class="rail-card-dot"></span>{{ c.status
          }}<span class="rail-card-when">{{ c.when }}</span></span
        >
      </li>
    </ul>
  </div>
</template>
<style scoped>
.rail-wrap {
  display: grid;
  gap: var(--space-3);
}
.rail-sum {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.rail-sum strong {
  color: var(--link);
  font-weight: var(--weight-550);
}
.rail-sep {
  margin: 0 var(--space-1-5);
}
.rail-when {
  color: var(--text);
  font-weight: var(--weight-550);
}
.rail-when.due {
  color: var(--yellow-text-2);
}
.rail-when.delayed {
  color: var(--red-text-2);
}
/* Months above the rail, the rail, then the rows of names. */
.rail {
  position: relative;
  height: calc(var(--space-10) + var(--space-6) + var(--rows) * var(--space-10));
}
.rail-month {
  position: absolute;
  top: 0;
  color: var(--chart-grid);
  font-size: var(--font-32);
  font-weight: var(--weight-550);
  line-height: var(--leading-40);
  white-space: nowrap;
  pointer-events: none;
}
.rail-track,
.rail-fill {
  position: absolute;
  top: var(--space-10);
  left: 0;
  height: 6px;
  border-radius: var(--radius-full);
}
.rail-track {
  right: 0;
  background: var(--chart-track);
}
.rail-fill {
  background: var(--chart-1);
}
.rail-today {
  position: absolute;
  top: calc(var(--space-10) - var(--space-6));
  width: 2px;
  height: calc(var(--space-6) + 6px);
  background: var(--chart-1);
}
.rail-today span {
  position: absolute;
  bottom: 100%;
  left: 50%;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--chart-1);
  color: var(--on-primary);
  font-size: var(--font-11);
  line-height: var(--leading-16);
  white-space: nowrap;
  transform: translateX(-50%);
}
.rail-stops {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rail-stops li {
  position: absolute;
  top: calc(var(--space-10) + 3px - 11px);
  display: grid;
  justify-items: center;
  transform: translateX(-50%);
}
.rail-node {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 2px solid var(--chart-1);
  border-radius: var(--radius-full);
  background: var(--dash-card);
  color: var(--chart-1);
}
.rail-node svg {
  width: 12px;
  height: 12px;
  stroke-width: 2.5;
}
.achieved .rail-node {
  background: var(--chart-1);
  color: var(--on-primary);
}
.due .rail-node {
  border-color: var(--yellow-solid-1);
  color: var(--yellow-text-2);
}
.delayed .rail-node {
  border-color: var(--red-solid-1);
  background: var(--red-solid-1);
  color: var(--on-primary);
}
/* The stem reaches down to the name's row, dotted like the reference timeline. */
.rail-stem {
  width: 0;
  height: calc(var(--space-2) + var(--row) * var(--space-10));
  border-left: 2px dotted var(--chart-grid);
}
.rail-label {
  display: grid;
  justify-items: center;
  white-space: nowrap;
}
.rail-label strong {
  font-size: var(--font-12);
  font-weight: var(--weight-550);
  line-height: var(--leading-16);
}
.achieved .rail-label strong {
  color: var(--link);
}
.rail-label small {
  color: var(--text-muted);
  font-size: var(--font-11);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-16);
}
.delayed .rail-label small {
  color: var(--red-text-2);
}
.rail-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.rail-card {
  display: grid;
  gap: var(--space-0-5);
  padding: var(--space-3) var(--space-3) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
}
.rail-card strong {
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.rail-card-date {
  color: var(--text-muted);
  font-size: var(--font-12);
  font-variant-numeric: tabular-nums;
}
/* The status strip: a tinted band along the card's foot, state on the left, time on the right. */
.rail-card-foot {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  margin-top: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-6);
  font-size: var(--font-12);
}
.rail-card-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: currentColor;
}
.rail-card-when {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.rail-card-foot.red {
  background: var(--red-fill-1);
  color: var(--red-text-2);
}
.rail-card-foot.yellow {
  background: var(--yellow-fill-1);
  color: var(--yellow-text-2);
}
.rail-card-foot.blue {
  background: var(--blue-fill-1);
  color: var(--link);
}
.rail-card-foot.neutral {
  background: var(--neutral-fill-1);
  color: var(--text-muted);
}
</style>
