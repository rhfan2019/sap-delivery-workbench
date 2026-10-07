<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, onBeforeRouteLeave } from 'vue-router';
import {
  Plus,
  Trash2,
  RefreshCw,
  Download,
  Columns3,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  X,
  Search,
} from '@lucide/vue';
import WorkbenchTable from '../../components/workbench-table/WorkbenchTable.vue';
import { tableColumns, fieldFor, stageLabel } from './tableColumns';
import { api, ApiError, identity } from '../../services/session';
import { currentProject, projects, leaveDelivery } from '../../services/projectContext';
import { fields, display, type Field, type Item, type Member } from './model';
import EditableField from './EditableField.vue';
import { safeRequirement } from './richText';
import FieldInput from './FieldInput.vue';
import FsEditor from './FsEntry.vue';
import OverviewExtras from './OverviewExtras.vue';
import './delivery.css';
import { scopedRequest } from './scopedRequest';
import { askConfirmation } from '../../services/confirmation';
const checked = ref<string[]>([]);
const table = ref<{ openColumns: () => void }>();
async function removeSelected() {
  if (readOnly.value || anyBusy.value || !checked.value.length || !(await safeLeave())) return;
  const targets = items.value.filter((i) => checked.value.includes(i.id));
  if (
    !(await askConfirmation(
      `将选中的 ${targets.length} 个开发项标记删除？历史资料会保留，此操作不会删除关联历史。`,
    ))
  )
    return;
  busy.value = true;
  error.value = '';
  let removed = 0;
  const failures: string[] = [];
  const path = base.value;
  try {
    for (const item of targets) {
      try {
        await api(path + '/' + item.id, { rowVersion: item.rowVersion }, 'DELETE');
        items.value = items.value.filter((i) => i.id !== item.id);
        checked.value = checked.value.filter((id) => id !== item.id);
        if (selected.value === item.id) {
          selected.value = '';
          full.value = false;
        }
        removed++;
      } catch (e) {
        failures.push(item.code + '：' + (e as Error).message);
      }
    }
    notice.value = `已删除 ${removed} 项`;
    if (failures.length)
      error.value = `有 ${failures.length} 项删除失败，已保留勾选。` + failures.join('；');
  } finally {
    busy.value = false;
  }
}
const items = ref<Item[]>([]),
  members = ref<Member[]>([]);
const readOnly = ref(true),
  isAdmin = ref(false),
  loading = ref(false),
  busy = ref(false);
const error = ref(''),
  notice = ref(''),
  selected = ref(''),
  tab = ref('概览'),
  full = ref(false);
const pageSize = ref(20);
const advanced = ref(false);
const loadError = ref(false);
const loaded = ref(false);
const ownerFilter = ref(''),
  developerFilter = ref(''),
  priorityFilter = ref('');
const dateFrom = ref(''),
  dateTo = ref('');
const sortField = ref(''),
  sortOrder = ref<'asc' | 'desc' | null>(null);
const columnKeys = ref<string[]>([]);
const columnStorageKey = computed(
  () => `delivery-columns:v1:${identity.value?.organization.id}:${identity.value?.user.id}`,
);
function clearFilters() {
  search.value = '';
  moduleFilter.value = '';
  stageFilter.value = '';
  ownerFilter.value = '';
  developerFilter.value = '';
  priorityFilter.value = '';
  dateFrom.value = '';
  dateTo.value = '';
}
const search = ref(''),
  scope = ref('all'),
  moduleFilter = ref(''),
  stageFilter = ref(''),
  page = ref(1);
let restoringFilters = false;
const filterKey = () =>
  `delivery-filters:${identity.value?.organization.id}:${identity.value?.user.id}:${currentProject.value}`;
function readFilters() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(filterKey()) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}
watch(
  [
    search,
    scope,
    moduleFilter,
    stageFilter,
    page,
    pageSize,
    ownerFilter,
    developerFilter,
    priorityFilter,
    dateFrom,
    dateTo,
    sortField,
    sortOrder,
  ],
  () => {
    if (restoringFilters) return;
    try {
      sessionStorage.setItem(
        filterKey(),
        JSON.stringify({
          search: search.value,
          scope: scope.value,
          moduleFilter: moduleFilter.value,
          stageFilter: stageFilter.value,
          page: page.value,
          pageSize: pageSize.value,
          ownerFilter: ownerFilter.value,
          developerFilter: developerFilter.value,
          priorityFilter: priorityFilter.value,
          dateFrom: dateFrom.value,
          dateTo: dateTo.value,
          sortField: sortField.value,
          sortOrder: sortOrder.value,
        }),
      );
    } catch {}
  },
  { flush: 'sync' },
);
const fsEditor = ref<InstanceType<typeof FsEditor> | null>(null),
  extras = ref<InstanceType<typeof OverviewExtras> | null>(null);
const edit = ref<{ id: string; field: Field; value: string; original: string } | null>(null);
const creating = ref(false),
  newItem = ref<Record<string, string>>({});
const split = ref<HTMLElement | null>(null);
const createDialog = ref<HTMLElement | null>(null);
watch(creating, async (open) => {
  if (open) {
    await nextTick();
    createDialog.value?.querySelector('input')?.focus();
  }
});
function dialogKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    void safeLeave();
  }
  if (event.key === 'Tab') {
    const controls = [
      ...(createDialog.value?.querySelectorAll<HTMLElement>(
        'input:not(:disabled),select:not(:disabled),button:not(:disabled)',
      ) ?? []),
    ];
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
const width = ref(52);
const storageKey = 'development-split:' + identity.value?.user.id;
try {
  width.value = Math.max(30, Math.min(70, Number(localStorage.getItem(storageKey)) || 52));
} catch {
  /* optional */
}
const base = computed(() => '/projects/' + currentProject.value + '/development-items');
const active = computed(() => items.value.find((i) => i.id === selected.value));
const activePath = computed(() => base.value + '/' + selected.value);
const canWriteFs = computed(
  () =>
    !readOnly.value &&
    !loading.value &&
    !!active.value &&
    (isAdmin.value ||
      (active.value.businessOwnerId ?? active.value.createdBy) === identity.value?.user.id),
);
const editingDirty = computed(() => !!edit.value && edit.value.value !== edit.value.original);
const anyBusy = computed(() => busy.value || fsEditor.value?.busy || extras.value?.busy);
const viewKey = computed(
  () =>
    filterKey() +
    ':' +
    JSON.stringify([
      search.value,
      scope.value,
      moduleFilter.value,
      stageFilter.value,
      ownerFilter.value,
      developerFilter.value,
      priorityFilter.value,
      dateFrom.value,
      dateTo.value,
      sortField.value,
      sortOrder.value,
      page.value,
      pageSize.value,
    ]),
);
async function refresh() {
  if (loading.value || !(await safeLeave())) return;
  await load();
}
const dirty = computed(() => editingDirty.value || fsEditor.value?.dirty || creating.value);
const matching = computed(() =>
  items.value.filter((i) => {
    return (
      (i.code + ' ' + i.name + ' ' + i.module).toLowerCase().includes(search.value.toLowerCase()) &&
      (!moduleFilter.value || i.module === moduleFilter.value) &&
      (!stageFilter.value ||
        (stageFilter.value === 'blocked' ? !!i.blockedReason : i.stage === stageFilter.value)) &&
      (!ownerFilter.value || i.businessOwnerId === ownerFilter.value) &&
      (!developerFilter.value ||
        (developerFilter.value === 'unassigned'
          ? !i.developerId
          : i.developerId === developerFilter.value)) &&
      (!priorityFilter.value || i.priority === priorityFilter.value) &&
      (!dateFrom.value || (!!i.plannedDevDate && i.plannedDevDate >= dateFrom.value)) &&
      (!dateTo.value || (!!i.plannedDevDate && i.plannedDevDate <= dateTo.value))
    );
  }),
);
function inScope(i: Item, target: string) {
  const me = identity.value?.user.id;
  return (
    target === 'all' ||
    (target === 'business' && i.businessOwnerId === me) ||
    (target === 'developer' && i.developerId === me && i.stage === 'ready') ||
    (target === 'tester' && i.testerId === me)
  );
}
const scopes = computed(() =>
  [
    { id: 'all', name: '全部' },
    { id: 'business', name: '我负责的需求' },
    { id: 'developer', name: '待我开发' },
    { id: 'tester', name: '我负责的测试' },
  ].map((s) => ({ ...s, count: matching.value.filter((i) => inScope(i, s.id)).length })),
);
const filtered = computed(() => {
  const result = matching.value.filter((i) => inScope(i, scope.value));
  if (!sortField.value || !sortOrder.value) return result;
  const key = sortField.value as keyof Item;
  const field = fields.find((f) => f.key === key);
  const value = (i: Item) =>
    key === 'priority'
      ? { high: '1', medium: '2', low: '3' }[i.priority] || ''
      : field
        ? display(i, field, members.value)
        : String(i[key] || '');
  return result.sort(
    (a, b) =>
      value(a).localeCompare(value(b), 'zh-CN', { numeric: true }) *
      (sortOrder.value === 'asc' ? 1 : -1),
  );
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const rows = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

const activeFilters = computed(() => [
  ...(search.value
    ? [{ key: 'search', label: `搜索：${search.value}`, clear: () => (search.value = '') }]
    : []),
  ...(moduleFilter.value
    ? [
        {
          key: 'module',
          label: `模块：${moduleFilter.value}`,
          clear: () => (moduleFilter.value = ''),
        },
      ]
    : []),
  ...(stageFilter.value
    ? [
        {
          key: 'stage',
          label: `阶段：${stageFilter.value === 'blocked' ? '有阻塞' : stageLabel(stageFilter.value)}`,
          clear: () => (stageFilter.value = ''),
        },
      ]
    : []),
  ...[
    { key: 'owner', state: ownerFilter, label: '业务顾问' },
    { key: 'developer', state: developerFilter, label: '开发人员' },
    { key: 'priority', state: priorityFilter, label: '优先级' },
    { key: 'from', state: dateFrom, label: '计划开始' },
    { key: 'to', state: dateTo, label: '计划截止' },
  ]
    .filter((f) => f.state.value)
    .map((f) => ({
      key: f.key,
      label: `${f.label}：${members.value.find((m) => m.id === f.state.value)?.displayName || { high: '高', medium: '中', low: '低', unassigned: '未分配' }[f.state.value] || f.state.value}`,
      clear: () => (f.state.value = ''),
    })),
]);
watch(
  [
    search,
    scope,
    moduleFilter,
    stageFilter,
    ownerFilter,
    developerFilter,
    priorityFilter,
    dateFrom,
    dateTo,
    page,
    pageSize,
    sortField,
    sortOrder,
  ],
  () => {
    if (checked.value.length) {
      checked.value = [];
      notice.value = '列表范围已改变，已清空勾选。';
    }
  },
);
watch(
  [
    search,
    scope,
    moduleFilter,
    stageFilter,
    ownerFilter,
    developerFilter,
    priorityFilter,
    dateFrom,
    dateTo,
    pageSize,
    sortField,
    sortOrder,
  ],
  () => {
    if (!restoringFilters) page.value = 1;
  },
  { flush: 'sync' },
);
watch(pages, (n) => {
  if (!loading.value && !restoringFilters) page.value = Math.min(page.value, n);
});
async function safeLeave() {
  if (anyBusy.value) {
    error.value = '正在保存，请等待完成后再切换。';
    return false;
  }
  if (dirty.value && !(await askConfirmation('当前有未保存内容。放弃修改并继续？'))) return false;
  edit.value = null;
  creating.value = false;
  return true;
}
leaveDelivery.value = safeLeave;
onBeforeRouteLeave(() => safeLeave());
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || anyBusy.value) {
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
let generation = 0;
async function load(reset = false) {
  const request = ++generation;
  const path = base.value;
  loading.value = true;
  checked.value = [];
  error.value = '';
  loadError.value = false;
  notice.value = '';
  if (reset) {
    items.value = [];
    members.value = [];
    selected.value = '';
    edit.value = null;
    tab.value = '概览';
    full.value = false;
    readOnly.value = true;
    loaded.value = false;
  }
  if (!currentProject.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const result = await api<{
      items: Item[];
      members: Member[];
      readOnly: boolean;
      isAdmin: boolean;
    }>(path);
    if (request !== generation) return;
    items.value = result.items;
    if (selected.value && !result.items.some((item) => item.id === selected.value)) {
      selected.value = '';
      full.value = false;
      edit.value = null;
    }
    page.value = Math.max(1, Math.min(page.value, pages.value));
    members.value = result.members;
    readOnly.value = result.readOnly;
    isAdmin.value = result.isAdmin;
    loaded.value = true;
    if (!reset) notice.value = '清单已更新';
  } catch (e) {
    if (request === generation) {
      error.value = (e as Error).message;
      loadError.value = true;
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
        items.value = [];
        members.value = [];
        selected.value = '';
        full.value = false;
        edit.value = null;
        readOnly.value = true;
        loaded.value = false;
      }
    }
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(
  [currentProject, () => identity.value?.user.id],
  () => {
    const saved = readFilters();
    restoringFilters = true;
    search.value = typeof saved.search === 'string' ? saved.search : '';
    scope.value = ['all', 'business', 'developer', 'tester'].includes(saved.scope)
      ? saved.scope
      : 'all';
    moduleFilter.value = typeof saved.moduleFilter === 'string' ? saved.moduleFilter : '';
    stageFilter.value = typeof saved.stageFilter === 'string' ? saved.stageFilter : '';
    ownerFilter.value = saved.ownerFilter || '';
    developerFilter.value = saved.developerFilter || '';
    priorityFilter.value = saved.priorityFilter || '';
    dateFrom.value = saved.dateFrom || '';
    dateTo.value = saved.dateTo || '';
    pageSize.value = [20, 50, 100].includes(saved.pageSize) ? saved.pageSize : 20;
    sortField.value = tableColumns.some((c) => c.key === saved.sortField) ? saved.sortField : '';
    sortOrder.value = ['asc', 'desc'].includes(saved.sortOrder) ? saved.sortOrder : null;
    page.value = Number.isSafeInteger(saved.page) && saved.page > 0 ? saved.page : 1;
    restoringFilters = false;
    advanced.value = false;
    void load(true);
  },
  { immediate: true, flush: 'sync' },
);
async function select(id: string) {
  if (selected.value === id) return;
  if (!(await safeLeave())) return;
  selected.value = id;
  tab.value = '概览';
  notice.value = '';
  error.value = '';
}
async function switchTab(name: string) {
  if (name === tab.value) return;
  if (!(await safeLeave())) return;
  tab.value = name;
}
async function begin(item: Item, field: Field) {
  if (readOnly.value || loading.value || anyBusy.value) return;
  if (edit.value?.id === item.id && edit.value.field.key === field.key) return;
  if (!(await safeLeave())) return;
  if (field.type === 'rich' || field.type === 'long') {
    selected.value = item.id;
    tab.value = '概览';
    full.value = true;
  }
  const value =
    field.type === 'rich'
      ? safeRequirement(item.summary ?? '', item.summaryFormat)
      : (item[field.key] ?? '');
  edit.value = { id: item.id, field, value, original: value };
  void nextTick(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.inline-editor input, .inline-editor select, .inline-editor textarea, .inline-editor [contenteditable="true"]',
      ),
    ]
      .find((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      ?.focus(),
  );
}
function replace(item: Item) {
  const index = items.value.findIndex((i) => i.id === item.id);
  if (index >= 0) items.value[index] = item;
  else items.value.unshift(item);
}
async function save() {
  if (!edit.value || busy.value || loading.value) return;
  const draft = edit.value;
  const item = items.value.find((i) => i.id === draft.id);
  if (!item) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    replace(
      await api<Item>(
        base.value + '/' + item.id,
        {
          rowVersion: item.rowVersion,
          changes: {
            [draft.field.key]: draft.value,
            ...(draft.field.type === 'rich' ? { summaryFormat: 'html' } : {}),
          },
        },
        'PATCH',
      ),
    );
    edit.value = null;
    notice.value = '字段已保存';
    await extras.value?.load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const readScope = () => generation + ':' + activePath.value;
async function refreshItem() {
  const id = edit.value?.id || selected.value;
  if (!id || anyBusy.value) return;
  const path = base.value + '/' + id;
  await scopedRequest(
    readScope,
    () => api<Item>(path),
    (result) => {
      replace(result);
      notice.value = '已读取最新字段；未保存输入仍保留，请核对后保存。';
      error.value = '';
    },
    (e) => {
      error.value = (e as Error).message;
    },
  );
}
async function fsUpdated() {
  const path = activePath.value;
  await scopedRequest(
    readScope,
    () => api<Item>(path),
    replace,
    (e) => {
      error.value = (e as Error).message;
    },
  );
}
async function openCreate() {
  if (!(await safeLeave())) return;
  newItem.value = {
    name: '',
    module: '',
    kind: 'report',
    changeType: 'new',
    priority: 'low',
    businessOwnerId: identity.value!.user.id,
  };
  creating.value = true;
}
async function create() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await api<Item>(base.value, newItem.value);
    replace(result);
    creating.value = false;
    selected.value = result.id;
    tab.value = '概览';
    clearFilters();
    search.value = '';
    scope.value = 'all';
    moduleFilter.value = '';
    stageFilter.value = '';
    page.value = 1;
    notice.value = '开发项已创建';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function exportCsv() {
  const quote = (v: string) =>
    '"' + (/^[\s]*[=+\-@\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"';
  const exportColumns = (
    columnKeys.value.length
      ? columnKeys.value
      : tableColumns.filter((c) => c.visible !== false).map((c) => c.key)
  ).flatMap((key) => {
    const column = tableColumns.find((c) => c.key === key);
    return column && key !== 'actions' ? [column] : [];
  });
  const lines = [
    exportColumns.map((c) => c.label),
    ...filtered.value.map((i) =>
      exportColumns.map((c) =>
        c.key === 'code'
          ? i.code
          : c.key === 'stage'
            ? stageLabel(i.stage)
            : display(i, fieldFor(c.key), members.value),
      ),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + lines.map((row) => row.map(quote).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = '开发清单.csv';
  a.click();
  URL.revokeObjectURL(url);
  notice.value = `已导出 ${filtered.value.length} 项（当前筛选全部结果）`;
}
function persistWidth() {
  try {
    localStorage.setItem(storageKey, String(width.value));
  } catch {
    /* optional */
  }
}
function resize(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const rect = split.value!.getBoundingClientRect();
  const move = (e: PointerEvent) => {
    width.value = Math.max(30, Math.min(70, (100 * (e.clientX - rect.left)) / rect.width));
  };
  const end = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    persistWidth();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
function keyResize(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  event.preventDefault();
  width.value =
    event.key === 'Home'
      ? 52
      : Math.max(30, Math.min(70, width.value + (event.key === 'ArrowLeft' ? -2 : 2)));
  persistWidth();
}
</script>
<template>
  <div class="delivery-page">
    <div class="delivery-heading">
      <div>
        <h1>开发清单</h1>
        <p class="muted">
          {{ projects.find((p) => p.id === currentProject)?.name || '请在右上角选择项目' }}
        </p>
      </div>
      <button class="primary-button" :disabled="readOnly || loading || anyBusy" @click="openCreate">
        <Plus :size="16" />新建开发项
      </button>
    </div>
    <p v-if="error" class="error-note" role="alert">
      {{ error }}
      <button v-if="loadError" :disabled="loading || anyBusy" @click="refresh">重试加载</button>
      <button v-if="active || edit" :disabled="anyBusy" @click="refreshItem">读取最新字段</button>
    </p>
    <p v-if="notice" class="delivery-success" role="status">{{ notice }}</p>
    <p v-if="readOnly && currentProject && !loading && !error" class="delivery-hint">
      此项目已归档，只能查看历史资料。
    </p>
    <nav class="scope-tabs delivery-scopes" aria-label="清单视图">
      <button
        v-for="s in scopes"
        :key="s.id"
        :class="{ active: scope === s.id }"
        :aria-pressed="scope === s.id"
        :disabled="anyBusy"
        @click="scope = s.id"
      >
        {{ s.name }}<span>{{ s.count }}</span>
      </button>
    </nav>
    <div class="delivery-filters">
      <div class="filter-controls">
        <label class="search-filter"
          >搜索
          <div class="search-input">
            <Search :size="16" /><input
              v-model="search"
              aria-label="搜索开发清单"
              placeholder="编号、开发名称或模块"
              :disabled="anyBusy"
            /></div
        ></label>
        <label
          >模块<select v-model="moduleFilter" aria-label="筛选模块" :disabled="anyBusy">
            <option value="">全部模块</option>
            <option v-for="m in [...new Set(items.map((i) => i.module))].sort()" :key="m">
              {{ m }}
            </option>
          </select></label
        >
        <label
          >阶段<select v-model="stageFilter" aria-label="筛选阶段" :disabled="anyBusy">
            <option value="">全部阶段</option>
            <option value="fs_draft">FS 编写</option>
            <option value="ready">待开发</option>
            <option value="blocked">有阻塞</option>
          </select></label
        >
        <div class="filter-actions">
          <button class="quiet-button" :aria-expanded="advanced" @click="advanced = !advanced">
            <SlidersHorizontal :size="16" />更多筛选<ChevronUp
              v-if="advanced"
              :size="14"
            /><ChevronDown v-else :size="14" />
          </button>
        </div>
        <div class="table-actions" aria-label="表格工具栏">
          <template v-if="checked.length">
            <span class="selection-count" role="status">已选择 {{ checked.length }} 项</span>
            <button class="quiet-button" :disabled="anyBusy" @click="checked = []">取消选择</button>
            <button
              class="danger-action"
              :disabled="readOnly || loading || anyBusy"
              @click="removeSelected"
            >
              <Trash2 :size="16" />删除
            </button>
          </template>
          <template v-else>
            <span v-if="loading && loaded" role="status" class="refresh-status">更新中…</span>
            <button
              class="quiet-button icon-action"
              aria-label="刷新"
              title="刷新"
              :disabled="loading || !currentProject || anyBusy"
              @click="refresh"
            >
              <RefreshCw :size="16" />
            </button>
            <button
              class="quiet-button icon-action"
              aria-label="导出 CSV"
              title="导出当前筛选的全部结果（CSV）"
              :disabled="!filtered.length || loading"
              @click="exportCsv"
            >
              <Download :size="16" />
            </button>
            <button
              class="quiet-button icon-action"
              aria-label="列设置"
              title="列设置"
              :disabled="anyBusy"
              @click="table?.openColumns()"
            >
              <Columns3 :size="16" />
            </button>
          </template>
        </div>
      </div>
      <div v-if="advanced" class="filter-controls advanced-filters">
        <label
          >业务顾问<select v-model="ownerFilter" :disabled="anyBusy">
            <option value="">全部顾问</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.displayName }}</option>
          </select></label
        >
        <label
          >开发人员<select v-model="developerFilter" :disabled="anyBusy">
            <option value="">全部人员</option>
            <option value="unassigned">未分配</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.displayName }}</option>
          </select></label
        >
        <label
          >优先级<select v-model="priorityFilter" :disabled="anyBusy">
            <option value="">全部优先级</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select></label
        >
        <label
          >计划完成 · 从<input
            v-model="dateFrom"
            type="date"
            :max="dateTo || undefined"
            :disabled="anyBusy" /></label
        ><label
          >至<input v-model="dateTo" type="date" :min="dateFrom || undefined" :disabled="anyBusy"
        /></label>
      </div>
    </div>
    <div v-if="activeFilters.length" class="filter-feedback" aria-label="已生效筛选">
      <span>已筛选</span
      ><button
        v-for="f in activeFilters"
        :key="f.key"
        :disabled="anyBusy"
        :aria-label="'移除' + f.label"
        @click="f.clear"
      >
        {{ f.label }}<X :size="12" />
      </button>
      <button class="quiet-button" :disabled="anyBusy" @click="clearFilters">清除全部</button>
    </div>

    <div
      ref="split"
      class="delivery-split"
      :class="{ 'has-detail': active, 'detail-full': full }"
      :style="{ '--list-width': width + '%' }"
    >
      <section v-show="!full" class="delivery-list">
        <div class="table-scroll">
          <WorkbenchTable
            ref="table"
            :rows="rows"
            :columns="tableColumns"
            :storage-key="columnStorageKey"
            v-model:checked="checked"
            :sort-field="sortField"
            :sort-order="sortOrder"
            :current-id="selected"
            :compact="!!active"
            :compact-keys="['code', 'name', 'stage']"
            :loading="loading && !loaded"
            :view-key="viewKey"
            :disabled="anyBusy"
            :empty-text="
              !currentProject
                ? '选择项目后开始维护开发清单'
                : loadError
                  ? '清单加载失败，请重试'
                  : !items.length
                    ? '尚无开发项'
                    : activeFilters.length
                      ? '没有符合筛选条件的开发项'
                      : '当前范围暂无任务'
            "
            @open="select($event.id)"
            @sort="
              (field, order) => {
                sortField = field;
                sortOrder = order;
              }
            "
            @columns-change="columnKeys = $event"
          >
            <template #mobile-row="{ row: item }">
              <div class="mobile-item-content">
                <button class="mobile-item-title" :disabled="anyBusy" @click="select(item.id)">
                  {{ item.name }}
                </button>
                <div class="mobile-item-meta">
                  <span>{{ item.code }}</span
                  ><span>{{ item.module }}</span
                  ><span>{{ stageLabel(item.stage) }}</span
                  ><span v-if="item.blockedReason" class="blocked-label">有阻塞</span>
                </div>
                <div class="mobile-item-meta">
                  <span>{{
                    item.developerId
                      ? members.find((m) => m.id === item.developerId)?.displayName || '历史成员'
                      : '未分配开发人员'
                  }}</span
                  ><span>{{ item.plannedDevDate || '未设计划日期' }}</span>
                </div>
                <div class="row-actions">
                  <RouterLink
                    :to="`/projects/${currentProject}/development-items/${item.id}/design`"
                    @click="anyBusy && $event.preventDefault()"
                    >设计</RouterLink
                  ><RouterLink
                    :to="`/projects/${currentProject}/development-items/${item.id}/development`"
                    @click="anyBusy && $event.preventDefault()"
                    >开发</RouterLink
                  >
                </div>
              </div>
            </template>
            <template #cell="{ row: item, column }">
              <button
                v-if="column.key === 'code'"
                class="item-code"
                :disabled="anyBusy"
                :aria-label="`查看 ${item.code}`"
                @click.stop="select(item.id)"
              >
                {{ item.code }}
              </button>
              <div v-else-if="column.key === 'stage'" class="stage-cell">
                <span :class="['status-label', { ready: item.stage === 'ready' }]">{{
                  stageLabel(item.stage)
                }}</span
                ><span v-if="item.blockedReason" class="blocked-label" :title="item.blockedReason"
                  >有阻塞</span
                >
              </div>
              <div v-else-if="column.key === 'actions'" class="row-actions" @click.stop>
                <RouterLink
                  :to="`/projects/${currentProject}/development-items/${item.id}/design`"
                  :aria-disabled="anyBusy"
                  :class="{ 'suggested-action': item.stage === 'fs_draft' }"
                  @click="anyBusy && $event.preventDefault()"
                  >设计</RouterLink
                >
                <RouterLink
                  :to="`/projects/${currentProject}/development-items/${item.id}/development`"
                  :aria-disabled="anyBusy"
                  :class="{ 'suggested-action': item.stage === 'ready' }"
                  @click="anyBusy && $event.preventDefault()"
                  >开发</RouterLink
                >
              </div>
              <EditableField
                v-else
                :item="item"
                :compact="true"
                :field="fieldFor(column.key)"
                :members="members"
                :editing="
                  !['rich', 'long'].includes(fieldFor(column.key).type || '') &&
                  edit?.id === item.id &&
                  edit?.field.key === column.key
                "
                :value="edit?.value ?? ''"
                :read-only="readOnly || loading"
                :busy="busy"
                @start="begin(item, fieldFor(column.key))"
                @update:value="edit && (edit.value = $event)"
                @save="save"
                @cancel="!busy && (edit = null)"
              />
            </template>
            <template #empty
              ><button v-if="activeFilters.length" class="quiet-button" @click="clearFilters">
                清除所有筛选</button
              ><button
                v-else-if="scope !== 'all' && !loadError"
                class="quiet-button"
                @click="scope = 'all'"
              >
                查看全部开发项</button
              ><button
                v-else-if="!items.length && !readOnly && !loadError && !loading"
                class="quiet-button"
                @click="openCreate"
              >
                新建开发项
              </button></template
            >
          </WorkbenchTable>
        </div>
        <div class="list-footer">
          <span
            >{{ filtered.length ? (page - 1) * pageSize + 1 : 0 }}–{{
              Math.min(page * pageSize, filtered.length)
            }}
            / {{ filtered.length }} 项</span
          ><label
            >每页<select v-model="pageSize" aria-label="每页数量" :disabled="anyBusy">
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select></label
          >
          <div class="pagination-actions">
            <button :disabled="!loaded || loading || page <= 1 || anyBusy" @click="page--">
              上一页</button
            ><span>{{ loaded ? page : 1 }} / {{ pages }}</span
            ><button :disabled="!loaded || loading || page >= pages || anyBusy" @click="page++">
              下一页
            </button>
          </div>
        </div>
      </section>
      <div
        v-if="active && !full"
        class="split-handle"
        role="separator"
        aria-label="调整列表和详情宽度"
        aria-orientation="vertical"
        :aria-valuenow="Math.round(width)"
        :aria-valuemin="30"
        :aria-valuemax="70"
        tabindex="0"
        @pointerdown.prevent="resize"
        @keydown="keyResize"
        @dblclick="
          width = 52;
          persistWidth();
        "
      >
        <span>⋮</span>
      </div>
      <section v-if="active" class="delivery-detail">
        <header class="detail-heading">
          <div>
            <small
              >{{ active.code }} · {{ active.module }} ·
              {{ active.stage === 'ready' ? '待开发' : 'FS 编写' }}</small
            >
            <h2>{{ active.name }}</h2>
          </div>
          <div>
            <button @click="full = !full">{{ full ? '返回分栏' : '展开详情' }}</button
            ><button
              aria-label="关闭详情"
              @click="
                async () => {
                  if (await safeLeave()) {
                    selected = '';
                    full = false;
                  }
                }
              "
            >
              ×
            </button>
          </div>
        </header>
        <nav class="detail-tabs" aria-label="开发项详情">
          <button
            v-for="name in ['概览', 'FS', '开发 / TS', '测试', 'Issue', '历史']"
            :key="name"
            :class="{ active: tab === name }"
            @click="switchTab(name)"
          >
            {{ name }}<small v-if="!['概览', 'FS'].includes(name)">待建</small>
          </button>
        </nav>
        <div v-if="tab === '概览'" class="detail-body">
          <div class="overview-title">
            <h3>基本信息</h3>
            <small>点击 ✎ 或双击字段编辑</small>
          </div>
          <div class="overview-grid">
            <div
              v-for="f in fields"
              :key="f.key"
              class="overview-field"
              :class="{ wide: f.type === 'long' || f.type === 'rich' }"
            >
              <label>{{ f.label }}</label
              ><EditableField
                :item="active"
                :field="f"
                :members="members"
                :editing="edit?.id === active.id && edit.field.key === f.key"
                :value="edit?.value ?? ''"
                :read-only="readOnly || loading"
                :busy="busy"
                @start="begin(active, f)"
                @update:value="edit && (edit.value = $event)"
                @save="save"
                @cancel="!busy && (edit = null)"
              />
            </div>
          </div>
          <OverviewExtras
            :key="activePath"
            ref="extras"
            :path="activePath"
            :read-only="readOnly || loading"
          />
        </div>
        <FsEditor
          v-else-if="tab === 'FS'"
          :key="activePath"
          ref="fsEditor"
          :path="activePath"
          :item="active"
          :writable="canWriteFs"
          @updated="fsUpdated"
        />
        <div v-else class="delivery-empty planned-detail">
          <span>○</span>
          <h3>{{ tab }}</h3>
          <p>此页签暂未实现，后续逐步开放。</p>
        </div>
      </section>
    </div>
    <div v-if="creating" class="delivery-modal-backdrop">
      <section
        class="delivery-modal"
        ref="createDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-item-title"
        @keydown="dialogKeys"
      >
        <h2 id="new-item-title">新建开发项</h2>
        <p class="delivery-hint">
          {{ projects.find((p) => p.id === currentProject)?.name }} · 名称、模块、类型为必填
        </p>
        <p v-if="error" class="error-note" role="alert">{{ error }}</p>
        <form @submit.prevent="create">
          <label v-for="f in fields.slice(0, 8)" :key="f.key"
            >{{ f.label
            }}<FieldInput
              :field="f"
              :disabled="busy"
              :members="members"
              :model-value="newItem[f.key] ?? ''"
              @update:model-value="newItem[f.key] = $event"
          /></label>
          <div class="delivery-actions">
            <button type="button" :disabled="busy" @click="safeLeave">取消</button
            ><button class="primary-button" :disabled="busy">
              {{ busy ? '创建中…' : '创建开发项' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
