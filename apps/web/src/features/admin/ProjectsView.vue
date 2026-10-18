<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search } from '@lucide/vue';
import {
  HEALTH,
  PROJECT_STATUSES,
  PROJECT_TYPES,
} from '@sap-delivery-workbench/contracts/projects/options';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTabs from '../../components/base/BaseTabs.vue';
import BaseTable from '../../components/base/BaseTable.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { can } from '../../services/session';
import { loadProjects, projects as mine, selectProject } from '../../services/projectContext';
import SettingsPage from '../settings/SettingsPage.vue';
import StatGrid from '../settings/StatGrid.vue';
import { useLoad, useSave } from '../settings/useLoad';
import { adminApi, type AdminUser, type Customer, type DirectoryProject } from './api';
import '../settings/settings.css';

// 企业 → 项目: every project of the organization, creating projects (with phases, milestones and
// the project manager) and opening a project's settings.
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
const tab = ref('open');
const query = ref('');
const rows = computed(() => data.value ?? []);
const shown = computed(() =>
  rows.value
    .filter((p) =>
      tab.value === 'open'
        ? p.status !== 'archived'
        : tab.value === 'archived'
          ? p.status === 'archived'
          : true,
    )
    .filter((p) =>
      (p.name + p.code + p.customerName + (p.managerName ?? ''))
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
    ),
);
const tabs = computed(() => [
  { id: 'open', label: '进行中', count: rows.value.filter((p) => p.status !== 'archived').length },
  {
    id: 'archived',
    label: '已归档',
    count: rows.value.filter((p) => p.status === 'archived').length,
  },
  { id: 'all', label: '全部', count: rows.value.length },
]);
const stats = computed(() => [
  { label: '实施中', value: rows.value.filter((p) => p.status === 'active').length },
  { label: '已上线', value: rows.value.filter((p) => p.status === 'live').length },
  {
    label: '健康度红',
    value: rows.value.filter((p) => p.health === 'red').length,
    tone: rows.value.some((p) => p.health === 'red') ? ('red' as const) : undefined,
  },
  {
    label: '未指定项目经理',
    value: rows.value.filter((p) => !p.managerName && p.status !== 'archived').length,
  },
]);
const statusTone = {
  preparing: 'purple',
  active: 'blue',
  live: 'green',
  completed: 'neutral',
  archived: 'neutral',
} as const;
const healthTone = { green: 'green', yellow: 'yellow', red: 'red' } as const;
async function openProject(p: DirectoryProject) {
  if (!mine.value.some((x) => x.id === p.id)) await loadProjects();
  await selectProject(p.id);
  await router.push('/settings/project/general');
}

const creating = ref(false);
const draft = ref({
  customerId: '',
  code: '',
  name: '',
  shortName: '',
  projectType: 'implementation',
  plannedStartDate: '',
  plannedEndDate: '',
  managerId: '',
});
const save = useSave();
function openCreate() {
  save.error.value = '';
  draft.value = {
    customerId: customers.value[0]?.id ?? '',
    code: '',
    name: '',
    shortName: '',
    projectType: 'implementation',
    plannedStartDate: '',
    plannedEndDate: '',
    managerId: '',
  };
  creating.value = true;
}
async function create() {
  const created = await save.run(() =>
    adminApi.createProject({ ...draft.value, managerId: draft.value.managerId || null }),
  );
  if (created) {
    creating.value = false;
    toast('项目已创建，已生成 SAP Activate 阶段与预置里程碑。', 'green');
    await Promise.all([reload(), loadProjects()]);
  }
}
</script>
<template>
  <SettingsPage
    title="项目"
    description="企业的全部项目。点开一个项目会切换到它，并打开它的设置。"
    wide
  >
    <template #actions>
      <BaseButton v-if="can('project:create')" variant="primary" @click="openCreate"
        >新建项目</BaseButton
      >
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <template v-if="data">
      <StatGrid :stats="stats" />
      <div class="s-toolbar">
        <BaseTabs v-model="tab" :tabs="tabs" label="项目筛选" />
        <label class="s-search"
          ><Search :size="14" /><input
            v-model="query"
            placeholder="搜索项目、客户或项目经理"
            aria-label="搜索项目"
        /></label>
      </div>
      <div class="table-card">
        <BaseTable>
          <table>
            <thead>
              <tr>
                <th>项目</th>
                <th>客户</th>
                <th>类型</th>
                <th>状态</th>
                <th>项目经理</th>
                <th>成员</th>
                <th>上线</th>
                <th>健康度</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in shown"
                :key="p.id"
                class="clickable"
                tabindex="0"
                @click="openProject(p)"
                @keydown.enter="openProject(p)"
              >
                <td class="primary-cell">
                  {{ p.name }}<small class="sub">{{ p.code }}</small>
                </td>
                <td>{{ p.customerName }}</td>
                <td class="muted-cell">{{ PROJECT_TYPES[p.projectType as 'other'] }}</td>
                <td>
                  <BaseTag :tone="statusTone[p.status as 'active']">{{
                    PROJECT_STATUSES[p.status as 'active']
                  }}</BaseTag>
                  <BaseTag v-if="p.isPaused" tone="yellow">暂停</BaseTag>
                </td>
                <td :class="{ 'muted-cell': !p.managerName }">{{ p.managerName ?? '未指定' }}</td>
                <td class="muted-cell">{{ p.memberCount }}</td>
                <td class="muted-cell">{{ p.goLive ?? '—' }}</td>
                <td>
                  <BaseTag v-if="p.health" :tone="healthTone[p.health as 'green']">{{
                    HEALTH[p.health as 'green']
                  }}</BaseTag>
                  <span v-else class="muted-cell">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </BaseTable>
        <p v-if="!shown.length" class="empty-note">
          {{ query ? '没有匹配的项目。' : '这里还没有项目。' }}
        </p>
      </div>
    </template>

    <BaseDialog
      v-model:open="creating"
      title="新建项目"
      description="创建后自动生成 SAP Activate 六个阶段与九个预置里程碑；指定的项目经理会以“项目经理”角色加入项目。"
      wide
    >
      <form class="dialog-form" @submit.prevent="create">
        <label
          >客户<select v-model="draft.customerId" class="s-select" required>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select></label
        >
        <div class="s-grid-2">
          <label
            >项目编号<input v-model="draft.code" class="s-input mono" maxlength="32" required
          /></label>
          <label>简称<input v-model="draft.shortName" class="s-input" maxlength="20" /></label>
        </div>
        <label
          >项目名称<input v-model="draft.name" class="s-input" maxlength="200" required
        /></label>
        <div class="s-grid-2">
          <label
            >项目类型<select v-model="draft.projectType" class="s-select">
              <option v-for="(label, key) in PROJECT_TYPES" :key="key" :value="key">
                {{ label }}
              </option>
            </select></label
          >
          <label
            >项目经理<select v-model="draft.managerId" class="s-select">
              <option value="">稍后在成员中指定</option>
              <option v-for="u in users" :key="u.id" :value="u.id">
                {{ u.displayName }}{{ u.position ? ' · ' + u.position.name : '' }}
              </option>
            </select></label
          >
          <label
            >计划开始<input v-model="draft.plannedStartDate" class="s-input" type="date"
          /></label>
          <label
            >计划结束<input v-model="draft.plannedEndDate" class="s-input" type="date"
          /></label>
        </div>
        <p v-if="!customers.length" class="s-note">请先在“客户”中建立有效的客户。</p>
        <p v-if="save.error.value" class="s-error" role="alert">{{ save.error.value }}</p>
      </form>
      <template #footer>
        <BaseButton @click="creating = false">取消</BaseButton>
        <BaseButton
          variant="primary"
          :loading="save.busy.value"
          :disabled="!draft.customerId || !draft.code || !draft.name"
          @click="create"
          >创建</BaseButton
        >
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.table-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.clickable {
  cursor: pointer;
}
.clickable:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--focus);
}
.sub {
  display: block;
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-400);
}
td :deep(.base-tag) + :deep(.base-tag) {
  margin-left: var(--space-1);
}
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
.dialog-form {
  display: grid;
  gap: var(--space-3);
}
.dialog-form label {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
</style>
