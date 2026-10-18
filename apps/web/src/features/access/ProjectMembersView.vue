<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Search } from '@lucide/vue';
import { PERSON_TYPES } from '@sap-delivery-workbench/contracts/access/catalog';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseTabs from '../../components/base/BaseTabs.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { identity } from '../../services/session';
import { currentProject, loadProjectAccess } from '../../services/projectContext';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import StatGrid from '../settings/StatGrid.vue';
import { useSave } from '../settings/useLoad';
import ProjectGate from '../projects/ProjectGate.vue';
import { useProject } from '../projects/useProject';
import MemberDialog from './MemberDialog.vue';
import { accessApi, day, expiresSoon, type Candidate, type Member, type Role } from './api';
import '../settings/settings.css';

// 项目 → 成员与权限 (docs/specs/project-access-admin.md 2.4, 4.4).
const { project, loading, error, can, readOnly } = useProject();
const members = ref<Member[]>([]);
const roles = ref<Role[]>([]);
const candidates = ref<Candidate[]>([]);
const listError = ref('');
const manage = computed(() => can('project.member:manage') && !readOnly.value);
async function load() {
  const id = currentProject.value;
  if (!id || !project.value) return;
  listError.value = '';
  try {
    [members.value, roles.value] = await Promise.all([
      accessApi.members(id),
      accessApi.projectRoles(id),
    ]);
    candidates.value = manage.value ? await accessApi.candidates(id) : [];
  } catch (e) {
    listError.value = (e as Error).message;
  }
}
watch(project, load, { immediate: true });

const tab = ref('all');
const query = ref('');
const soon = (m: Member) => m.roles.some((r) => expiresSoon(r.validTo));
const shown = computed(() =>
  members.value
    .filter(
      (m) =>
        tab.value === 'all' || (tab.value === 'expiring' ? soon(m) : m.personType !== 'employee'),
    )
    .filter((m) =>
      (
        m.displayName +
        m.loginName +
        (m.positionName ?? '') +
        m.roles.map((r) => r.roleName).join('')
      )
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
    ),
);
const tabs = computed(() => [
  { id: 'all', label: '全部', count: members.value.length },
  { id: 'expiring', label: '即将到期', count: members.value.filter(soon).length },
  {
    id: 'external',
    label: '分包与外部',
    count: members.value.filter((m) => m.personType !== 'employee').length,
  },
]);
const stats = computed(() => [
  { label: '成员', value: members.value.length },
  {
    label: '项目经理',
    value: members.value.filter((m) => m.roles.some((r) => r.roleCode === 'C_PM')).length,
  },
  {
    label: '限定模块',
    value: members.value.filter((m) => m.roles.some((r) => r.modules.length)).length,
  },
  {
    label: '即将到期',
    value: members.value.filter(soon).length,
    tone: members.value.some(soon) ? ('yellow' as const) : undefined,
  },
]);

const dialog = ref(false);
const editing = ref<Member | null>(null);
function openAdd() {
  editing.value = null;
  dialog.value = true;
}
function openEdit(m: Member) {
  if (!manage.value || m.id === identity.value?.user.id) return;
  editing.value = m;
  dialog.value = true;
}
async function saved(next: Member[]) {
  members.value = next;
  toast('成员与角色已保存。', 'green');
  candidates.value = await accessApi.candidates(currentProject.value);
  void loadProjectAccess();
}
const removal = useSave();
async function remove(m: Member) {
  if (
    !(await askConfirmation(
      `把 ${m.displayName} 移出项目？其项目内角色与在本项目保存的 SAP 凭据会立即失效。`,
    ))
  )
    return;
  const next = await removal.run(() =>
    accessApi.removeMember(currentProject.value, m.id, m.rowVersion),
  );
  if (next) {
    members.value = next;
    dialog.value = false;
    candidates.value = await accessApi.candidates(currentProject.value);
    toast('已移出项目。', 'green');
  }
}
const canSensitive = (code: string) => can(code);
const scopeText = (m: Member) => {
  const r = m.roles[0];
  if (!r) return '';
  return [r.modules.length ? r.modules.join('、') : '全部模块', r.ownOnly ? '仅本人负责' : '']
    .filter(Boolean)
    .join(' · ');
};
</script>
<template>
  <SettingsPage
    title="成员与权限"
    description="谁在项目里、能做什么、在哪些模块上做，以及到什么时候。"
    wide
  >
    <template #actions>
      <BaseButton v-if="manage && project" variant="primary" @click="openAdd">添加成员</BaseButton>
    </template>
    <ProjectGate :loading="loading" :error="error" :ready="!!project" :archived="readOnly">
      <p v-if="listError" class="s-error" role="alert">{{ listError }}</p>
      <StatGrid :stats="stats" />
      <div class="s-toolbar">
        <BaseTabs v-model="tab" :tabs="tabs" label="成员筛选" />
        <label class="s-search"
          ><Search :size="14" /><input
            v-model="query"
            placeholder="搜索姓名、职位或角色"
            aria-label="搜索成员"
        /></label>
      </div>
      <SettingsCard flush>
        <div class="s-list">
          <button
            v-for="m in shown"
            :key="m.id"
            type="button"
            class="s-list-row member-row"
            :disabled="!manage || m.id === identity?.user.id"
            :title="m.id === identity?.user.id ? '不能修改自己的项目角色' : undefined"
            @click="openEdit(m)"
          >
            <BaseAvatar :name="m.displayName" :size="32" />
            <span class="s-list-main">
              <strong
                >{{ m.displayName
                }}<span v-if="m.id === identity?.user.id" class="you">（你）</span></strong
              >
              <small
                >{{ m.positionName ?? '未设职位' }} · {{ m.loginName
                }}<template v-if="m.personType !== 'employee'">
                  · {{ PERSON_TYPES[m.personType as 'employee'] }}</template
                ></small
              >
            </span>
            <span class="s-list-side">
              <BaseTag
                v-for="r in m.roles"
                :key="r.id"
                :tone="r.active ? 'blue' : 'neutral'"
                :strike="!r.active"
                >{{ r.roleName }}</BaseTag
              >
              <span>{{ scopeText(m) }}</span>
              <BaseTag v-if="soon(m)" tone="yellow">即将到期</BaseTag>
              <span v-if="m.roles[0]?.validTo">至 {{ day(m.roles[0].validTo) }}</span>
            </span>
          </button>
          <p v-if="!shown.length" class="empty-note">
            {{ query ? '没有匹配的成员。' : '这里还没有成员。' }}
          </p>
        </div>
      </SettingsCard>
      <p class="s-note">
        项目经理不必是企业管理员：持有“管理成员”的人就能在这里加人、分配角色。交付总监、PMO
        等跨项目岗位通过企业级角色访问项目，不在此列出。
      </p>
    </ProjectGate>
    <MemberDialog
      v-if="project"
      v-model:open="dialog"
      :project-id="project.id"
      :roles="roles"
      :modules="project.modules"
      :member="editing"
      :candidates="candidates"
      :can-sensitive="canSensitive"
      :removing="removal.busy.value"
      @saved="saved"
      @remove="remove"
    />
    <p v-if="removal.error.value" class="s-error" role="alert">{{ removal.error.value }}</p>
  </SettingsPage>
</template>
<style scoped>
.member-row:disabled {
  cursor: default;
}
.you {
  color: var(--text-muted);
  font-weight: var(--weight-400);
}
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
</style>
