<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Plus,
  RefreshCw,
  Search,
} from '@lucide/vue';
import {
  HEALTH,
  PROJECT_STATUSES,
  PROJECT_TYPES,
} from '@sap-delivery-workbench/contracts/projects/options';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { api, can, identity } from '../../services/session';
import { loadProjects, projects as mine, selectProject } from '../../services/projectContext';
import { allows } from '../access/permissions';
import type { ProjectDetail } from '../projects/useProject';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useLoad, useSave } from '../settings/useLoad';
import ProjectDrawer from './ProjectDrawer.vue';
import ProjectEditDrawer from './ProjectEditDrawer.vue';
import { adminApi, type AdminUser, type Customer, type DirectoryProject } from './api';
import '../settings/settings.css';

// 企业 → 项目: every project of the organization as a settings list with its drawer like 大模型
// (DESIGN.md 6.2): a row opens the project's main data, “新建项目” creates one with its phases,
// milestones and manager, and “打开设置” switches to the project and opens its settings.
const router = useRouter();
const { data, loading, error, reload } = useLoad(adminApi.projects);
const customers = ref<Customer[]>([]);
const users = ref<AdminUser[]>([]);
onMounted(async () => {
  await reload();
  if (can('project:create')) {
    customers.value = (await adminApi.customers().catch(() => [])).filter(
      (c) => c.status === 'active',
    );
    users.value = can('user:view')
      ? (await adminApi.users().catch(() => [])).filter((u) => u.status === 'active')
      : [];
  }
});
const all = computed(() => data.value ?? []);
const count = (f: (p: DirectoryProject) => boolean) => all.value.filter(f).length;

const filter = ref('open');
const query = ref('');
const page = ref(1);
const filtered = computed(() =>
  all.value
    .filter((p) =>
      filter.value === 'open'
        ? p.status !== 'archived'
        : filter.value === 'archived'
          ? p.status === 'archived'
          : true,
    )
    .filter((p) =>
      (p.name + p.code + p.customerName + (p.managerName ?? ''))
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
    ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([filter, query], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
const statusTone = {
  preparing: 'purple',
  active: 'blue',
  live: 'green',
  completed: 'neutral',
  archived: 'neutral',
} as const;
const healthTone = { green: 'green', yellow: 'yellow', red: 'red' } as const;
const planned = (p: DirectoryProject) =>
  p.plannedStartDate || p.plannedEndDate
    ? `计划 ${p.plannedStartDate ?? '—'} 至 ${p.plannedEndDate ?? '—'}`
    : '';
// The drawer: a project's main data, or a new project; another row asks before dropping changes.
const open = ref(false);
const editing = ref<DirectoryProject | null>(null);
const drawer = ref<{ dirty: boolean; busy: boolean } | null>(null);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return (
    !drawer.value?.dirty ||
    (await askConfirmation(editing.value ? '放弃尚未保存的项目修改？' : '放弃尚未保存的新项目？'))
  );
}
async function edit(p: DirectoryProject | null) {
  if (open.value && p && editing.value?.id === p.id) return;
  if (open.value && !(await canLeave())) return;
  editing.value = p;
  open.value = true;
}
async function close() {
  if (await canLeave()) {
    open.value = false;
    editing.value = null;
  }
}
useDrawerLeave(canLeave, () => !!drawer.value?.dirty);
async function created() {
  open.value = false;
  toast('项目已创建，已生成 SAP Activate 阶段与预置里程碑。', 'green');
  await Promise.all([reload(), loadProjects()]);
}
async function saved() {
  open.value = false;
  editing.value = null;
  toast('项目信息已保存。', 'green');
  await Promise.all([reload(), loadProjects()]);
}
// What a row click did before the drawer: switch to the project and open its settings.
async function openSettings(p: DirectoryProject) {
  if (open.value) {
    if (!(await canLeave())) return;
    open.value = false;
    editing.value = null;
    await nextTick();
  }
  if (!mine.value.some((x) => x.id === p.id)) await loadProjects();
  await selectProject(p.id);
  await router.push('/settings/project/general');
}

// Archiving is one-way and needs project:archive in that project, read from its detail.
const action = useSave();
async function archive(p: DirectoryProject) {
  const detail = await action.run(() => api<ProjectDetail>('/projects/' + p.id));
  if (!detail) return;
  if (!allows(detail.access, 'project:archive', undefined, identity.value?.user.id)) {
    action.error.value = `你在项目“${p.name}”中没有归档项目的权限。`;
    return;
  }
  if (!(await askConfirmation(`归档“${p.name}”？归档后项目及其全部数据只读、不可恢复。`))) return;
  if (open.value && editing.value?.id === p.id) {
    if (!(await canLeave())) return;
    open.value = false;
    editing.value = null;
  }
  const done = await action.run(() =>
    api('/projects/' + p.id + '/archive', { rowVersion: detail.rowVersion }),
  );
  if (done) {
    toast('项目已归档，项目及其全部数据只读。', 'green');
    await Promise.all([reload(), loadProjects()]);
  }
}
const rowMenu = (p: DirectoryProject) => [
  {
    label: '归档',
    icon: Archive,
    danger: true,
    disabled: action.busy.value || p.status === 'archived',
    title: p.status === 'archived' ? '项目已归档' : '',
    run: () => archive(p),
  },
];
</script>
<template>
  <SettingsPage
    title="项目"
    description="企业的全部项目。点开一个项目查看与修改它的主数据；“打开设置”切换到该项目并打开它的设置。"
    list
    :drawer="open"
  >
    <template #actions>
      <button class="icon-button" aria-label="刷新项目列表" :disabled="loading" @click="reload">
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <p v-if="action.error.value" class="s-error" role="alert">{{ action.error.value }}</p>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <template v-if="data">
      <p class="s-summary">
        项目：<strong>{{ all.length }} 个</strong
        ><span
          >· 实施中 {{ count((p) => p.status === 'active') }} · 已上线
          {{ count((p) => p.status === 'live') }} · 健康度红
          {{ count((p) => p.health === 'red') }} · 未指定项目经理
          {{ count((p) => !p.managerName && p.status !== 'archived') }}</span
        >
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索项目"
            placeholder="搜索项目、客户或项目经理" /></label
        ><select v-model="filter" aria-label="项目筛选">
          <option value="open">进行中（{{ count((p) => p.status !== 'archived') }}）</option>
          <option value="archived">已归档（{{ count((p) => p.status === 'archived') }}）</option>
          <option value="all">全部（{{ all.length }}）</option>
        </select>
        <div v-if="can('project:create')" class="s-table-actions">
          <button class="primary-button" @click="edit(null)"><Plus :size="17" />新建项目</button>
        </div>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <FolderKanban :size="32" />
          <h2>{{ query ? '没有匹配的项目' : '这里还没有项目' }}</h2>
          <p>
            {{
              query
                ? '调整搜索或筛选条件后再试。'
                : filter === 'archived'
                  ? '归档的项目显示在这里。'
                  : '新建项目后显示在这里。'
            }}
          </p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>客户</th>
              <th>状态</th>
              <th>项目经理</th>
              <th class="hide-narrow">上线</th>
              <th>健康度</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in rows"
              :key="p.id"
              class="clickable"
              :class="{ selected: open && editing?.id === p.id }"
              @click="edit(p)"
            >
              <td>
                <button class="s-table-name" @click.stop="edit(p)">{{ p.name }}</button>
                <small class="mono">{{ p.code }}</small>
              </td>
              <td>
                <span>{{ p.customerName }}</span
                ><small>{{ PROJECT_TYPES[p.projectType as 'other'] }}</small>
              </td>
              <td>
                <div class="s-table-tags">
                  <BaseTag :tone="statusTone[p.status as 'active']">{{
                    PROJECT_STATUSES[p.status as 'active']
                  }}</BaseTag>
                  <BaseTag v-if="p.isPaused" tone="yellow">暂停</BaseTag>
                </div>
              </td>
              <td>
                <span :class="{ muted: !p.managerName }">{{ p.managerName ?? '未指定' }}</span
                ><small>{{ p.memberCount }} 名成员</small>
              </td>
              <td class="hide-narrow">
                <span :class="{ muted: !p.goLive }">{{ p.goLive ?? '—' }}</span
                ><small v-if="planned(p)">{{ planned(p) }}</small>
              </td>
              <td>
                <BaseTag v-if="p.health" :tone="healthTone[p.health as 'green']">{{
                  HEALTH[p.health as 'green']
                }}</BaseTag>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <div class="s-row-actions" @click.stop>
                  <button class="text-button" @click="openSettings(p)">打开设置</button>
                  <SettingsRowMenu :label="p.name + '的更多操作'" :items="rowMenu(p)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="s-table-footer">
          <span>共 {{ filtered.length }} 个项目</span>
          <div>
            <button class="icon-button" aria-label="上一页" :disabled="page === 1" @click="page--">
              <ChevronLeft :size="17" /></button
            ><span>{{ page }} / {{ pages }}</span
            ><button
              class="icon-button"
              aria-label="下一页"
              :disabled="page === pages"
              @click="page++"
            >
              <ChevronRight :size="17" />
            </button>
          </div>
        </footer>
      </div>
      <p class="s-table-note">
        点开项目查看与修改它的基本信息；成员、计划、SAP
        系统等在项目设置中维护。项目数据无限期保留，归档后只读、不可恢复，项目不删除。
      </p>
    </template>
    <ProjectEditDrawer
      v-if="open && editing"
      ref="drawer"
      :key="editing.id"
      :project="editing"
      @saved="saved"
      @settings="openSettings(editing)"
      @close="close"
    />
    <ProjectDrawer
      v-else-if="open"
      ref="drawer"
      key="new"
      :customers="customers"
      :users="users"
      @created="created"
      @close="close"
    />
  </SettingsPage>
</template>
