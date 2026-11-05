<script setup lang="ts" generic="T extends { id: string; code?: string }">
import { computed, ref } from 'vue';
import { ArrowDown, ArrowUp, Columns3, EyeOff, Plus, RefreshCw, Search, X } from '@lucide/vue';
import BaseButton from '../base/BaseButton.vue';
import BaseIconButton from '../base/BaseIconButton.vue';
import BaseInput from '../base/BaseInput.vue';
import BaseResizeHandle from '../base/BaseResizeHandle.vue';
import BaseTabs from '../base/BaseTabs.vue';
import { useShortcut } from '../../services/shortcuts';
import WorkbenchTable from '../workbench-table/WorkbenchTable.vue';
import AdaptFilters from './AdaptFilters.vue';
import FilterField from './FilterField.vue';
import FilterPanel from './FilterPanel.vue';
import ViewMenu from './ViewMenu.vue';
import type { ListReportApi } from './useListReport';
import './list-report.css';

// A list report page body (docs/modules/list-report.md, DESIGN.md 6.1): views and scope tabs,
// the filter bar, the table with its column menus, paging, and a detail panel beside the list.
const props = defineProps<{
  report: ListReportApi<T>;
  scopeLabel: string;
  searchPlaceholder: string;
  checked: string[];
  currentId?: string;
  /** The detail panel is open: the list narrows to `compactKeys`. */
  split?: boolean;
  compactKeys?: string[];
  loading?: boolean;
  /** First load: the table shows skeletons. */
  skeleton?: boolean;
  disabled?: boolean;
  emptyText?: string;
  viewKey?: string;
  widthKey: string;
}>();
const emit = defineEmits<{
  'update:checked': [ids: string[]];
  open: [row: T];
  refresh: [];
}>();
const table = ref<{
  openColumns: () => void;
  hideColumn: (key: string) => void;
}>();
const adapt = ref(false);
const fieldsOnBar = computed(() =>
  props.report.filterFields.value.flatMap((key) => props.report.fieldOf(key) ?? []),
);
const hasFilters = computed(() => props.report.activeFilters.value.length > 0);
// While the bar is open it shows its own conditions; the chips carry the rest.
const chips = computed(() =>
  props.report.activeFilters.value.filter((f) => !props.report.barOpen.value || f.key === '_extra'),
);
const filteredKeys = computed(() => Object.keys(props.report.conditions.value));

const listWidth = ref(
  (() => {
    try {
      return Number(localStorage.getItem(props.widthKey)) || 400;
    } catch {
      return 400;
    }
  })(),
);
function saveListWidth(width: number) {
  try {
    localStorage.setItem(props.widthKey, String(width));
  } catch {
    // Storage may be refused; the width then lasts for this page only.
  }
}
function setSort(field: string, order: 'asc' | 'desc' | null) {
  props.report.sortField.value = order ? field : '';
  props.report.sortOrder.value = order;
}
useShortcut('F', () => (props.report.barOpen.value = !props.report.barOpen.value));
useShortcut('V', () => table.value?.openColumns());
</script>

<template>
  <div class="list-report" :class="{ split }">
    <div class="lr-toolbar">
      <ViewMenu :report="report" />
      <span class="lr-separator" aria-hidden="true"></span>
      <BaseTabs v-model="report.scope.value" :label="scopeLabel" :tabs="report.scopeTabs.value" />
      <span class="lr-toolbar-end">
        <span v-if="loading && !skeleton" class="lr-status" role="status">更新中…</span>
        <span class="lr-status">{{ report.filtered.value.length }} 项</span>
        <BaseButton
          variant="ghost"
          size="sm"
          kbd="F"
          :aria-expanded="report.barOpen.value"
          @click="report.barOpen.value = !report.barOpen.value"
          >{{ report.barOpen.value ? '隐藏筛选栏' : '显示筛选栏'
          }}<span v-if="report.conditionCount.value" class="lr-count">{{
            report.conditionCount.value
          }}</span></BaseButton
        >
        <BaseButton variant="ghost" size="sm" kbd="V" @click="table?.openColumns()"
          ><template #icon><Columns3 /></template>显示</BaseButton
        >
        <BaseIconButton label="刷新" size="sm" :disabled="loading" @click="emit('refresh')"
          ><RefreshCw
        /></BaseIconButton>
      </span>
    </div>

    <section v-if="report.barOpen.value" class="lr-bar" aria-label="筛选栏">
      <div class="lr-field" :class="{ set: report.search.value }">
        <span class="lr-field-label">搜索</span>
        <BaseInput v-model="report.search.value" :placeholder="searchPlaceholder" label="搜索">
          <template #icon><Search /></template>
        </BaseInput>
      </div>
      <FilterField v-for="field in fieldsOnBar" :key="field.key" :report="report" :field="field" />
      <div class="lr-bar-actions">
        <BaseButton v-if="report.pending.value" variant="primary" size="sm" @click="report.apply"
          >应用</BaseButton
        >
        <BaseButton variant="ghost" size="sm" :disabled="!hasFilters" @click="report.clearAll"
          >清除</BaseButton
        >
        <BaseButton size="sm" @click="adapt = true"
          >适配筛选
          <span class="lr-ratio"
            >{{ report.filterFields.value.length }} / {{ report.fields.value.length }}</span
          ></BaseButton
        >
      </div>
    </section>

    <div v-if="chips.length" class="filter-chips" aria-label="已生效的筛选">
      <button
        v-for="f in chips"
        :key="f.key"
        type="button"
        :aria-label="'移除筛选 ' + f.label"
        @click="f.clear"
      >
        {{ f.label }}<X />
      </button>
      <button type="button" class="clear-all" @click="report.clearAll">清除全部</button>
    </div>

    <section class="list-area" :style="{ '--list-width': listWidth + 'px' }">
      <div class="list-column">
        <BaseResizeHandle
          v-if="split"
          v-model="listWidth"
          label="调整清单宽度"
          :min="380"
          :max="760"
          @done="saveListWidth"
        />
        <WorkbenchTable
          ref="table"
          :checked="checked"
          :rows="report.pageRows.value"
          :columns="report.columns.value"
          :layout="report.layout.value"
          :sort-field="report.sortField.value"
          :sort-order="report.sortOrder.value"
          :filtered-keys="filteredKeys"
          :current-id="currentId"
          :compact="split"
          :compact-keys="compactKeys"
          :loading="skeleton"
          :view-key="viewKey"
          :disabled="disabled"
          :empty-text="report.pending.value ? '视图的条件已载入，点“应用”查看结果' : emptyText"
          @update:checked="emit('update:checked', $event)"
          @update:layout="report.setLayout"
          @open="emit('open', $event)"
          @sort="setSort"
          @columns-change="report.shownKeys.value = $event"
        >
          <template #mobile-row="{ row }"><slot name="mobile-row" :row="row" /></template>
          <template #cell="{ row, column }"
            ><slot name="cell" :row="row" :column="column"
          /></template>
          <template #column-menu="{ column, close }">
            <div class="lr-column-menu">
              <button
                type="button"
                class="lr-view-item"
                :class="{
                  on: report.sortField.value === column.key && report.sortOrder.value === 'asc',
                }"
                @click="(setSort(column.key, 'asc'), close())"
              >
                <ArrowUp /><span>升序排列</span>
              </button>
              <button
                type="button"
                class="lr-view-item"
                :class="{
                  on: report.sortField.value === column.key && report.sortOrder.value === 'desc',
                }"
                @click="(setSort(column.key, 'desc'), close())"
              >
                <ArrowDown /><span>降序排列</span>
              </button>
              <template v-if="report.fieldOf(column.key)">
                <hr />
                <FilterPanel :report="report" :field="report.fieldOf(column.key)!" />
                <hr />
                <button
                  v-if="!report.filterFields.value.includes(column.key)"
                  type="button"
                  class="lr-view-item"
                  @click="(report.addField(column.key), (report.barOpen.value = true), close())"
                >
                  <Plus /><span>加入筛选栏</span>
                </button>
              </template>
              <button
                v-if="!column.required"
                type="button"
                class="lr-view-item"
                @click="(table?.hideColumn(column.key), close())"
              >
                <EyeOff /><span>隐藏此列</span>
              </button>
            </div>
          </template>
          <template #empty>
            <BaseButton
              v-if="report.pending.value"
              variant="primary"
              size="sm"
              @click="report.apply"
              >应用</BaseButton
            >
            <slot v-else name="empty" :has-filters="hasFilters" />
          </template>
        </WorkbenchTable>
        <footer class="list-footer">
          <span
            >{{
              report.filtered.value.length
                ? (report.page.value - 1) * report.pageSize.value + 1
                : 0
            }}–{{
              Math.min(report.page.value * report.pageSize.value, report.filtered.value.length)
            }}
            / 共 {{ report.filtered.value.length }} 项</span
          >
          <label
            >每页<select v-model.number="report.pageSize.value" aria-label="每页数量">
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select></label
          >
          <span class="pager">
            <BaseButton
              variant="ghost"
              size="sm"
              :disabled="report.page.value <= 1"
              @click="report.page.value--"
              >上一页</BaseButton
            ><span>{{ report.page.value }} / {{ report.pages.value }}</span
            ><BaseButton
              variant="ghost"
              size="sm"
              :disabled="report.page.value >= report.pages.value"
              @click="report.page.value++"
              >下一页</BaseButton
            >
          </span>
        </footer>
      </div>
      <slot name="detail" />
    </section>
    <AdaptFilters v-model:open="adapt" :report="report" />
  </div>
</template>
