<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { RouterLink, onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import {
  Plus,
  Trash2,
  X,
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
} from '@lucide/vue';
import BaseActionBar from '../../components/base/BaseActionBar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseMenu from '../../components/base/BaseMenu.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { moduleHue } from '../../components/base/identity';
import BaseMenuItem from '../../components/base/BaseMenuItem.vue';
import BaseMenuSeparator from '../../components/base/BaseMenuSeparator.vue';
import { toast as notify } from '../../components/base/toast';
import { detailOpen } from '../../services/shell';
import { activeTabId, switchingTab, useTabLeave } from '../../services/tabs';
import { useShortcut } from '../../services/shortcuts';
import ListReport from '../../components/list-report/ListReport.vue';
import { useListReport } from '../../components/list-report/useListReport';
import { api, ApiError, identity, type ProjectAccess } from '../../services/session';
import { allows } from '../access/permissions';
import {
  AGENT_STAGES,
  DEV_AGENT_KINDS,
  stageOwner,
  type AgentStage,
} from '@sap-delivery-workbench/contracts/delivery/fields';
import {
  FILTER_KEYS,
  atRisk,
  matchesFilter,
  pastGate,
  type OverviewFilter,
} from '@sap-delivery-workbench/contracts/delivery/overview';
import { currentProject, projects, leaveDelivery } from '../../services/projectContext';
import { askConfirmation } from '../../services/confirmation';
import {
  OPTIONS,
  PHASES,
  catalog,
  richText,
  sortValue,
  today,
  type CustomFieldDefinition,
  type Item,
  type ListContext,
  type Member,
  type Tag,
} from './model';
import { listFields } from './listFields';
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
  access = ref<ProjectAccess | null>(null),
  loading = ref(false),
  loaded = ref(false),
  busy = ref(false);
const error = ref('');
const checked = ref<string[]>([]);
const drawer = ref<InstanceType<typeof ItemDrawer> | null>(null);
const drawerId = ref<string | null>(null); // '' = creating
const dialog = ref<'' | 'batch' | 'import' | 'settings'>('');
const batchError = ref('');
const menu = ref('');

const fields = computed(() => catalog(customFields.value));
const ctx = computed<ListContext>(() => ({
  members: members.value,
  tags: tags.value,
  codeFreeze: freeze.value && !codeFreeze.value?.achievedOn ? freeze.value.date : null,
}));
const columns = computed(() => tableColumns(fields.value));
const base = computed(() => '/projects/' + currentProject.value + '/development-items');
const drawerItem = computed(() => items.value.find((i) => i.id === drawerId.value) ?? null);
// Contract 3.5: buttons follow the user's permissions in this project; edits and deletes also
// follow the module scope and "own items only" of their assignment. The API checks again.
const may = (code: string) => allows(access.value, code);
const ownersOf = (item: Item) =>
  [item.createdBy, ...Object.values(item.phases).map((p) => p.assigneeId)].filter(
    Boolean,
  ) as string[];
const mayOn = (code: string, item: Item) =>
  allows(
    access.value,
    code,
    { module: item.module, owners: ownersOf(item) },
    identity.value?.user.id,
  );
// A new item may only be filed under a module the person may create in (backlog BUG-004);
// an existing one can move to any module.
const drawerFields = computed(() =>
  drawerItem.value
    ? fields.value
    : fields.value.map((f) =>
        f.key === 'module'
          ? {
              ...f,
              options: Object.fromEntries(
                Object.entries((f.options ?? {}) as Record<string, string>).filter(([module]) =>
                  allows(access.value, 'delivery.item:create', { module }),
                ),
              ),
            }
          : f,
      ),
);
const checkedItems = computed(() => items.value.filter((i) => checked.value.includes(i.id)));
// The code freeze milestone (docs/modules/access.md 1.3): a countdown in the header,
// and how many items plan their development after it.
const codeFreeze = ref<{ plannedOn: string | null; achievedOn: string | null } | null>(null);
// Keyed milestone dates (achieved, else planned) for drill-down filters on phase gates.
const milestoneDates = ref<Record<string, string>>({});
async function loadFreeze(projectId: string) {
  try {
    const p = await api<{
      milestones: { key: string | null; plannedOn: string | null; achievedOn: string | null }[];
    }>('/projects/' + projectId);
    if (projectId !== currentProject.value) return;
    codeFreeze.value = p.milestones.find((m) => m.key === 'code_freeze') ?? null;
    milestoneDates.value = Object.fromEntries(
      p.milestones
        .filter((m) => m.key && (m.achievedOn || m.plannedOn))
        .map((m) => [m.key, (m.achievedOn ?? m.plannedOn)!]),
    );
  } catch {
    codeFreeze.value = null;
    milestoneDates.value = {};
  }
}
const freeze = computed(() => {
  const m = codeFreeze.value;
  if (!m || (!m.plannedOn && !m.achievedOn)) return null;
  if (m.achievedOn) return { text: '开发已冻结', tone: 'neutral' as const, date: m.achievedOn };
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((Date.parse(m.plannedOn!) - Date.parse(today)) / 86400000);
  return days < 0
    ? { text: '开发冻结已过 ' + -days + ' 天', tone: 'red' as const, date: m.plannedOn! }
    : {
        text: '距开发冻结 ' + days + ' 天',
        tone: days <= 14 ? ('yellow' as const) : ('blue' as const),
        date: m.plannedOn!,
      };
});
const lateItems = computed(() => {
  const date = freeze.value?.date;
  if (!date) return 0;
  return items.value.filter((i) => pastGate(i, 'development', { code_freeze: date })).length;
});

// --- the list report (docs/modules/list-report.md) -------------------------------------------
const me = computed(() => identity.value?.user.id);
const listScopes = computed(() => [
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
  { id: 'risk', name: '风险', test: (i: Item) => atRisk(i, today()) },
]);
const stateKey = () =>
  `delivery-filters:v3:${identity.value?.organization.id}:${identity.value?.user.id}:${currentProject.value}`;
const report = useListReport<Item>({
  listKey: 'delivery.items',
  rows: items,
  fields: computed(() => listFields(fields.value, ctx.value)),
  columns,
  scopes: listScopes,
  searchText: (i) =>
    [i.code, i.name, i.module, i.transactionCode, ...i.objects.map((o) => o.objectName)].join(' '),
  compare(a, b, key) {
    const field = fields.value.find((f) => f.key === key);
    if (!field) return 0;
    const x = sortValue(a, field, ctx.value),
      y = sortValue(b, field, ctx.value);
    return typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y), 'zh-CN', { numeric: true });
  },
  today,
  stateKey,
  layoutKey: () =>
    `delivery-columns:v2:${identity.value?.organization.id}:${identity.value?.user.id}:${currentProject.value}`,
  viewsUrl: () =>
    currentProject.value ? `/projects/${currentProject.value}/list-views/delivery.items` : null,
});
const { filtered, pageRows: rows } = report;
watch(report.queryKey, () => {
  if (checked.value.length) checked.value = [];
});

// --- links from the assistant pages ------------------------------------------------------
// ?project=&item=&section= opens that item's drawer at a section (e.g. 成果, spec 6.3). While a
// drawer is open the address names its item, so Back from an assistant page, or a reload, opens
// it again.
const route = useRoute(),
  router = useRouter();
const link = {
  project: typeof route.query.project === 'string' ? route.query.project : '',
  item: typeof route.query.item === 'string' ? route.query.item : '',
  section: typeof route.query.section === 'string' ? route.query.section : '',
};
const drawerSection = ref('');
// The project list may load (and pick the default project) after this view: switch to the
// linked project once it is known, and open the drawer only from that project's items.
watch(
  [projects, currentProject],
  () => {
    if (
      link.item &&
      link.project &&
      currentProject.value !== link.project &&
      projects.value.some((p) => p.id === link.project)
    )
      currentProject.value = link.project;
  },
  { immediate: true },
);
// The list may reload while the project context settles (and a reload closes the drawer):
// the link holds until the reader closes the drawer or opens another item.
function followLink() {
  if (!link.item || (link.project && currentProject.value !== link.project)) return;
  if (drawerId.value === null && items.value.some((i) => i.id === link.item)) {
    drawerId.value = link.item;
    drawerSection.value = link.section;
  }
}

// --- drill-down from the development overview and the load table ------------------------
// ?project=&from=overview|load&label=&<filter keys> (docs/modules/development-overview.md 8,
// development-load.md): the address wins over the filters saved for this project, which are
// cleared while it applies.
const DRILL_SOURCES: Record<string, string> = { overview: '开发概览', load: '开发排期' };
// A list opened by a drill-down stands apart: its filters are not saved over the ones of the
// list the reader keeps, and only its own tab's address applies to it (another tab's list, kept
// alive behind, sees the same route change).
const ownTab = activeTabId.value;
let pendingDrill: {
  project: string;
  filter: OverviewFilter;
  label: string;
  source: string;
} | null = null;
function readDrill(query: typeof route.query) {
  const source = DRILL_SOURCES[String(query.from)];
  if (!source) return null;
  const text = (key: string) => (typeof query[key] === 'string' ? (query[key] as string) : '');
  const filter: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const value = text(key);
    if (!value) continue;
    filter[key] = ['ids', 'modules'].includes(key)
      ? value.split(',')
      : ['due', 'gap', 'gate', 'awaiting', 'unassigned', 'active', 'unplanned'].includes(key)
        ? value === '1'
        : value;
  }
  return {
    project: text('project'),
    filter: filter as OverviewFilter,
    label: text('label') || '筛选',
    source,
  };
}
function applyDrill() {
  const drill = pendingDrill;
  if (!drill || (drill.project && currentProject.value !== drill.project)) return;
  pendingDrill = null;
  report.drill({
    label: `来自${drill.source}：${drill.label}`,
    test: (item) =>
      matchesFilter(item, drill.filter, { today: today(), milestones: milestoneDates.value }),
  });
}
watch(
  () => route.query,
  (query) => {
    if (activeTabId.value !== ownTab) return;
    const drill = readDrill(query);
    if (!drill) return;
    pendingDrill = drill;
    if (
      drill.project &&
      currentProject.value !== drill.project &&
      projects.value.some((p) => p.id === drill.project)
    )
      currentProject.value = drill.project;
    else applyDrill();
  },
  { immediate: true },
);

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
      access: ProjectAccess;
    }>(base.value);
    if (request !== generation) return;
    items.value = result.items;
    members.value = result.members;
    tags.value = result.tags;
    customFields.value = result.fields;
    readOnly.value = result.readOnly;
    access.value = result.access;
    loaded.value = true;
    followLink();
    void loadFreeze(currentProject.value);
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
    report.enter();
    applyDrill();
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
// Bringing another tab forward keeps this page as it is; closing its tab asks (workbench-tabs.md 4, 5).
onBeforeRouteLeave(() => switchingTab() || safeLeave());
useTabLeave(safeLeave);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
// A record open beside the list asks the shell for room (DESIGN.md 4.1).
watch(drawerId, (id) => (detailOpen.value = id !== null), { immediate: true });
// Kept in a tab behind another, the page gives the room, the page header and the project guard
// back (a teleported header would otherwise stay on the other tab).
const inFront = ref(true);
onDeactivated(() => {
  inFront.value = false;
  detailOpen.value = false;
  if (leaveDelivery.value === safeLeave) leaveDelivery.value = null;
});
onActivated(() => {
  inFront.value = true;
  detailOpen.value = drawerId.value !== null;
  leaveDelivery.value = safeLeave;
});
watch(drawerId, (id) => {
  if (!inFront.value || (route.query.item ?? '') === (id ?? '')) return;
  const query = id ? { project: currentProject.value, item: id } : {};
  void router.replace({ query }).catch(() => {});
});
onBeforeUnmount(() => {
  detailOpen.value = false;
  generation++;
  window.removeEventListener('beforeunload', beforeUnload);
  if (leaveDelivery.value === safeLeave) leaveDelivery.value = null;
});

// --- drawer and single-item actions ------------------------------------------------------
async function open(id: string) {
  if (drawerId.value === id || !(await safeLeave())) return;
  link.item = '';
  menu.value = '';
  drawerId.value = id;
}
async function openCreate() {
  if (!(await safeLeave())) return;
  drawerId.value = '';
}
async function closeDrawer() {
  if (!(await safeLeave())) return;
  link.item = '';
  drawerId.value = null;
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
// Entry to the assistants follows agent.*:run on the item, owned by the stage's assignee
// (else the creator) as the API decides; agent.*:view reads the outputs in the drawer.
const mayRun = (item: Item, stage: AgentStage) =>
  allows(
    access.value,
    AGENT_STAGES[stage].agent + ':run',
    {
      module: item.module,
      owners: [
        stageOwner(item.phases[AGENT_STAGES[stage].phase]?.assigneeId, item.createdBy),
      ].filter(Boolean) as string[],
    },
    identity.value?.user.id,
  );
const agentAccess = (item: Item) => ({
  design: { run: mayRun(item, 'design'), view: may('agent.fsd:view') },
  development: { run: mayRun(item, 'development'), view: may('agent.dev:view') },
});
const noRun = {
  design: '你没有使用设计助手的权限，可在开发项的“成果”中查看功能说明书',
  development: '你没有使用开发助手的权限，可在开发项的“成果”中查看开发方案与代码',
};
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
    const keys = report.shownKeys.value.filter((k) => k !== 'actions');
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
// The list's keys (DESIGN.md 1.5): N new, J / K next and previous item while one is open, Esc
// closes it; ListReport handles F (filter bar) and V (columns).
function step(direction: number) {
  if (!drawerId.value) return;
  const index = rows.value.findIndex((i) => i.id === drawerId.value);
  const next = rows.value[index + direction];
  if (next) void open(next.id);
}
useShortcut(
  'N',
  () => !readOnly.value && loaded.value && may('delivery.item:create') && void openCreate(),
);
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
  <div class="delivery-page">
    <!-- The page header names the page; its actions sit on the right of it (DESIGN.md 6.1). -->
    <h1 class="sr-only">开发清单</h1>
    <Teleport v-if="inFront" defer to="#page-actions">
      <BaseTag v-if="freeze" :tone="freeze.tone" :title="'开发冻结计划日期 ' + freeze.date">{{
        freeze.text
      }}</BaseTag>
      <span
        v-if="lateItems"
        class="list-late"
        :title="'开发阶段计划完成日期晚于开发冻结（' + freeze?.date + '）'"
        >{{ lateItems }} 项开发计划晚于冻结</span
      >
      <BaseMenu align="end">
        <template #trigger>
          <BaseButton :disabled="!loaded || busy"
            ><template #icon><FileSpreadsheet /></template>导入 / 导出</BaseButton
          >
        </template>
        <BaseMenuItem
          tone="blue"
          :disabled="readOnly || !may('delivery.item:import')"
          @select="dialog = 'import'"
          ><template #icon><FileUp /></template>从 Excel 导入</BaseMenuItem
        >
        <BaseMenuItem
          tone="blue"
          :disabled="!may('delivery.item:import')"
          @select="downloadTemplate"
          ><template #icon><FileDown /></template>下载导入模板</BaseMenuItem
        >
        <BaseMenuItem
          tone="green"
          :disabled="!filtered.length || !may('delivery.item:export')"
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
        :disabled="readOnly || !loaded || !may('delivery.item:create')"
        @click="openCreate"
        ><template #icon><Plus /></template>新建开发项</BaseButton
      >
    </Teleport>
    <p v-if="error" class="error-note" role="alert">
      {{ error }}<button class="text-button" @click="load()">重新加载</button>
    </p>
    <p v-if="readOnly && loaded" class="help-note">此项目已归档，只能查看。</p>

    <ListReport
      v-model:checked="checked"
      :report="report"
      scope-label="清单范围"
      search-placeholder="编号、名称、事务码或开发对象"
      width-key="delivery-list-width"
      :current-id="drawerId ?? undefined"
      :split="drawerId !== null"
      :compact-keys="['code', 'name', 'fsd.status']"
      :loading="loading"
      :skeleton="loading && !loaded"
      :view-key="stateKey()"
      :disabled="busy"
      :empty-text="
        !currentProject
          ? '选择项目后开始维护开发清单'
          : !items.length
            ? '还没有开发项'
            : '没有符合条件的开发项'
      "
      @open="open($event.id)"
      @refresh="load()"
    >
      <template #mobile-row="{ row: item }">
        <div class="mobile-item">
          <button class="mobile-title" @click="open(item.id)">
            {{ item.code }} {{ item.name }}
          </button>
          <span v-if="summary(item)" class="name-sub">{{ summary(item) }}</span>
          <div class="mobile-meta">
            <BaseTag v-if="item.module" :tone="moduleHue(item.module)">{{ item.module }}</BaseTag
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
            v-if="mayRun(item, 'design')"
            class="row-icon"
            :to="`/projects/${currentProject}/development-items/${item.id}/design`"
            :aria-label="'设计 ' + item.code"
            title="设计"
            ><Sparkles
          /></RouterLink>
          <button
            v-else
            type="button"
            class="row-icon"
            aria-disabled="true"
            :aria-label="'设计 ' + item.code + '（无权限）'"
            :title="noRun.design"
          >
            <Sparkles />
          </button>
          <button
            v-if="DEV_AGENT_KINDS.includes(item.kind) && !mayRun(item, 'development')"
            type="button"
            class="row-icon"
            aria-disabled="true"
            :aria-label="'开发 ' + item.code + '（无权限）'"
            :title="noRun.development"
          >
            <Code2 />
          </button>
          <RouterLink
            v-else-if="DEV_AGENT_KINDS.includes(item.kind)"
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
              :disabled="readOnly || busy || !may('delivery.item:create')"
              @select="((checked = [item.id]), batchCopy())"
              ><template #icon><Copy /></template>复制</BaseMenuItem
            >
            <BaseMenuItem
              danger
              :disabled="readOnly || busy || !mayOn('delivery.item:delete', item)"
              @select="removeOne(item)"
              ><template #icon><Trash2 /></template>删除</BaseMenuItem
            >
          </BaseMenu>
        </div>
        <InlineCell
          v-else-if="fields.find((f) => f.key === column.key)"
          :item="item"
          :field="fields.find((f) => f.key === column.key)!"
          :ctx="ctx"
          :read-only="readOnly || busy || !mayOn('delivery.item:edit', item)"
          :save="saveCell"
        />
      </template>
      <template #empty="{ hasFilters }">
        <BaseButton v-if="hasFilters" size="sm" @click="report.clearAll">清除所有筛选</BaseButton>
        <BaseButton
          v-else-if="
            currentProject && !items.length && !readOnly && loaded && may('delivery.item:create')
          "
          size="sm"
          data-keep-drawer
          @click="openCreate"
          ><template #icon><Plus /></template>新建第一个开发项</BaseButton
        >
      </template>
      <template #detail>
        <ItemDrawer
          v-if="drawerId !== null && currentProject"
          :key="drawerId === '' ? 'new' : 'item'"
          ref="drawer"
          :item="drawerItem"
          :fields="drawerFields"
          :ctx="ctx"
          :base="base"
          :project-id="currentProject"
          :read-only="
            readOnly ||
            (drawerItem ? !mayOn('delivery.item:edit', drawerItem) : !may('delivery.item:create'))
          "
          :create-tag="createTag"
          :agents="drawerItem ? agentAccess(drawerItem) : undefined"
          :section="drawerSection"
          @close="closeDrawer"
          @saved="saved"
          @delete="removeOne"
          @agent="comingSoon"
        />
      </template>
    </ListReport>

    <div v-if="checked.length" class="batch-dock">
      <BaseActionBar>
        <div>
          <span class="batch-count" role="status">已选 {{ checked.length }} 项</span>
          <BaseButton
            variant="ghost"
            :disabled="
              readOnly || busy || !checkedItems.every((i) => mayOn('delivery.item:edit', i))
            "
            @click="((batchError = ''), (dialog = 'batch'))"
            ><template #icon><PenSquare /></template>批量修改</BaseButton
          >
          <BaseButton
            variant="ghost"
            :disabled="readOnly || busy || !may('delivery.item:create')"
            @click="batchCopy"
            ><template #icon><Copy /></template>复制</BaseButton
          >
          <BaseButton
            variant="ghost"
            :disabled="busy || !may('delivery.item:export')"
            @click="exportExcel(checked, `选中的 ${checked.length} 项`)"
            ><template #icon><FileDown /></template>导出</BaseButton
          >
          <BaseButton
            variant="danger"
            :disabled="
              readOnly || busy || !checkedItems.every((i) => mayOn('delivery.item:delete', i))
            "
            @click="batchDelete"
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
      :can-configure="may('delivery.config:manage')"
      :read-only="readOnly"
      @close="dialog = ''"
      @changed="load()"
    />
  </div>
</template>
