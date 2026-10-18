<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, onBeforeRouteLeave } from 'vue-router';
import {
  Plus,
  Trash2,
  RefreshCw,
  Columns3,
  SlidersHorizontal,
  X,
  Search,
  Copy,
  PenSquare,
  FileDown,
  FileUp,
  FileSpreadsheet,
  Settings2,
  MoreHorizontal,
  Sparkles,
  Code2,
  ClipboardCheck,
  UserCheck,
  ListChecks,
} from '@lucide/vue';
import BaseActionBar from '../../components/base/BaseActionBar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseIconButton from '../../components/base/BaseIconButton.vue';
import BaseInput from '../../components/base/BaseInput.vue';
import BaseMenu from '../../components/base/BaseMenu.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import BaseResizeHandle from '../../components/base/BaseResizeHandle.vue';
import { moduleHue } from '../../components/base/identity';
import BaseMenuItem from '../../components/base/BaseMenuItem.vue';
import BaseMenuSeparator from '../../components/base/BaseMenuSeparator.vue';
import BasePopover from '../../components/base/BasePopover.vue';
import BaseTabs from '../../components/base/BaseTabs.vue';
import { toast as notify } from '../../components/base/toast';
import { useShortcut } from '../../services/shortcuts';
import WorkbenchTable from '../../components/workbench-table/WorkbenchTable.vue';
import { api, ApiError, identity } from '../../services/session';
import { currentProject, projects, leaveDelivery } from '../../services/projectContext';
import { askConfirmation } from '../../services/confirmation';
import {
  OPTIONS,
  PHASES,
  catalog,
  overdue,
  richText,
  sortValue,
  type CustomFieldDefinition,
  type Item,
  type ListContext,
  type Member,
  type Tag,
} from './model';
import { tableColumns } from './tableColumns';
import InlineCell from './InlineCell.vue';
import ItemDrawer from './ItemDrawer.vue';
import BatchEditDialog from './BatchEditDialog.vue';
import ImportDialog from './ImportDialog.vue';
import ListSettings from './ListSettings.vue';
import './delivery.css';

const items = ref<Item[]>([]),
  members = ref<Member[]>([]),
  tags = ref<Tag[]>([]),
  customFields = ref<CustomFieldDefinition[]>([]);
const readOnly = ref(true),
  isAdmin = ref(false),
  loading = ref(false),
  loaded = ref(false),
  busy = ref(false);
const error = ref('');
const checked = ref<string[]>([]);
const table = ref<{ openColumns: () => void }>();
const drawer = ref<InstanceType<typeof ItemDrawer> | null>(null);
const drawerId = ref<string | null>(null); // '' = creating
// The list beside an open item keeps the width the person dragged it to (DESIGN.md 4.1).
const listWidth = ref(
  (() => {
    try {
      return Number(localStorage.getItem('delivery-list-width')) || 400;
    } catch {
      return 400;
    }
  })(),
);
function saveListWidth(width: number) {
  try {
    localStorage.setItem('delivery-list-width', String(width));
  } catch {
    // Storage may be refused; the width then lasts for this page only.
  }
}
const dialog = ref<'' | 'batch' | 'import' | 'settings'>('');
const batchError = ref('');
const menu = ref('');
const columnKeys = ref<string[]>([]);

const fields = computed(() => catalog(customFields.value));
const ctx = computed<ListContext>(() => ({ members: members.value, tags: tags.value }));
const columns = computed(() => tableColumns(fields.value));
const base = computed(() => '/projects/' + currentProject.value + '/development-items');
const drawerItem = computed(() => items.value.find((i) => i.id === drawerId.value) ?? null);
const projectName = computed(
  () => projects.value.find((p) => p.id === currentProject.value)?.name || '请在左上角选择项目',
);
const columnStorageKey = computed(
  () =>
    `delivery-columns:v2:${identity.value?.organization.id}:${identity.value?.user.id}:${currentProject.value}`,
);

// --- filters -----------------------------------------------------------------------------
const search = ref(''),
  scope = ref('all'),
  moduleFilter = ref(''),
  kindFilter = ref(''),
  tagFilter = ref(''),
  phaseFilter = ref(''),
  statusFilter = ref(''),
  priorityFilter = ref(''),
  difficultyFilter = ref(''),
  personFilter = ref('');
const sortField = ref(''),
  sortOrder = ref<'asc' | 'desc' | null>(null);
const page = ref(1),
  pageSize = ref(50);
const filterState = {
  search,
  scope,
  moduleFilter,
  kindFilter,
  tagFilter,
  phaseFilter,
  statusFilter,
  priorityFilter,
  difficultyFilter,
  personFilter,
  sortField,
  sortOrder,
  pageSize,
};
const filterKey = () =>
  `delivery-filters:v2:${identity.value?.organization.id}:${identity.value?.user.id}:${currentProject.value}`;
let restoring = false;
watch(
  Object.values(filterState),
  () => {
    if (restoring) return;
    page.value = 1;
    if (checked.value.length) checked.value = [];
    try {
      sessionStorage.setItem(
        filterKey(),
        JSON.stringify(
          Object.fromEntries(Object.entries(filterState).map(([k, r]) => [k, r.value])),
        ),
      );
    } catch {
      /* optional */
    }
  },
  { flush: 'sync' },
);
function restoreFilters() {
  restoring = true;
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(filterKey()) || '{}');
  } catch {
    /* optional */
  }
  for (const [key, state] of Object.entries(filterState)) {
    const value = saved[key];
    (state as { value: unknown }).value =
      key === 'pageSize'
        ? [20, 50, 100].includes(value as number)
          ? value
          : 50
        : key === 'sortOrder'
          ? ['asc', 'desc'].includes(value as string)
            ? value
            : null
          : typeof value === 'string'
            ? value
            : key === 'scope'
              ? 'all'
              : '';
  }
  page.value = 1;
  restoring = false;
}
function clearFilters() {
  restoring = true;
  for (const key of Object.keys(filterState))
    if (!['sortField', 'sortOrder', 'pageSize', 'scope'].includes(key))
      (filterState[key as keyof typeof filterState] as { value: unknown }).value = '';
  restoring = false;
  page.value = 1;
}
const me = computed(() => identity.value?.user.id);
const scopes = computed(() => {
  const defs = [
    { id: 'all', name: '全部', test: () => true },
    { id: 'fsd', name: '我的 FSD', test: (i: Item) => i.phases.fsd.assigneeId === me.value },
    {
      id: 'development',
      name: '我的开发',
      test: (i: Item) => i.phases.development.assigneeId === me.value,
    },
    {
      id: 'test',
      name: '我的测试',
      test: (i: Item) =>
        i.phases.consultant_test.assigneeId === me.value ||
        i.phases.user_test.assigneeId === me.value,
    },
    {
      id: 'overdue',
      name: '计划逾期',
      test: (i: Item) => PHASES.some((p) => overdue(i.phases[p.key])),
    },
  ];
  return defs.map((d) => ({ ...d, count: matching.value.filter(d.test).length }));
});
const matching = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter(
    (i) =>
      (!q ||
        [i.code, i.name, i.module, i.transactionCode, ...i.objects.map((o) => o.objectName)]
          .join(' ')
          .toLowerCase()
          .includes(q)) &&
      (!moduleFilter.value || i.module === moduleFilter.value) &&
      (!kindFilter.value || i.kind === kindFilter.value) &&
      (!tagFilter.value || i.tags.includes(tagFilter.value)) &&
      (!statusFilter.value ||
        (phaseFilter.value ? [phaseFilter.value] : PHASES.map((p) => p.key)).some(
          (p) => i.phases[p as keyof Item['phases']].status === statusFilter.value,
        )) &&
      (!priorityFilter.value || i.priority === priorityFilter.value) &&
      (!difficultyFilter.value || i.difficulty === difficultyFilter.value) &&
      (!personFilter.value ||
        PHASES.some((p) => i.phases[p.key].assigneeId === personFilter.value)),
  );
});
const filtered = computed(() => {
  const test = scopes.value.find((s) => s.id === scope.value)?.test ?? (() => true);
  const result = matching.value.filter(test);
  const field = fields.value.find((f) => f.key === sortField.value);
  if (!field || !sortOrder.value) return result;
  const dir = sortOrder.value === 'asc' ? 1 : -1;
  return [...result].sort((a, b) => {
    const x = sortValue(a, field, ctx.value),
      y = sortValue(b, field, ctx.value);
    return (
      (typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'zh-CN', { numeric: true })) * dir
    );
  });
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
watch(pages, (n) => (page.value = Math.min(page.value, n)));
const rows = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);
const activeFilters = computed(() => {
  const list: { key: string; label: string; clear: () => void }[] = [];
  const add = (key: string, label: string, state: { value: string }) =>
    state.value && list.push({ key, label, clear: () => (state.value = '') });
  add('search', '搜索：' + search.value, search);
  add('module', '模块：' + moduleFilter.value, moduleFilter);
  add('kind', '类型：' + (OPTIONS.kind[kindFilter.value] ?? ''), kindFilter);
  add('tag', '标签：' + (tags.value.find((t) => t.id === tagFilter.value)?.name ?? ''), tagFilter);
  if (statusFilter.value)
    list.push({
      key: 'status',
      label:
        (PHASES.find((p) => p.key === phaseFilter.value)?.label ?? '任一阶段') +
        '：' +
        OPTIONS.status[statusFilter.value],
      clear: () => {
        statusFilter.value = '';
        phaseFilter.value = '';
      },
    });
  add('priority', '优先级：' + (OPTIONS.priority[priorityFilter.value] ?? ''), priorityFilter);
  add(
    'difficulty',
    '难易度：' + (OPTIONS.difficulty[difficultyFilter.value] ?? ''),
    difficultyFilter,
  );
  add(
    'person',
    '负责人：' + (members.value.find((m) => m.id === personFilter.value)?.displayName ?? ''),
    personFilter,
  );
  return list;
});

// --- loading -----------------------------------------------------------------------------
let generation = 0;
async function load(reset = false) {
  const request = ++generation;
  error.value = '';
  if (reset) {
    items.value = [];
    loaded.value = false;
    drawerId.value = null;
    checked.value = [];
  }
  if (!currentProject.value) return;
  loading.value = true;
  try {
    const result = await api<{
      items: Item[];
      members: Member[];
      tags: Tag[];
      fields: CustomFieldDefinition[];
      readOnly: boolean;
      isAdmin: boolean;
    }>(base.value);
    if (request !== generation) return;
    items.value = result.items;
    members.value = result.members;
    tags.value = result.tags;
    customFields.value = result.fields;
    readOnly.value = result.readOnly;
    isAdmin.value = result.isAdmin;
    loaded.value = true;
    checked.value = checked.value.filter((id) => result.items.some((i) => i.id === id));
    if (drawerId.value && !result.items.some((i) => i.id === drawerId.value)) drawerId.value = null;
  } catch (e) {
    if (request !== generation) return;
    error.value = (e as Error).message;
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
      items.value = [];
      readOnly.value = true;
      loaded.value = false;
    }
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(
  [currentProject, () => identity.value?.user.id],
  () => {
    restoreFilters();
    void load(true);
  },
  { immediate: true, flush: 'sync' },
);
function replace(item: Item) {
  const index = items.value.findIndex((i) => i.id === item.id);
  if (index >= 0) items.value[index] = item;
  else items.value.unshift(item);
}
// Success messages float briefly instead of pushing the table down.
function say(message: string) {
  notify(message, 'green');
  error.value = '';
}

// --- guards ------------------------------------------------------------------------------
const dirty = computed(() => !!drawer.value?.dirty);
async function safeLeave() {
  if (busy.value || drawer.value?.busy) {
    error.value = '正在保存，请稍候。';
    return false;
  }
  if (dirty.value && !(await askConfirmation('抽屉中有未保存的修改，放弃修改并继续？')))
    return false;
  return true;
}
leaveDelivery.value = safeLeave;
onBeforeRouteLeave(() => safeLeave());
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => {
  generation++;
  window.removeEventListener('beforeunload', beforeUnload);
  if (leaveDelivery.value === safeLeave) leaveDelivery.value = null;
});

// --- drawer and single-item actions ------------------------------------------------------
async function open(id: string) {
  if (drawerId.value === id || !(await safeLeave())) return;
  menu.value = '';
  drawerId.value = id;
}
async function openCreate() {
  if (!(await safeLeave())) return;
  drawerId.value = '';
}
async function closeDrawer() {
  if (await safeLeave()) drawerId.value = null;
}
function saved(item: Item) {
  const created = drawerId.value === '';
  replace(item);
  drawerId.value = item.id;
  say(created ? `已创建开发项 ${item.code}` : `已保存 ${item.code}`);
  void refreshTags();
}
async function saveCell(item: Item, key: string, value: unknown) {
  const updated = await api<Item>(
    base.value + '/' + item.id,
    { rowVersion: item.rowVersion, changes: { [key]: value } },
    'PATCH',
  );
  replace(updated);
}
async function createTag(name: string) {
  const tag = await api<Tag>(`/projects/${currentProject.value}/development-tags`, { name });
  tags.value = [...tags.value, tag].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return tag;
}
async function refreshTags() {
  try {
    const list = await api<Tag[]>(`/projects/${currentProject.value}/development-tags`);
    if (Array.isArray(list)) tags.value = list;
  } catch {
    /* counts refresh is best effort */
  }
}
const describe = (i: Item) => `${i.code}《${i.name}》`;
async function removeOne(item: Item) {
  menu.value = '';
  if (
    !(await askConfirmation(
      `确定删除开发项 ${describe(item)} 吗？删除后列表中不再显示，变更历史保留。`,
    ))
  )
    return;
  busy.value = true;
  try {
    await api(base.value + '/' + item.id, { rowVersion: item.rowVersion }, 'DELETE');
    items.value = items.value.filter((i) => i.id !== item.id);
    checked.value = checked.value.filter((id) => id !== item.id);
    if (drawerId.value === item.id) drawerId.value = null;
    say(`已删除 ${describe(item)}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const comingSoon = (label: string) => notify(`“${label}”Agent 即将开发`);
// Development types the development agent can generate code for (reports and functions).
const DEV_AGENT_KINDS = ['report', 'function'];
// --- batch actions -----------------------------------------------------------------------
const selectedItems = computed(() => items.value.filter((i) => checked.value.includes(i.id)));
async function batch(action: string, extra: Record<string, unknown> = {}) {
  busy.value = true;
  error.value = '';
  try {
    const result = await api<{ count: number; ids: string[] }>(base.value + '/batch', {
      action,
      ids: checked.value,
      ...extra,
    });
    await load();
    return result;
  } finally {
    busy.value = false;
  }
}
async function batchDelete() {
  const list = selectedItems.value;
  const names =
    list.slice(0, 5).map(describe).join('、') + (list.length > 5 ? ` 等 ${list.length} 项` : '');
  if (
    !(await askConfirmation(
      `确定删除选中的 ${list.length} 个开发项吗？${names}。删除后列表中不再显示。`,
    ))
  )
    return;
  try {
    const r = await batch('delete');
    checked.value = [];
    say(`已删除 ${r.count} 项`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function batchCopy() {
  try {
    const r = await batch('copy');
    const codes = items.value.filter((i) => r.ids.includes(i.id)).map((i) => i.code);
    checked.value = [];
    say(`已复制 ${r.count} 项，新编号 ${codes.sort().join('、')}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function applyBatch(body: Record<string, unknown>) {
  batchError.value = '';
  try {
    const r = await batch('update', body);
    dialog.value = '';
    say(`已修改 ${r.count} 项`);
  } catch (e) {
    batchError.value = (e as Error).message;
  }
}

// --- Excel -------------------------------------------------------------------------------
async function exportExcel(ids: string[] | null, label: string) {
  menu.value = '';
  busy.value = true;
  error.value = '';
  try {
    const keys = columnKeys.value.filter((k) => k !== 'actions');
    const response = await fetch('/api' + base.value + '/export', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, keys }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.message ?? '导出失败，请稍后重试。',
      );
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `开发清单-${projects.value.find((p) => p.id === currentProject.value)?.code ?? ''}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    say(`已导出 ${label}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function downloadTemplate() {
  const link = document.createElement('a');
  link.href = '/api' + base.value + '/import-template';
  link.download = '';
  link.click();
}
async function imported(summary: string) {
  dialog.value = '';
  await load();
  say(summary);
}
// The list's keys (DESIGN.md 1.5): N new, F filters, V columns, J / K next and previous item while
// one is open, Esc closes it.
const filterOpen = ref(false);
const filterCount = computed(() => activeFilters.value.filter((f) => f.key !== 'search').length);
function step(direction: number) {
  if (!drawerId.value) return;
  const index = rows.value.findIndex((i) => i.id === drawerId.value);
  const next = rows.value[index + direction];
  if (next) void open(next.id);
}
useShortcut('N', () => !readOnly.value && loaded.value && void openCreate());
useShortcut('F', () => (filterOpen.value = true));
useShortcut('V', () => table.value?.openColumns());
useShortcut('J', () => step(1));
useShortcut('K', () => step(-1));
useShortcut('Escape', () => drawerId.value !== null && void closeDrawer());
// The second line of a row (DESIGN.md 2.2.1): the business function, as one line of text.
const summary = (item: Item) =>
  richText(item.businessFunction ?? '')
    .replace(/\s+/g, ' ')
    .trim();
</script>

<template>
  <div class="delivery-page" :class="{ split: drawerId !== null }">
    <header class="list-head">
      <ListChecks class="list-icon" />
      <h1>开发清单</h1>
      <span class="list-project">{{ projectName }}</span>
      <span class="head-actions">
        <BaseMenu align="end">
          <template #trigger>
            <BaseButton :disabled="!loaded || busy"
              ><template #icon><FileSpreadsheet /></template>导入 / 导出</BaseButton
            >
          </template>
          <BaseMenuItem tone="blue" :disabled="readOnly" @select="dialog = 'import'"
            ><template #icon><FileUp /></template>从 Excel 导入</BaseMenuItem
          >
          <BaseMenuItem tone="blue" @select="downloadTemplate"
            ><template #icon><FileDown /></template>下载导入模板</BaseMenuItem
          >
          <BaseMenuItem
            tone="green"
            :disabled="!filtered.length"
            :note="`${filtered.length} 项`"
            @select="
              exportExcel(
                filtered.map((i) => i.id),
                `筛选结果 ${filtered.length} 项`,
              )
            "
            ><template #icon><FileDown /></template>导出筛选结果</BaseMenuItem
          >
          <BaseMenuSeparator />
          <BaseMenuItem :disabled="!loaded" @select="dialog = 'settings'"
            ><template #icon><Settings2 /></template>清单设置</BaseMenuItem
          >
        </BaseMenu>
        <BaseButton
          variant="primary"
          kbd="N"
          data-keep-drawer
          :disabled="readOnly || !loaded"
          @click="openCreate"
          ><template #icon><Plus /></template>新建开发项</BaseButton
        >
      </span>
    </header>
    <p v-if="error" class="error-note" role="alert">
      {{ error }}<button class="text-button" @click="load()">重新加载</button>
    </p>
    <p v-if="readOnly && loaded" class="help-note">此项目已归档，只能查看。</p>

    <div class="list-bar">
      <BaseTabs
        v-model="scope"
        label="清单范围"
        :tabs="scopes.map((s) => ({ id: s.id, label: s.name, count: s.count }))"
      />
      <span class="bar-end">
        <span v-if="loading && loaded" class="refresh-status" role="status">更新中…</span>
        <BasePopover v-model:open="filterOpen" align="end">
          <template #trigger>
            <BaseButton variant="ghost" size="sm" kbd="F"
              ><template #icon><SlidersHorizontal /></template>筛选<span
                v-if="filterCount"
                class="filter-count"
                >{{ filterCount }}</span
              ></BaseButton
            >
          </template>
          <div class="filter-panel" aria-label="筛选条件">
            <label
              >模块<select v-model="moduleFilter">
                <option value="">全部</option>
                <option v-for="(label, key) in OPTIONS.module" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
            <label
              >类型<select v-model="kindFilter">
                <option value="">全部</option>
                <option v-for="(label, key) in OPTIONS.kind" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
            <label
              >阶段状态<span class="pair"
                ><select v-model="phaseFilter" aria-label="状态所属阶段">
                  <option value="">任一阶段</option>
                  <option v-for="p in PHASES" :key="p.key" :value="p.key">
                    {{ p.label }}
                  </option></select
                ><select v-model="statusFilter" aria-label="状态">
                  <option value="">全部状态</option>
                  <option v-for="(label, key) in OPTIONS.status" :key="key" :value="key">
                    {{ label }}
                  </option>
                </select></span
              ></label
            >
            <label
              >负责人<select v-model="personFilter">
                <option value="">全部</option>
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.displayName }}</option>
              </select></label
            >
            <label
              >标签<select v-model="tagFilter">
                <option value="">全部</option>
                <option v-for="t in tags" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select></label
            >
            <label
              >优先级<select v-model="priorityFilter">
                <option value="">全部</option>
                <option v-for="(label, key) in OPTIONS.priority" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
            <label
              >难易度<select v-model="difficultyFilter">
                <option value="">全部</option>
                <option v-for="(label, key) in OPTIONS.difficulty" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
            <footer>
              <BaseButton variant="ghost" size="sm" :disabled="!filterCount" @click="clearFilters"
                >清除全部</BaseButton
              ><BaseButton variant="primary" size="sm" @click="filterOpen = false">完成</BaseButton>
            </footer>
          </div>
        </BasePopover>
        <BaseButton variant="ghost" size="sm" kbd="V" @click="table?.openColumns()"
          ><template #icon><Columns3 /></template>显示</BaseButton
        >
        <BaseIconButton label="刷新" size="sm" :disabled="loading" @click="load()"
          ><RefreshCw
        /></BaseIconButton>
      </span>
    </div>
    <div class="list-search">
      <BaseInput
        v-model="search"
        placeholder="搜索编号、名称、事务码或开发对象"
        label="搜索开发清单"
        ><template #icon><Search /></template
      ></BaseInput>
    </div>
    <div v-if="activeFilters.length" class="filter-chips" aria-label="已生效的筛选">
      <button
        v-for="f in activeFilters"
        :key="f.key"
        type="button"
        :aria-label="'移除筛选 ' + f.label"
        @click="f.clear"
      >
        {{ f.label }}<X />
      </button>
      <button type="button" class="clear-all" @click="clearFilters">清除全部</button>
    </div>

    <section class="list-area" :style="{ '--list-width': listWidth + 'px' }">
      <div class="list-column">
        <BaseResizeHandle
          v-if="drawerId !== null"
          v-model="listWidth"
          label="调整清单宽度"
          :min="380"
          :max="760"
          @done="saveListWidth"
        />
        <WorkbenchTable
          ref="table"
          v-model:checked="checked"
          :rows="rows"
          :columns="columns"
          :storage-key="columnStorageKey"
          :sort-field="sortField"
          :sort-order="sortOrder"
          :current-id="drawerId ?? undefined"
          :compact="drawerId !== null"
          :compact-keys="['code', 'name', 'fsd.status']"
          :loading="loading && !loaded"
          :view-key="filterKey()"
          :disabled="busy"
          :empty-text="
            !currentProject
              ? '选择项目后开始维护开发清单'
              : !items.length
                ? '还没有开发项'
                : '没有符合条件的开发项'
          "
          @open="open($event.id)"
          @sort="
            (field, order) => {
              sortField = field;
              sortOrder = order;
            }
          "
          @columns-change="columnKeys = $event"
        >
          <template #mobile-row="{ row: item }">
            <div class="mobile-item">
              <button class="mobile-title" @click="open(item.id)">
                {{ item.code }} {{ item.name }}
              </button>
              <span v-if="summary(item)" class="name-sub">{{ summary(item) }}</span>
              <div class="mobile-meta">
                <BaseTag v-if="item.module" :tone="moduleHue(item.module)">{{
                  item.module
                }}</BaseTag
                ><span v-for="p in PHASES" :key="p.key"
                  >{{ p.label }} {{ OPTIONS.status[item.phases[p.key].status] }}</span
                >
              </div>
            </div>
          </template>
          <template #cell="{ row: item, column }">
            <button
              v-if="column.key === 'code'"
              class="code-link"
              :aria-label="`查看 ${item.code}`"
              @click.stop="open(item.id)"
            >
              {{ item.code }}
            </button>
            <span v-else-if="column.key === 'name'" class="name-cell">
              <button class="name-link" :title="item.name" @click.stop="open(item.id)">
                {{ item.name }}
              </button>
              <span class="name-sub" :class="{ empty: !summary(item) }">{{
                summary(item) || '尚未填写业务功能点'
              }}</span>
            </span>
            <div v-else-if="column.key === 'actions'" class="row-actions" data-no-open>
              <RouterLink
                class="row-icon"
                :to="`/projects/${currentProject}/development-items/${item.id}/design`"
                :aria-label="'设计 ' + item.code"
                title="设计"
                ><Sparkles
              /></RouterLink>
              <RouterLink
                v-if="DEV_AGENT_KINDS.includes(item.kind)"
                class="row-icon"
                :to="`/projects/${currentProject}/development-items/${item.id}/development`"
                :aria-label="'开发 ' + item.code"
                title="开发"
                ><Code2
              /></RouterLink>
              <button
                v-else
                type="button"
                class="row-icon"
                :aria-label="'开发 ' + item.code"
                title="开发"
                @click="comingSoon('开发')"
              >
                <Code2 />
              </button>
              <BaseMenu align="end">
                <template #trigger>
                  <button type="button" class="row-icon" :aria-label="item.code + ' 的更多操作'">
                    <MoreHorizontal />
                  </button>
                </template>
                <BaseMenuItem tone="blue" @select="comingSoon('顾问测试')"
                  ><template #icon><ClipboardCheck /></template>顾问测试</BaseMenuItem
                >
                <BaseMenuItem tone="purple" @select="comingSoon('IT/用户测试')"
                  ><template #icon><UserCheck /></template>IT/用户测试</BaseMenuItem
                >
                <BaseMenuSeparator />
                <BaseMenuItem @select="open(item.id)"
                  ><template #icon><PenSquare /></template>查看 / 编辑</BaseMenuItem
                >
                <BaseMenuItem
                  :disabled="readOnly || busy"
                  @select="((checked = [item.id]), batchCopy())"
                  ><template #icon><Copy /></template>复制</BaseMenuItem
                >
                <BaseMenuItem danger :disabled="readOnly || busy" @select="removeOne(item)"
                  ><template #icon><Trash2 /></template>删除</BaseMenuItem
                >
              </BaseMenu>
            </div>
            <InlineCell
              v-else-if="fields.find((f) => f.key === column.key)"
              :item="item"
              :field="fields.find((f) => f.key === column.key)!"
              :ctx="ctx"
              :read-only="readOnly || busy"
              :save="saveCell"
            />
          </template>
          <template #empty>
            <BaseButton v-if="activeFilters.length" size="sm" @click="clearFilters"
              >清除所有筛选</BaseButton
            >
            <BaseButton
              v-else-if="currentProject && !items.length && !readOnly && loaded"
              size="sm"
              data-keep-drawer
              @click="openCreate"
              ><template #icon><Plus /></template>新建第一个开发项</BaseButton
            >
          </template>
        </WorkbenchTable>
        <footer class="list-footer">
          <span
            >{{ filtered.length ? (page - 1) * pageSize + 1 : 0 }}–{{
              Math.min(page * pageSize, filtered.length)
            }}
            / 共 {{ filtered.length }} 项</span
          >
          <label
            >每页<select v-model.number="pageSize" aria-label="每页数量">
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select></label
          >
          <span class="pager">
            <BaseButton variant="ghost" size="sm" :disabled="page <= 1" @click="page--"
              >上一页</BaseButton
            ><span>{{ page }} / {{ pages }}</span
            ><BaseButton variant="ghost" size="sm" :disabled="page >= pages" @click="page++"
              >下一页</BaseButton
            >
          </span>
        </footer>
      </div>
      <ItemDrawer
        v-if="drawerId !== null && currentProject"
        :key="drawerId === '' ? 'new' : 'item'"
        ref="drawer"
        :item="drawerItem"
        :fields="fields"
        :ctx="ctx"
        :base="base"
        :project-id="currentProject"
        :read-only="readOnly"
        :create-tag="createTag"
        @close="closeDrawer"
        @saved="saved"
        @delete="removeOne"
        @agent="comingSoon"
      />
    </section>

    <div v-if="checked.length" class="batch-dock">
      <BaseActionBar>
        <div>
          <span class="batch-count" role="status">已选 {{ checked.length }} 项</span>
          <BaseButton
            variant="ghost"
            :disabled="readOnly || busy"
            @click="((batchError = ''), (dialog = 'batch'))"
            ><template #icon><PenSquare /></template>批量修改</BaseButton
          >
          <BaseButton variant="ghost" :disabled="readOnly || busy" @click="batchCopy"
            ><template #icon><Copy /></template>复制</BaseButton
          >
          <BaseButton
            variant="ghost"
            :disabled="busy"
            @click="exportExcel(checked, `选中的 ${checked.length} 项`)"
            ><template #icon><FileDown /></template>导出</BaseButton
          >
          <BaseButton variant="danger" :disabled="readOnly || busy" @click="batchDelete"
            ><template #icon><Trash2 /></template>删除</BaseButton
          >
        </div>
        <div>
          <BaseButton variant="ghost" :disabled="busy" @click="checked = []"
            ><template #icon><X /></template>取消选择</BaseButton
          >
        </div>
      </BaseActionBar>
    </div>

    <BatchEditDialog
      v-if="dialog === 'batch'"
      :count="checked.length"
      :fields="fields"
      :ctx="ctx"
      :busy="busy"
      :error="batchError"
      :create-tag="createTag"
      @close="dialog = ''"
      @apply="applyBatch"
    />
    <ImportDialog
      v-if="dialog === 'import'"
      :base="base"
      @close="dialog = ''"
      @imported="imported"
    />
    <ListSettings
      v-if="dialog === 'settings' && currentProject"
      :project-id="currentProject"
      :fields="customFields"
      :tags="tags"
      :is-admin="isAdmin"
      :read-only="readOnly"
      @close="dialog = ''"
      @changed="load()"
    />
  </div>
</template>
