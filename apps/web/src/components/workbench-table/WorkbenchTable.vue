<script setup lang="ts" generic="T extends { id: string; code?: string }">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { VxeTable, VxeColumn, type VxeTableInstance } from 'vxe-table';
import 'vxe-table/lib/style.css';
import './workbench-table.css';
import type { WorkbenchColumn } from './types';
import { layoutColumns } from './layout';

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
const grid = ref<VxeTableInstance>();
const root = ref<HTMLElement>();
const mobileList = ref<HTMLElement>();
const availableWidth = ref(0);
let resizeFrame = 0;
useResizeObserver(root, (entries) => {
  const width = entries[0]?.contentRect.width || 0;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    availableWidth.value = width;
  });
});
onBeforeUnmount(() => cancelAnimationFrame(resizeFrame));
const mobile = computed(() => availableWidth.value > 0 && availableWidth.value < 600);
const dialog = ref<HTMLDialogElement>();
const configuration = ref<WorkbenchColumn[]>([]);
watch(
  [() => props.storageKey, () => props.columns.map((c) => c.key + ':' + c.label).join('|')],
  () => {
    let saved: WorkbenchColumn[] = [];
    try {
      const value = JSON.parse(localStorage.getItem(props.storageKey) || '[]');
      if (Array.isArray(value)) saved = value.filter((c) => c && typeof c.key === 'string');
    } catch {
      /* storage is optional */
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
const visible = computed(() =>
  layoutColumns(
    configuration.value.filter(
      (c) =>
        c.visible !== false &&
        (!c.hideBelow || !availableWidth.value || availableWidth.value >= c.hideBelow) &&
        (!props.compact || !props.compactKeys || props.compactKeys.includes(c.key)),
    ),
    Math.max(0, availableWidth.value - 16),
  ),
);
watch(
  configuration,
  () => {
    try {
      localStorage.setItem(props.storageKey, JSON.stringify(configuration.value));
    } catch {
      /* storage is optional */
    }
    emit(
      'columns-change',
      configuration.value.filter((c) => c.visible !== false).map((c) => c.key),
    );
  },
  { deep: true, immediate: true },
);
const allChecked = computed(
  () => props.rows.length > 0 && props.rows.every((r) => props.checked.includes(r.id)),
);
const someChecked = computed(
  () => props.rows.some((r) => props.checked.includes(r.id)) && !allChecked.value,
);
function toggle(id: string, checked: boolean) {
  emit(
    'update:checked',
    checked ? [...new Set([...props.checked, id])] : props.checked.filter((v) => v !== id),
  );
}
function toggleAll(checked: boolean) {
  emit('update:checked', checked ? props.rows.map((r) => r.id) : []);
}
function sort(column: WorkbenchColumn) {
  const order =
    props.sortField !== column.key || !props.sortOrder
      ? 'asc'
      : props.sortOrder === 'asc'
        ? 'desc'
        : null;
  emit('sort', column.key, order);
}
function move(index: number, direction: number) {
  const columns = [...configuration.value];
  const other = index + direction;
  if (other < 0 || other >= columns.length || columns[index].fixed || columns[other].fixed) return;
  [columns[index], columns[other]] = [columns[other], columns[index]];
  configuration.value = columns;
}
function reset() {
  configuration.value = props.columns.map((c) => ({ ...c, visible: c.visible !== false }));
}
function resized({ column }: { column: { field: string; renderWidth: number } }) {
  const setting = configuration.value.find((c) => c.key === column.field);
  if (setting && column.renderWidth) setting.width = column.renderWidth;
}
let restoringScroll = false;
const scrollKey = () => 'delivery-scroll:' + props.viewKey + (mobile.value ? ':mobile' : ':table');
function rememberScroll({ scrollLeft, scrollTop }: { scrollLeft: number; scrollTop: number }) {
  if (!props.viewKey || restoringScroll || props.loading || !props.rows.length) return;
  try {
    sessionStorage.setItem(scrollKey(), JSON.stringify({ scrollLeft, scrollTop }));
  } catch {}
}
watch(
  [() => props.rows, () => props.viewKey, mobile],
  async (_value, _previous, onCleanup) => {
    if (!props.rows.length || !props.viewKey) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    restoringScroll = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(scrollKey()) || '{}');
      await nextTick();
      if (cancelled) return;
      if (mobile.value) {
        mobileList.value?.scrollTo(Number(saved.scrollLeft) || 0, Number(saved.scrollTop) || 0);
        return;
      }
      // VXE's data watcher lays out asynchronously and can reset scroll after Vue's nextTick.
      await grid.value?.loadData(props.rows);
      await grid.value?.recalculate(true);
      if (cancelled) return;
      await grid.value?.scrollTo(Number(saved.scrollLeft) || 0, Number(saved.scrollTop) || 0);
    } catch {
    } finally {
      if (!cancelled) restoringScroll = false;
    }
  },
  { flush: 'post' },
);
function cellClick({ row, column, $event }: { row: T; column: { field: string }; $event: Event }) {
  if (props.disabled || column.field === '_selection' || column.field === 'actions') return;
  if (($event.target as HTMLElement).closest('a,button,input,select,textarea,.field-display'))
    return;
  emit('open', row);
}
watch(
  () => props.compact,
  async () => {
    await nextTick();
    await grid.value?.recalculate(true);
  },
);
defineExpose({ openColumns: () => dialog.value?.showModal() });
</script>

<template>
  <div ref="root" class="workbench-table" :aria-busy="loading">
    <div
      v-if="mobile"
      ref="mobileList"
      class="workbench-mobile"
      @scroll="rememberScroll($event.target as HTMLElement)"
    >
      <label class="mobile-select-all"
        ><input
          type="checkbox"
          aria-label="选择当前页全部"
          :checked="allChecked"
          :indeterminate="someChecked"
          :disabled="disabled || !rows.length"
          @change="toggleAll(($event.target as HTMLInputElement).checked)"
        />选择当前页<span>{{ rows.length }} 项</span></label
      >
      <div v-if="loading || !rows.length" class="workbench-empty">
        <strong>{{ loading ? '正在加载清单…' : emptyText || '暂无数据' }}</strong
        ><slot name="empty" />
      </div>
      <article
        v-for="row in rows"
        v-else
        :key="row.id"
        class="mobile-table-row"
        :class="{ 'is-checked': checked.includes(row.id) }"
      >
        <input
          type="checkbox"
          :aria-label="`选择 ${row.code || row.id}`"
          :checked="checked.includes(row.id)"
          :disabled="disabled"
          @change="toggle(row.id, ($event.target as HTMLInputElement).checked)"
        />
        <slot name="mobile-row" :row="row"
          ><button @click="emit('open', row)">{{ row.code || row.id }}</button></slot
        >
      </article>
    </div>
    <VxeTable
      v-else
      ref="grid"
      :data="rows"
      height="100%"
      auto-resize
      border="none"
      size="small"
      :loading="loading"
      :row-config="{ keyField: 'id', isHover: true }"
      :column-config="{ resizable: true }"
      :sort-config="{ remote: true, trigger: 'cell' }"
      :row-class-name="
        ({ row }: { row: T }) =>
          row.id === currentId ? 'is-current' : checked.includes(row.id) ? 'is-checked' : ''
      "
      :virtual-y-config="{ enabled: false }"
      :virtual-x-config="{ enabled: false }"
      @cell-click="cellClick"
      @resizable-change="resized"
      @scroll="rememberScroll"
      @sort-change="
        ({ field, order }: { field: string; order: 'asc' | 'desc' | '' | null }) =>
          emit('sort', field, order || null)
      "
    >
      <VxeColumn field="_selection" width="44" fixed="left" :resizable="false">
        <template #header
          ><input
            type="checkbox"
            aria-label="选择当前页全部"
            :checked="allChecked"
            :indeterminate="someChecked"
            :disabled="disabled || !rows.length"
            @change="toggleAll(($event.target as HTMLInputElement).checked)"
        /></template>
        <template #default="{ row }"
          ><input
            type="checkbox"
            :aria-label="`选择 ${row.code || row.id}`"
            :checked="checked.includes(row.id)"
            :disabled="disabled"
            @click.stop
            @change="toggle(row.id, ($event.target as HTMLInputElement).checked)"
        /></template>
      </VxeColumn>
      <VxeColumn
        v-for="column in visible"
        :key="column.key"
        :field="column.key"
        :title="column.label"
        :width="column.width"
        :min-width="column.minWidth || 80"
        :fixed="compact ? undefined : column.fixed"
        :sortable="false"
        :class-name="'column-' + column.key"
        :header-class-name="column.group ? 'header-group-' + column.group : undefined"
      >
        <template #header
          ><button
            v-if="column.sortable !== false"
            class="column-sort"
            :disabled="disabled"
            :aria-label="`按${column.label}排序`"
            :title="
              sortField === column.key && sortOrder
                ? sortOrder === 'asc'
                  ? '当前升序，点击降序'
                  : '当前降序，点击取消排序'
                : '点击升序排列'
            "
            @click.stop="sort(column)"
          >
            {{ column.label
            }}<span
              :class="{ 'sort-inactive': sortField !== column.key || !sortOrder }"
              aria-hidden="true"
              >{{
                sortField === column.key && sortOrder ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'
              }}</span
            ></button
          ><span v-else>{{ column.label }}</span></template
        >
        <template #default="{ row }"
          ><slot name="cell" :row="row" :column="column">{{
            row[column.key as keyof T]
          }}</slot></template
        >
      </VxeColumn>
      <template #empty
        ><div class="workbench-empty">
          <strong>{{ loading ? '正在加载清单…' : emptyText || '暂无数据' }}</strong
          ><slot name="empty" /></div
      ></template>
      <template #loading
        ><div class="workbench-loading" role="status">
          <span class="loading-line"></span>正在加载清单…
        </div></template
      >
    </VxeTable>
    <dialog
      ref="dialog"
      class="column-dialog"
      aria-label="列设置"
      @click="$event.target === dialog && dialog?.close()"
    >
      <header>
        <div>
          <h2>列设置</h2>
          <p>选择显示字段，调整顺序；列宽可在表头拖动。</p>
        </div>
        <button aria-label="关闭列设置" @click="dialog?.close()">×</button>
      </header>
      <div class="column-options">
        <div v-for="(column, index) in configuration" :key="column.key" class="column-option">
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
          <span
            ><button
              :disabled="!!column.fixed || index === 0 || !!configuration[index - 1]?.fixed"
              :aria-label="`上移${column.label}`"
              @click="move(index, -1)"
            >
              ↑</button
            ><button
              :disabled="
                !!column.fixed ||
                index === configuration.length - 1 ||
                !!configuration[index + 1]?.fixed
              "
              :aria-label="`下移${column.label}`"
              @click="move(index, 1)"
            >
              ↓
            </button></span
          >
        </div>
      </div>
      <footer>
        <button @click="reset">恢复默认</button
        ><button class="primary-button" @click="dialog?.close()">完成</button>
      </footer>
    </dialog>
  </div>
</template>
