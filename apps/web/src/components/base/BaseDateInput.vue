<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue';
import BasePopover from './BasePopover.vue';
// A date field (DESIGN.md 5, backlog UI-019): the date reads 2026-10-01 whatever the browser's
// language, can be typed (2026-10-1, 2026/10/01, 20261001 all work) or picked on a Chinese
// calendar. The value is an ISO date string, '' when empty, as a native date input gives.
const value = defineModel<string | null>({ default: '' });
const props = defineProps<{ label?: string; disabled?: boolean }>();

const text = ref(value.value ?? '');
watch(value, (v) => (text.value = v ?? ''));
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function parse(input: string): string | null {
  const t = input.trim();
  if (!t) return '';
  const m = t.match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    ? iso(y, mo, d)
    : null;
}
const invalid = ref(false);
function commit() {
  const next = parse(text.value);
  invalid.value = next === null;
  if (next === null) return;
  text.value = next;
  if (next !== (value.value ?? '')) value.value = next;
}

// The calendar: Monday first, six weeks, today ringed, the chosen day in ink.
const open = ref(false);
const today = new Date();
const todayIso = iso(today.getFullYear(), today.getMonth() + 1, today.getDate());
const shown = ref({ y: today.getFullYear(), m: today.getMonth() + 1 });
watch(open, (o) => {
  if (!o) return;
  const v = parse(value.value ?? '');
  const base = v ? v.split('-').map(Number) : [today.getFullYear(), today.getMonth() + 1];
  shown.value = { y: base[0]!, m: base[1]! };
});
function step(by: number) {
  const d = new Date(shown.value.y, shown.value.m - 1 + by, 1);
  shown.value = { y: d.getFullYear(), m: d.getMonth() + 1 };
}
const days = computed(() => {
  const { y, m } = shown.value;
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return { key, day: d.getDate(), inMonth: d.getMonth() === m - 1 };
  });
});
function pick(key: string) {
  value.value = key;
  invalid.value = false;
  open.value = false;
}
function clear() {
  value.value = '';
  invalid.value = false;
  open.value = false;
}
</script>
<template>
  <span class="base-date" :class="{ invalid, disabled: props.disabled }">
    <input
      v-model="text"
      class="base-date-text"
      type="text"
      inputmode="numeric"
      placeholder="年-月-日"
      :aria-label="label"
      :aria-invalid="invalid || undefined"
      :disabled="disabled"
      maxlength="10"
      @blur="commit"
      @keydown.enter.prevent="commit"
    />
    <BasePopover v-model:open="open" align="end">
      <template #trigger>
        <button
          type="button"
          class="base-date-open"
          :aria-label="(label ?? '日期') + '：打开日历'"
          :disabled="disabled"
        >
          <CalendarDays />
        </button>
      </template>
      <div class="base-calendar">
        <div class="base-calendar-head">
          <button type="button" aria-label="上个月" @click="step(-1)"><ChevronLeft /></button>
          <strong>{{ shown.y }} 年 {{ shown.m }} 月</strong>
          <button type="button" aria-label="下个月" @click="step(1)"><ChevronRight /></button>
        </div>
        <div class="base-calendar-grid">
          <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w" class="week">{{
            w
          }}</span>
          <button
            v-for="d in days"
            :key="d.key"
            type="button"
            class="day"
            :class="{ out: !d.inMonth, today: d.key === todayIso, chosen: d.key === value }"
            :aria-label="d.key"
            :aria-pressed="d.key === value"
            @click="pick(d.key)"
          >
            {{ d.day }}
          </button>
        </div>
        <div class="base-calendar-foot">
          <button type="button" @click="pick(todayIso)">今天</button>
          <button type="button" @click="clear">清除</button>
        </div>
      </div>
    </BasePopover>
  </span>
</template>
<style scoped>
.base-date {
  display: inline-flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: var(--control-input);
  padding: 0 var(--space-0-5) 0 var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  background: var(--panel);
  transition:
    border-color var(--motion-fast),
    box-shadow var(--motion-fast);
}
.base-date:hover {
  border-color: var(--border-emphasis);
}
.base-date:focus-within {
  border-color: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
}
.base-date.invalid {
  border-color: var(--red-solid-1);
}
.base-date.disabled {
  background: var(--neutral-bg-2);
  color: var(--text-muted);
}
/* Pages style their inputs; the field inside this one stays bare. */
.base-date .base-date-text {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  color: inherit;
  font-size: var(--font-14);
  font-variant-numeric: tabular-nums;
}
.base-date .base-date-text:focus,
.base-date .base-date-text:focus-visible {
  outline: none;
}
.base-date .base-date-text::placeholder {
  color: var(--text-subtle);
}
.base-date-open {
  display: inline-grid;
  place-items: center;
  width: var(--control-tab);
  height: var(--control-tab);
  border-radius: var(--radius-full);
  color: var(--neutral-icon-1);
}
.base-date-open:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.base-date-open svg {
  width: 16px;
  height: 16px;
}
.base-calendar {
  display: grid;
  gap: var(--space-2);
  width: calc(var(--control-icon) * 7 + var(--space-0-5) * 6);
}
.base-calendar-head,
.base-calendar-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.base-calendar-head strong {
  font-size: var(--font-14);
  font-weight: var(--weight-475);
}
.base-calendar-head button {
  display: inline-grid;
  place-items: center;
  width: var(--control-tab);
  height: var(--control-tab);
  border-radius: var(--radius-full);
  color: var(--text-muted);
}
.base-calendar-head button:hover {
  background: var(--hover);
  color: var(--text);
}
.base-calendar-head svg {
  width: 16px;
  height: 16px;
}
.base-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--space-0-5);
}
.week {
  color: var(--text-subtle);
  font-size: var(--font-12);
  line-height: var(--leading-24);
  text-align: center;
}
.day {
  height: var(--control-icon);
  border-radius: var(--radius-full);
  font-size: var(--font-12);
  font-variant-numeric: tabular-nums;
}
.day:hover {
  background: var(--hover);
}
.day.out {
  color: var(--text-subtle);
}
.day.today {
  box-shadow: inset 0 0 0 1px var(--border-emphasis);
  background: var(--accent-soft);
}
.day.chosen,
.day.chosen:hover {
  background: var(--primary);
  color: var(--on-primary);
}
.base-calendar-foot button {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.base-calendar-foot button:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
