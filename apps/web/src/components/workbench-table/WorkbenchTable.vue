<script setup lang="ts" generic="T extends { id: string; code?: string }">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import {
  getCoreRowModel,
  useVueTable,
  type ColumnDef,
  type ColumnSizingState,
  type Header,
  type Updater,
} from '@tanstack/vue-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from '@lucide/vue';
import BaseButton from '../base/BaseButton.vue';
import BaseDialog from '../base/BaseDialog.vue';
import BaseEmptyState from '../base/BaseEmptyState.vue';
import BaseIconButton from '../base/BaseIconButton.vue';
import BaseSkeleton from '../base/BaseSkeleton.vue';
import type { WorkbenchColumn } from './types';
import { layoutColumns } from './layout';

// The list table (DESIGN.md 5, contract 1.15): TanStack Table keeps column order, visibility,
// width and pinning; the page keeps filtering and sorting. The layout (order, visibility,
// width) is saved per person and project under `storageKey`, in the same shape as before.
const props = defineProps<{
  rows: T[];
  columns: WorkbenchColumn[];
  storageKey: string;
  checked: string[];
  currentId?: string;
  compact?: boolean;
  compactKeys?: string[];
  loading?: boolean;
  disabled?: boolean;
  emptyText?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc' | null;
  viewKey?: string;
}>();
const emit = defineEmits<{
  'update:checked': [ids: string[]];
  open: [row: T];
  sort: [field: string, order: 'asc' | 'desc' | null];
  'columns-change': [keys: string[]];
}>();

const root = ref<HTMLElement>();
const scroller = ref<HTMLElement>();
const availableWidth = ref(0);
let resizeFrame = 0;
// Measure the scrolling area, not the frame: its content box leaves out the vertical scroll bar,
// so the columns never overflow sideways just because the rows scroll.
useResizeObserver([root, scroller], () => {
  const width = scroller.value?.clientWidth || root.value?.clientWidth || 0;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => (availableWidth.value = width));
});
onBeforeUnmount(() => cancelAnimationFrame(resizeFrame));
// Cards on a phone; the narrowed list beside a detail panel stays a (compact) table.
const mobile = computed(
  () => !props.compact && availableWidth.value > 0 && availableWidth.value < 600,
);

// --- saved layout --------------------------------------------------------------------------
const configuration = ref<WorkbenchColumn[]>([]);
watch(
  [() => props.storageKey, () => props.columns.map((c) => c.key + ':' + c.label).join('|')],
  () => {
    let saved: WorkbenchColumn[] = [];
    try {
      const value = JSON.parse(localStorage.getItem(props.storageKey) || '[]');
      if (Array.isArray(value)) saved = value.filter((c) => c && typeof c.key === 'string');
    } catch {
      // Storage is optional; the default layout applies.
    }
    const base = props.columns;
    const keys = [...new Set([...saved.map((c) => c.key), ...base.map((c) => c.key)])];
    configuration.value = keys.flatMap((key) => {
      const column = base.find((c) => c.key === key);
      if (!column) return [];
      const preference = saved.find((c) => c.key === key);
      return [
        {
          ...column,
          visible: column.required
            ? true
            : typeof preference?.visible === 'boolean'
              ? preference.visible
              : column.visible !== false,
          width: Number.isFinite(preference?.width)
            ? Math.max(64, Math.min(640, preference!.width!))
            : column.width,
        },
      ];
    });
  },
  { immediate: true },
);
watch(
  configuration,
  () => {
    try {
      localStorage.setItem(props.storageKey, JSON.stringify(configuration.value));
    } catch {
      // Storage is optional.
    }
    emit(
      'columns-change',
      configuration.value.filter((c) => c.visible !== false).map((c) => c.key),
    );
  },
  { deep: true, immediate: true },
);

// --- TanStack table ------------------------------------------------------------------------
const SELECT = '_selection';
const shown = computed(() =>
  configuration.value.filter(
    (c) =>
      c.visible !== false &&
      (!c.hideBelow || !availableWidth.value || availableWidth.value >= c.hideBelow) &&
      (!props.compact || !props.compactKeys || props.compactKeys.includes(c.key)),
  ),
);
const byKey = computed(() => new Map(configuration.value.map((c) => [c.key, c])));
const definitions = computed<ColumnDef<T>[]>(() => [
  { id: SELECT, size: 44, enableResizing: false },
  ...configuration.value.map((c) => ({
    id: c.key,
    header: c.label,
    size: c.width ?? c.minWidth ?? 120,
    minSize: c.minWidth ?? 64,
    maxSize: 640,
    enableResizing: c.key !== 'actions',
  })),
]);
const sizing = computed<ColumnSizingState>(() =>
  Object.fromEntries(configuration.value.map((c) => [c.key, c.width ?? c.minWidth ?? 120])),
);
function setSizing(updater: Updater<ColumnSizingState>) {
  const next = typeof updater === 'function' ? updater(sizing.value) : updater;
  for (const c of configuration.value)
    if (next[c.key] && next[c.key] !== c.width) c.width = Math.round(next[c.key]);
}
const table = useVueTable<T>({
  get data() {
    return props.rows;
  },
  get columns() {
    return definitions.value;
  },
  getRowId: (row) => row.id,
  getCoreRowModel: getCoreRowModel(),
  columnResizeMode: 'onChange',
  state: {
    get columnSizing() {
      return sizing.value;
    },
    get columnOrder() {
      return [SELECT, ...configuration.value.map((c) => c.key)];
    },
    get columnVisibility() {
      const visible = new Set(shown.value.map((c) => c.key));
      return Object.fromEntries(configuration.value.map((c) => [c.key, visible.has(c.key)]));
    },
    get columnPinning() {
      if (props.compact) return { left: [SELECT], right: [] };
      const left = shown.value.filter((c) => c.fixed === 'left').map((c) => c.key);
      const right = shown.value.filter((c) => c.fixed === 'right').map((c) => c.key);
      return { left: [SELECT, ...left], right };
    },
  },
  onColumnSizingChange: setSizing,
});

// Rendered widths: the requested widths, with spare room given to the flexible column.
const widths = computed(() => {
  const leaves = table.getVisibleLeafColumns();
  const laid = layoutColumns(
    leaves
      .filter((c) => c.id !== SELECT)
      .map((c) => {
        const column = byKey.value.get(c.id)!;
        // Beside a detail panel the flexible column gives way so the compact columns fit.
        return props.compact && column.flex
          ? { ...column, width: 120, minWidth: 120 }
          : { ...column, width: c.getSize() };
      }),
    Math.max(0, availableWidth.value - 2),
  );
  const map = new Map<string, number>([[SELECT, 44]]);
  for (const c of laid) map.set(c.key, c.width);
  return map;
});
const tableWidth = computed(() => [...widths.value.values()].reduce((a, b) => a + b, 0));
// Sticky offsets for pinned columns.
const offsets = computed(() => {
  const map = new Map<string, { side: 'left' | 'right'; at: number; edge: boolean }>();
  const pinning = table.getState().columnPinning;
  let at = 0;
  pinning.left?.forEach((id, i, all) => {
    map.set(id, { side: 'left', at, edge: i === all.length - 1 });
    at += widths.value.get(id) ?? 0;
  });
  at = 0;
  [...(pinning.right ?? [])].reverse().forEach((id, i, all) => {
    map.set(id, { side: 'right', at, edge: i === all.length - 1 });
    at += widths.value.get(id) ?? 0;
  });
  return map;
});
function pinStyle(id: string) {
  const pin = offsets.value.get(id);
  return pin ? { position: 'sticky' as const, [pin.side]: pin.at + 'px' } : undefined;
}
function pinClass(id: string) {
  const pin = offsets.value.get(id);
  return pin ? ['pinned', pin.edge ? 'pin-edge-' + pin.side : ''] : [];
}
const label = (id: string) => byKey.value.get(id)?.label ?? '';
const sortable = (id: string) => id !== SELECT && byKey.value.get(id)?.sortable !== false;

// --- selection, sorting, opening ----------------------------------------------------------
const allChecked = computed(
  () => props.rows.length > 0 && props.rows.every((r) => props.checked.includes(r.id)),
);
const someChecked = computed(
  () => props.rows.some((r) => props.checked.includes(r.id)) && !allChecked.value,
);
// The latest selection, so quick successive clicks build on each other before props catch up.
let selection: string[] = [];
watch(
  () => props.checked,
  (value) => (selection = [...value]),
  { immediate: true },
);
function toggle(id: string, value: boolean) {
  selection = value ? [...new Set([...selection, id])] : selection.filter((v) => v !== id);
  emit('update:checked', selection);
}
function toggleAll(value: boolean) {
  selection = value ? props.rows.map((r) => r.id) : [];
  emit('update:checked', selection);
}
function sort(id: string) {
  const order =
    props.sortField !== id || !props.sortOrder ? 'asc' : props.sortOrder === 'asc' ? 'desc' : null;
  emit('sort', id, order);
}
function rowClick(row: T, event: MouseEvent) {
  if (props.disabled) return;
  const target = event.target as HTMLElement;
  if (target.closest('a,button,input,select,textarea,label,.field-display,[data-no-open]')) return;
  emit('open', row);
}
function resize(header: Header<T, unknown>, event: MouseEvent | TouchEvent) {
  event.stopPropagation();
  header.getResizeHandler()(event);
}

// --- scroll memory --------------------------------------------------------------------------
let restoring = false;
const scrollKey = () => 'delivery-scroll:' + props.viewKey + (mobile.value ? ':mobile' : ':table');
function rememberScroll() {
  const el = scroller.value;
  if (!el || !props.viewKey || restoring || props.loading || !props.rows.length) return;
  try {
    sessionStorage.setItem(
      scrollKey(),
      JSON.stringify({ scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }),
    );
  } catch {
    // Optional.
  }
}
watch(
  [() => props.viewKey, mobile, () => props.rows.length > 0],
  async () => {
    if (!props.rows.length || !props.viewKey) return;
    restoring = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(scrollKey()) || '{}');
      await nextTick();
      scroller.value?.scrollTo(Number(saved.scrollLeft) || 0, Number(saved.scrollTop) || 0);
    } catch {
      // Optional.
    } finally {
      restoring = false;
    }
  },
  { flush: 'post' },
);

// --- column settings ------------------------------------------------------------------------
const settingsOpen = ref(false);
function move(index: number, direction: number) {
  const list = [...configuration.value];
  const other = index + direction;
  if (other < 0 || other >= list.length || list[index].fixed || list[other].fixed) return;
  [list[index], list[other]] = [list[other], list[index]];
  configuration.value = list;
}
function reset() {
  configuration.value = props.columns.map((c) => ({ ...c, visible: c.visible !== false }));
}
defineExpose({ openColumns: () => (settingsOpen.value = true) });
</script>

<template>
  <div ref="root" class="workbench-table" :aria-busy="loading">
    <div v-if="mobile" ref="scroller" class="mobile-list" @scroll.passive="rememberScroll">
      <label class="mobile-all"
        ><input
          type="checkbox"
          aria-label="选择当前页全部"
          :checked="allChecked"
          :indeterminate="someChecked"
          :disabled="disabled || !rows.length"
          @change="toggleAll(($event.target as HTMLInputElement).checked)"
        />选择当前页<span>{{ rows.length }} 项</span></label
      >
      <div v-if="loading" class="mobile-loading">
        <BaseSkeleton v-for="n in 6" :key="n" height="44px" />
      </div>
      <BaseEmptyState v-else-if="!rows.length" :title="emptyText || '暂无数据'"
        ><slot name="empty"
      /></BaseEmptyState>
      <article
        v-for="row in rows"
        v-else
        :key="row.id"
        class="mobile-row"
        :class="{ checked: checked.includes(row.id), current: row.id === currentId }"
      >
        <input
          type="checkbox"
          :aria-label="`选择 ${row.code || row.id}`"
          :checked="checked.includes(row.id)"
          :disabled="disabled"
          @change="toggle(row.id, ($event.target as HTMLInputElement).checked)"
        />
        <slot name="mobile-row" :row="row"
          ><button type="button" @click="emit('open', row)">{{ row.code || row.id }}</button></slot
        >
      </article>
    </div>
    <div v-else ref="scroller" class="scroller" @scroll.passive="rememberScroll">
      <table :style="{ width: tableWidth + 'px' }">
        <colgroup>
          <col
            v-for="column in table.getVisibleLeafColumns()"
            :key="column.id"
            :style="{ width: (widths.get(column.id) ?? 0) + 'px' }"
          />
        </colgroup>
        <thead>
          <tr v-for="group in table.getHeaderGroups()" :key="group.id">
            <th
              v-for="header in group.headers"
              :key="header.id"
              :class="[...pinClass(header.column.id), 'th-' + header.column.id]"
              :style="pinStyle(header.column.id)"
              scope="col"
            >
              <input
                v-if="header.column.id === '_selection'"
                type="checkbox"
                aria-label="选择当前页全部"
                :checked="allChecked"
                :indeterminate="someChecked"
                :disabled="disabled || !rows.length"
                @change="toggleAll(($event.target as HTMLInputElement).checked)"
              />
              <button
                v-else-if="sortable(header.column.id)"
                type="button"
                class="sort"
                :class="{ sorted: sortField === header.column.id && sortOrder }"
                :disabled="disabled"
                :aria-label="`按${label(header.column.id)}排序`"
                :aria-sort="
                  sortField === header.column.id && sortOrder
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                "
                @click="sort(header.column.id)"
              >
                {{ label(header.column.id)
                }}<ArrowUp
                  v-if="sortField === header.column.id && sortOrder === 'asc'"
                  class="sort-icon"
                /><ArrowDown
                  v-else-if="sortField === header.column.id && sortOrder === 'desc'"
                  class="sort-icon"
                /><ChevronsUpDown v-else class="sort-icon idle" />
              </button>
              <span v-else class="plain">{{ label(header.column.id) }}</span>
              <span
                v-if="header.column.getCanResize()"
                class="resizer"
                :class="{ active: header.column.getIsResizing() }"
                role="separator"
                aria-orientation="vertical"
                :aria-label="`调整${label(header.column.id)}列宽`"
                @mousedown="resize(header, $event)"
                @touchstart="resize(header, $event)"
                @click.stop
              ></span>
            </th>
          </tr>
        </thead>
        <tbody v-if="loading">
          <tr v-for="n in 8" :key="n" class="skeleton-row">
            <td v-for="column in table.getVisibleLeafColumns()" :key="column.id">
              <BaseSkeleton v-if="column.id !== '_selection'" width="70%" />
            </td>
          </tr>
        </tbody>
        <tbody v-else-if="rows.length">
          <tr
            v-for="row in table.getRowModel().rows"
            :key="row.id"
            :class="{
              current: row.original.id === currentId,
              checked: checked.includes(row.original.id),
              clickable: !disabled,
            }"
            :aria-selected="row.original.id === currentId || undefined"
            @click="rowClick(row.original, $event)"
          >
            <td
              v-for="cell in row.getVisibleCells()"
              :key="cell.id"
              :class="[...pinClass(cell.column.id), 'td-' + cell.column.id]"
              :style="pinStyle(cell.column.id)"
            >
              <input
                v-if="cell.column.id === '_selection'"
                type="checkbox"
                :aria-label="`选择 ${row.original.code || row.original.id}`"
                :checked="checked.includes(row.original.id)"
                :disabled="disabled"
                @change="toggle(row.original.id, ($event.target as HTMLInputElement).checked)"
              />
              <slot v-else name="cell" :row="row.original" :column="byKey.get(cell.column.id)!">{{
                row.original[cell.column.id as keyof T]
              }}</slot>
            </td>
          </tr>
        </tbody>
      </table>
      <BaseEmptyState v-if="!loading && !rows.length" :title="emptyText || '暂无数据'"
        ><slot name="empty"
      /></BaseEmptyState>
    </div>
    <BaseDialog
      v-model:open="settingsOpen"
      title="显示的列"
      description="勾选要显示的列，用箭头调整顺序；列宽可在表头拖动。"
    >
      <ul class="columns">
        <li v-for="(column, index) in configuration" :key="column.key">
          <label
            ><input
              v-model="column.visible"
              type="checkbox"
              :disabled="column.required"
              :aria-label="`显示${column.label}`"
            />{{ column.label }}<small v-if="column.required">固定</small
            ><small v-else-if="column.hideBelow && availableWidth < column.hideBelow"
              >窄屏收起</small
            ></label
          >
          <span class="moves">
            <BaseIconButton
              size="sm"
              :label="`上移${column.label}`"
              :tooltip="false"
              :disabled="!!column.fixed || index === 0 || !!configuration[index - 1]?.fixed"
              @click="move(index, -1)"
              ><ArrowUp
            /></BaseIconButton>
            <BaseIconButton
              size="sm"
              :label="`下移${column.label}`"
              :tooltip="false"
              :disabled="
                !!column.fixed ||
                index === configuration.length - 1 ||
                !!configuration[index + 1]?.fixed
              "
              @click="move(index, 1)"
              ><ArrowDown
            /></BaseIconButton>
          </span>
        </li>
      </ul>
      <template #footer>
        <BaseButton variant="ghost" @click="reset">恢复默认</BaseButton>
        <BaseButton variant="primary" @click="settingsOpen = false">完成</BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.workbench-table {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
}
.scroller {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}
table {
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: var(--font-14);
}
th {
  position: sticky;
  top: 0;
  z-index: 2;
  height: var(--control-table-head);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
  text-align: left;
  white-space: nowrap;
}
th.pinned {
  z-index: 3;
}
td {
  height: var(--control-table-row);
  padding: 0 var(--space-3);
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background-color var(--motion-fast);
}
td.pinned {
  z-index: 1;
}
.pin-edge-left {
  box-shadow: inset -1px 0 0 var(--border);
}
.pin-edge-right {
  box-shadow: inset 1px 0 0 var(--border);
}
.th-_selection,
.td-_selection {
  padding: 0 var(--space-3) 0 var(--space-4);
}
tbody tr.clickable {
  cursor: pointer;
}
tbody tr:hover td {
  background: var(--hover);
}
tbody tr.checked td {
  background: var(--blue-bg-2);
}
tbody tr.current td {
  background: var(--selected);
}
input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin: 0;
  vertical-align: middle;
  accent-color: var(--primary);
  cursor: pointer;
}
.sort,
.plain {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-overflow: ellipsis;
}
.sort {
  cursor: pointer;
}
.sort:hover,
.sorted {
  color: var(--text);
}
.sort:focus-visible {
  outline: none;
  border-radius: var(--radius-4);
  box-shadow: 0 0 0 2px var(--focus);
}
.sort-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.sort-icon.idle {
  opacity: 0;
  transition: opacity var(--motion-fast);
}
.sort:hover .idle,
.sort:focus-visible .idle {
  opacity: 0.7;
}
.resizer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 7px;
  cursor: col-resize;
  touch-action: none;
}
.resizer::after {
  content: '';
  position: absolute;
  top: 25%;
  bottom: 25%;
  right: 3px;
  width: 1px;
  background: transparent;
  transition: background-color var(--motion-fast);
}
th:hover .resizer::after {
  background: var(--border-strong);
}
.resizer.active::after,
.resizer:hover::after {
  top: 0;
  bottom: 0;
  background: var(--focus);
}
.th-actions .plain {
  visibility: hidden;
}
.skeleton-row td {
  cursor: default;
}
.mobile-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.mobile-all {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-table-head);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.mobile-all span {
  margin-left: auto;
}
.mobile-loading {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
}
.mobile-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}
.mobile-row input {
  margin-top: var(--space-1);
}
.mobile-row.checked {
  background: var(--blue-bg-2);
}
.mobile-row.current {
  background: var(--selected);
}
.columns {
  display: grid;
  gap: var(--space-0-5);
  max-height: 50vh;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.columns li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--control-nav-item);
  padding: 0 var(--space-1) 0 var(--space-2);
  border-radius: var(--radius-6);
}
.columns li:hover {
  background: var(--hover);
}
.columns label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-14);
}
.columns small {
  color: var(--text-subtle);
  font-size: var(--font-12);
}
.moves {
  display: inline-flex;
  gap: var(--space-0-5);
}
</style>
