<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarRange, RefreshCw } from '@lucide/vue';
import { addDays, type OverviewFilter } from '@sap-delivery-workbench/contracts/delivery/overview';
import {
  isoWeek,
  loadWindow,
  mondayOf,
  sumRows,
  type LoadRow,
} from '@sap-delivery-workbench/contracts/delivery/load';
import BaseBanner from '../../components/base/BaseBanner.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseEmptyState from '../../components/base/BaseEmptyState.vue';
import BaseIconButton from '../../components/base/BaseIconButton.vue';
import BaseSelect from '../../components/base/BaseSelect.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { api, ApiError } from '../../services/session';
import { currentProject } from '../../services/projectContext';
import { loadLink, pct, shortDate, type DevelopmentLoad } from './model';

// 开发管理 → 开发排期 (docs/specs/development-load.md): per developer and week, the development
// effort and items planned to finish, those actually finished and the running difference. The
// base Monday (?week=) picks the nine weeks shown; a number opens the development list in this
// tab, and the back button returns here exactly as it was.
const route = useRoute();
const router = useRouter();
const data = ref<DevelopmentLoad | null>(null);
const loading = ref(false);
const error = ref('');
let generation = 0;
async function load() {
  const project = currentProject.value;
  const request = ++generation;
  error.value = '';
  if (!project) return;
  loading.value = true;
  try {
    const result = await api<DevelopmentLoad>('/projects/' + project + '/development-load');
    if (request !== generation) return;
    data.value = result;
  } catch (e) {
    if (request !== generation) return;
    data.value = null;
    error.value =
      e instanceof ApiError && e.status === 403
        ? '你没有查看开发排期的权限，请联系项目经理。'
        : (e as Error).message;
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(
  currentProject,
  () => {
    data.value = null;
    void load();
  },
  { immediate: true },
);

// The base Monday: from the address when it is one of the project's options, else this week.
const base = computed(() => {
  const d = data.value;
  if (!d) return '';
  const asked = typeof route.query.week === 'string' ? route.query.week : '';
  return d.options.includes(asked) ? asked : d.base;
});
const thisWeek = computed(() => (data.value ? mondayOf(data.value.today) : ''));
function pick(week: string) {
  if (week !== base.value) void router.replace({ query: { ...route.query, week } });
}
const options = computed(() =>
  (data.value?.options ?? []).map((monday) => ({
    value: monday,
    label: `${monday}（${isoWeek(monday)}）${monday === thisWeek.value ? ' 本周' : ''}`,
  })),
);

interface Line {
  key: string;
  name: string;
  note?: string;
  kind: 'total' | 'person' | 'tbd';
  who: OverviewFilter;
  row: LoadRow;
}
const empty = (id: string | null): LoadRow => ({
  id,
  items: 0,
  done: 0,
  effort: 0,
  unplanned: 0,
  weeks: {},
});
const lines = computed<Line[]>(() => {
  const d = data.value;
  if (!d) return [];
  const byId = new Map(d.rows.map((r) => [r.id, r]));
  const people: Line[] = d.people.map((p) => ({
    key: p.id,
    name: p.name,
    note: p.active ? undefined : '已离开项目',
    kind: 'person',
    who: { assignee: p.id },
    row: byId.get(p.id) ?? empty(p.id),
  }));
  const tbd = byId.get(null);
  return [
    { key: 'total', name: '总计', kind: 'total', who: {}, row: sumRows(d.rows) },
    ...people,
    ...(tbd
      ? [
          {
            key: 'tbd',
            name: 'TBD',
            note: '未分配开发人员',
            kind: 'tbd',
            who: { unassigned: true },
            row: tbd,
          } as Line,
        ]
      : []),
  ];
});
const table = computed(() =>
  base.value
    ? lines.value.map((line) => ({ ...line, cols: loadWindow(line.row, base.value) }))
    : [],
);
const weeks = computed(() => table.value[0]?.cols.weeks.map((w) => w.monday) ?? []);
const beforeLabel = computed(() => (weeks.value[0] ? shortDate(weeks.value[0]) + ' 以前' : ''));

// --- drill-down --------------------------------------------------------------------------
function open(line: Line, filter: OverviewFilter, what: string) {
  const label = `${line.kind === 'total' ? '全部' : line.name} · ${what}`;
  void router.push(loadLink(currentProject.value, { ...line.who, ...filter }, label));
}
const range = (monday: string) => `${monday}~${addDays(monday, 6)}`;
const beforeRange = () => '~' + addDays(weeks.value[0]!, -1);
const weekName = (monday: string) =>
  `${isoWeek(monday)}（${shortDate(monday)}~${shortDate(addDays(monday, 6))}）`;
const show = (n: number) => (n ? String(Math.round(n * 10) / 10) : '');
const tone = (diff: number) => (diff < 0 ? 'bad' : diff > 0 ? 'good' : '');
</script>
<template>
  <div class="ld">
    <h1 class="ld-sr">开发排期</h1>
    <div class="ld-head">
      <div v-if="data" class="ld-totals" aria-label="开发进度">
        <span class="ld-total"
          ><span class="ld-total-label">总个数</span><strong>{{ data.totals.items }}</strong></span
        >
        <span class="ld-total"
          ><span class="ld-total-label">已开发</span><strong>{{ data.totals.developed }}</strong
          ><span class="ld-pct">{{ pct(data.totals.developed, data.totals.items) }}%</span></span
        >
        <span class="ld-total"
          ><span class="ld-total-label">已测试</span><strong>{{ data.totals.tested }}</strong
          ><span class="ld-pct">{{ pct(data.totals.tested, data.totals.items) }}%</span></span
        >
        <span class="ld-hint">已测试按顾问测试完成计</span>
      </div>
      <span v-else />
      <span class="ld-tools">
        <span class="ld-base-label">统计基准日期</span>
        <BaseSelect
          v-if="data"
          :model-value="base"
          :options="options"
          label="统计基准日期"
          @update:model-value="pick"
        />
        <BaseButton
          v-if="data && base !== thisWeek && data.options.includes(thisWeek)"
          size="sm"
          @click="pick(thisWeek)"
          >回到本周</BaseButton
        >
        <BaseIconButton label="刷新" size="sm" :disabled="loading" @click="load()"
          ><RefreshCw
        /></BaseIconButton>
      </span>
    </div>

    <BaseBanner v-if="error" tone="red">{{ error }}</BaseBanner>
    <div v-else-if="!data" class="ld-loading" aria-busy="true">
      <BaseSkeleton height="48px" />
      <BaseSkeleton height="420px" />
    </div>
    <BaseEmptyState
      v-else-if="!data.people.length && !data.rows.length"
      title="还没有开发人员和开发项"
      text="在成员与权限中添加开发顾问，或在开发清单中给开发阶段指派负责人、填计划完成日后，这里按周汇总。"
      ><template #icon><CalendarRange /></template
    ></BaseEmptyState>
    <div v-else class="ld-scroll">
      <table class="ld-table">
        <thead>
          <tr>
            <th rowspan="4" class="ld-name ld-stick">开发人员</th>
            <th rowspan="4" class="ld-unplanned ld-stick">未安排<br />计划日期</th>
            <th rowspan="3" colspan="4" class="ld-group">总计</th>
            <th rowspan="3" colspan="4" class="ld-group">{{ beforeLabel }}</th>
            <th
              v-for="w in weeks"
              :key="w"
              colspan="4"
              class="ld-group"
              :class="{ now: w === thisWeek, base: w === base }"
            >
              {{ w }}
            </th>
          </tr>
          <tr>
            <th
              v-for="w in weeks"
              :key="w"
              colspan="4"
              class="ld-group ld-sub"
              :class="{ now: w === thisWeek, base: w === base }"
            >
              {{ isoWeek(w) }}
            </th>
          </tr>
          <tr>
            <th
              v-for="w in weeks"
              :key="w"
              colspan="4"
              class="ld-group ld-sub"
              :class="{ now: w === thisWeek, base: w === base }"
            >
              {{ shortDate(w) }}~{{ shortDate(addDays(w, 6)) }}
            </th>
          </tr>
          <tr class="ld-metrics">
            <template v-for="g in weeks.length + 2" :key="g">
              <th class="ld-effort ld-first" title="预计人天">预计<br />人天</th>
              <th class="ld-planned" title="计划个数">计划<br />个数</th>
              <th class="ld-actual" title="实际个数">实际<br />个数</th>
              <th class="ld-diff" title="累计差异个数：从左累计的实际个数减计划个数">
                累计<br />差异
              </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in table" :key="line.key" :class="line.kind">
            <th scope="row" class="ld-name ld-stick">
              {{ line.name }}<small v-if="line.note">{{ line.note }}</small>
            </th>
            <td class="ld-unplanned ld-stick" :class="{ alert: line.row.unplanned }">
              <button
                v-if="line.row.unplanned"
                type="button"
                class="ld-num"
                @click="open(line, { unplanned: true }, '未安排计划日期')"
              >
                {{ line.row.unplanned }}
              </button>
            </td>
            <!-- 总计 -->
            <td class="ld-effort ld-first">{{ show(line.cols.total.effort) }}</td>
            <td class="ld-planned">
              <button
                v-if="line.cols.total.planned"
                type="button"
                class="ld-num"
                @click="open(line, { active: true }, '全部开发项')"
              >
                {{ line.cols.total.planned }}
              </button>
            </td>
            <td class="ld-actual">
              <button
                v-if="line.cols.total.actual"
                type="button"
                class="ld-num"
                @click="open(line, { status: 'completed' }, '已完成')"
              >
                {{ line.cols.total.actual }}
              </button>
            </td>
            <td class="ld-diff" :class="tone(line.cols.total.diff)">
              {{ line.cols.total.diff || '' }}
            </td>
            <!-- 基准日以前 -->
            <td class="ld-effort ld-first">{{ show(line.cols.before.effort) }}</td>
            <td class="ld-planned">
              <button
                v-if="line.cols.before.planned"
                type="button"
                class="ld-num"
                @click="open(line, { planned: beforeRange() }, beforeLabel + ' 计划')"
              >
                {{ line.cols.before.planned }}
              </button>
            </td>
            <td class="ld-actual">
              <button
                v-if="line.cols.before.actual"
                type="button"
                class="ld-num"
                @click="open(line, { actual: beforeRange() }, beforeLabel + ' 实际')"
              >
                {{ line.cols.before.actual }}
              </button>
            </td>
            <td class="ld-diff" :class="tone(line.cols.before.diff)">
              {{ line.cols.before.diff || '' }}
            </td>
            <!-- 九周 -->
            <template v-for="w in line.cols.weeks" :key="w.monday">
              <td class="ld-effort ld-first" :class="{ now: w.monday === thisWeek }">
                {{ show(w.effort) }}
              </td>
              <td class="ld-planned">
                <button
                  v-if="w.planned"
                  type="button"
                  class="ld-num"
                  @click="open(line, { planned: range(w.monday) }, weekName(w.monday) + ' 计划')"
                >
                  {{ w.planned }}
                </button>
              </td>
              <td class="ld-actual">
                <button
                  v-if="w.actual"
                  type="button"
                  class="ld-num"
                  @click="open(line, { actual: range(w.monday) }, weekName(w.monday) + ' 实际')"
                >
                  {{ w.actual }}
                </button>
              </td>
              <td class="ld-diff" :class="tone(w.diff)">{{ w.diff || '' }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="data && (data.people.length || data.rows.length)" class="ld-note">
      只统计开发阶段：预计人天与计划个数按计划完成日所在的周，实际个数按实际完成日所在的周；累计差异从左往右累计“实际
      −
      计划”。总计的计划个数是该人负责的全部开发项（含未安排日期的）。开发阶段已取消的开发项不统计。点数字在本标签打开开发清单，后退即回到这里。
    </p>
  </div>
</template>
<style scoped>
.ld {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}
.ld-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.ld-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.ld-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.ld-total {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--panel);
  font-size: var(--font-14);
}
.ld-total-label {
  padding: var(--space-0-5) var(--space-2);
  border-radius: var(--radius-6);
  background: var(--blue-solid-1);
  color: var(--neutral-on-solid);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
.ld-total strong {
  padding-right: var(--space-1);
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-550);
}
.ld-pct {
  padding: var(--space-0-5) var(--space-1-5);
  border-radius: var(--radius-6);
  background: var(--green-bg-2);
  color: var(--green-text-1);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
.ld-hint,
.ld-note,
.ld-base-label {
  color: var(--text-muted);
  font-size: var(--font-12);
  line-height: var(--leading-16);
}
.ld-note {
  margin: 0;
}
.ld-tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ld-loading {
  display: grid;
  gap: var(--space-4);
}

/* The table: header rows and the first two columns stay while it scrolls both ways. */
.ld-scroll {
  max-height: calc(100dvh - 220px);
  min-height: 240px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--panel);
}
.ld-table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--font-12);
  line-height: var(--leading-16);
  font-variant-numeric: tabular-nums;
}
.ld-table th,
.ld-table td {
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  text-align: center;
  white-space: nowrap;
}
.ld-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}
.ld-table thead th {
  padding: var(--space-1) var(--space-1-5);
  background: var(--neutral-bg-2);
  color: var(--text);
  font-weight: var(--weight-550);
}
.ld-table thead .ld-sub {
  font-weight: var(--weight-400);
  color: var(--text-muted);
}
.ld-table thead .now {
  background: var(--green-bg-2);
  color: var(--green-text-1);
}
.ld-table thead .base:not(.now) {
  box-shadow: inset 0 2px 0 var(--blue-solid-1);
}
.ld-metrics th {
  min-width: 40px;
  font-size: var(--font-11);
  font-weight: var(--weight-475);
}
.ld-metrics .ld-diff {
  color: var(--red-text-1);
}
.ld-stick {
  position: sticky;
  z-index: 1;
}
thead .ld-stick {
  z-index: 3;
}
.ld-name {
  left: 0;
  min-width: 112px;
  text-align: left !important;
}
.ld-unplanned {
  left: 112px;
  min-width: 64px;
  box-shadow: 1px 0 0 var(--border-strong);
}
tbody .ld-name,
tbody .ld-unplanned {
  background: var(--panel);
}
tbody .ld-name {
  padding: var(--space-1) var(--space-2);
  font-weight: var(--weight-475);
}
.ld-name small {
  display: block;
  color: var(--text-muted);
  font-size: var(--font-11);
  font-weight: var(--weight-400);
}
.ld-table td {
  height: 30px;
  padding: 0;
  min-width: 40px;
}
.ld-first {
  border-left: 1px solid var(--border-strong);
}
.ld-effort {
  font-style: italic;
  color: var(--text-muted);
}
tbody .ld-planned {
  background: var(--yellow-bg-2);
}
tbody .ld-actual {
  background: var(--blue-bg-2);
}
tbody td.ld-effort.now {
  box-shadow: inset 2px 0 0 var(--green-solid-1);
}
.ld-diff {
  font-weight: var(--weight-550);
}
tbody .ld-diff.bad,
tbody .ld-unplanned.alert {
  background: var(--red-solid-1);
  color: var(--neutral-on-solid);
}
tbody .ld-diff.good {
  background: var(--green-solid-1);
  color: var(--neutral-on-solid);
}
tbody tr.total th,
tbody tr.total td {
  font-weight: var(--weight-550);
  border-bottom: 2px solid var(--border-strong);
}
tbody tr.tbd th,
tbody tr.tbd td {
  border-top: 1px solid var(--border-strong);
}
tbody tr:hover th,
tbody tr:hover td:not(.bad):not(.good):not(.alert) {
  background-color: var(--hover);
}
.ld-num {
  width: 100%;
  height: 100%;
  min-height: 30px;
  padding: 0 var(--space-1-5);
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ld-num:hover {
  color: var(--link);
  text-decoration: underline;
}
.ld-num:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
