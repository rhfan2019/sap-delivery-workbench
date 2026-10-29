<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, UserMinus, Users } from '@lucide/vue';
import { PERSON_TYPES } from '@sap-delivery-workbench/contracts/access/catalog';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { identity } from '../../services/session';
import { currentProject, loadProjectAccess } from '../../services/projectContext';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useSave } from '../settings/useLoad';
import ProjectGate from '../projects/ProjectGate.vue';
import { useProject } from '../projects/useProject';
import MemberDrawer from './MemberDrawer.vue';
import { accessApi, day, expiresSoon, type Candidate, type Member, type Role } from './api';
import '../settings/settings.css';

// 项目 → 成员与权限 (docs/specs/project-access-admin.md 2.4, 4.4): a settings list with its
// drawer, laid out like 大模型 (DESIGN.md 6.2).
const { project, loading, error, can, readOnly } = useProject();
const members = ref<Member[]>([]);
const roles = ref<Role[]>([]);
const candidates = ref<Candidate[]>([]);
const listError = ref('');
const refreshing = ref(false);
const manage = computed(() => can('project.member:manage') && !readOnly.value);
async function load() {
  const id = currentProject.value;
  if (!id || !project.value) return;
  listError.value = '';
  refreshing.value = true;
  try {
    [members.value, roles.value] = await Promise.all([
      accessApi.members(id),
      accessApi.projectRoles(id),
    ]);
    candidates.value = manage.value ? await accessApi.candidates(id) : [];
  } catch (e) {
    listError.value = (e as Error).message;
  } finally {
    refreshing.value = false;
  }
}
watch(project, load, { immediate: true });

const filter = ref('');
const query = ref('');
const page = ref(1);
const soon = (m: Member) => m.roles.some((r) => expiresSoon(r.validTo));
const external = (m: Member) => m.personType !== 'employee';
const filtered = computed(() =>
  members.value
    .filter((m) => !filter.value || (filter.value === 'expiring' ? soon(m) : external(m)))
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
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([filter, query], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
const managers = computed(
  () => members.value.filter((m) => m.roles.some((r) => r.roleCode === 'C_PM')).length,
);
const limited = computed(
  () => members.value.filter((m) => m.roles.some((r) => r.modules.length)).length,
);
const expiring = computed(() => members.value.filter(soon).length);

// The drawer: one member at a time; another row or “添加成员” asks before dropping changes.
const open = ref(false);
const editing = ref<Member | null>(null);
const drawer = ref<InstanceType<typeof MemberDrawer> | null>(null);
const self = (m: Member) => m.id === identity.value?.user.id;
async function canLeave() {
  if (drawer.value?.busy) return false;
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的成员修改？'));
}
async function edit(m: Member | null) {
  if (!manage.value || (m && self(m))) return;
  if (open.value && editing.value?.id === m?.id && m) return;
  if (open.value && !(await canLeave())) return;
  editing.value = m;
  open.value = true;
}
async function close() {
  if (await canLeave()) {
    open.value = false;
    editing.value = null;
  }
}
useDrawerLeave(canLeave, () => !!drawer.value?.dirty);
async function saved(next: Member[]) {
  members.value = next;
  open.value = false;
  editing.value = null;
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
    if (editing.value?.id === m.id) {
      open.value = false;
      editing.value = null;
    }
    candidates.value = await accessApi.candidates(currentProject.value);
    toast('已移出项目。', 'green');
  }
}
const rowMenu = (m: Member) => [
  {
    label: '移出项目',
    icon: UserMinus,
    danger: true,
    disabled: removal.busy.value,
    run: () => remove(m),
  },
];
const canSensitive = (code: string) => can(code);
const scopeText = (m: Member) => {
  const r = m.roles[0];
  if (!r) return '—';
  return r.modules.length ? r.modules.join('、') : '全部模块';
};
</script>
<template>
  <SettingsPage
    title="成员与权限"
    description="谁在项目里、能做什么、在哪些模块上做，以及到什么时候。"
    list
    :drawer="open"
  >
    <template #actions>
      <button
        class="icon-button"
        aria-label="刷新成员列表"
        :disabled="refreshing || !project"
        @click="load"
      >
        <RefreshCw :size="18" />
      </button>
    </template>
    <ProjectGate :loading="loading" :error="error" :ready="!!project" :archived="readOnly">
      <p v-if="listError" class="s-error" role="alert">{{ listError }}</p>
      <p v-if="removal.error.value" class="s-error" role="alert">{{ removal.error.value }}</p>
      <p class="s-summary">
        成员：<strong>{{ members.length }} 人</strong
        ><span>· 项目经理 {{ managers }} · 限定模块 {{ limited }} · 即将到期 {{ expiring }}</span>
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索成员"
            placeholder="搜索姓名、职位或角色" /></label
        ><select v-model="filter" aria-label="筛选成员">
          <option value="">全部成员</option>
          <option value="expiring">即将到期</option>
          <option value="external">分包与外部</option>
        </select>
        <div v-if="manage" class="s-table-actions">
          <button class="primary-button" @click="edit(null)"><Plus :size="17" />添加成员</button>
        </div>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <Users :size="32" />
          <h2>{{ query || filter ? '没有匹配的成员' : '这里还没有成员' }}</h2>
          <p>
            {{
              query || filter
                ? '调整搜索或筛选条件后再试。'
                : '添加成员并分配项目角色后显示在这里。'
            }}
          </p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th>成员</th>
              <th>项目角色</th>
              <th class="hide-narrow">范围</th>
              <th>有效期</th>
              <th v-if="manage" class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in rows"
              :key="m.id"
              :class="{ clickable: manage && !self(m), selected: open && editing?.id === m.id }"
              @click="edit(m)"
            >
              <td>
                <div class="s-table-person">
                  <BaseAvatar :name="m.displayName" :size="32" />
                  <div>
                    <button
                      class="s-table-name"
                      :disabled="!manage || self(m)"
                      :title="self(m) ? '不能修改自己的项目角色' : undefined"
                      @click.stop="edit(m)"
                    >
                      {{ m.displayName }}</button
                    ><span v-if="self(m)" class="s-badge muted">你</span>
                    <small
                      >{{ m.positionName ?? '未设职位' }} · {{ m.loginName
                      }}<template v-if="external(m)">
                        · {{ PERSON_TYPES[m.personType as 'employee'] }}</template
                      ></small
                    >
                  </div>
                </div>
              </td>
              <td>
                <div class="s-table-tags">
                  <BaseTag
                    v-for="r in m.roles"
                    :key="r.id"
                    :tone="r.active ? 'blue' : 'neutral'"
                    :strike="!r.active"
                    >{{ r.roleName }}</BaseTag
                  >
                </div>
              </td>
              <td class="hide-narrow">
                <span>{{ scopeText(m) }}</span
                ><small v-if="m.roles[0]?.ownOnly">仅本人负责</small>
              </td>
              <td>
                <span v-if="soon(m)" class="s-badge warning">即将到期</span
                ><span v-else>{{
                  m.roles[0]?.validTo ? '至 ' + day(m.roles[0].validTo) : '长期'
                }}</span
                ><small>自 {{ day(m.roles[0]?.validFrom) || day(m.joinedAt) }}</small>
              </td>
              <td v-if="manage">
                <div v-if="!self(m)" class="s-row-actions" @click.stop>
                  <button class="text-button" @click="edit(m)">编辑</button>
                  <SettingsRowMenu :label="m.displayName + '的更多操作'" :items="rowMenu(m)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="s-table-footer">
          <span>共 {{ filtered.length }} 名成员</span>
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
        项目经理不必是企业管理员：持有“管理成员”的人就能在这里加人、分配角色。交付总监、PMO
        等跨项目岗位通过企业级角色访问项目，不在此列出。
      </p>
    </ProjectGate>
    <MemberDrawer
      v-if="project && open"
      ref="drawer"
      :key="editing?.id ?? 'new'"
      :project-id="project.id"
      :roles="roles"
      :modules="project.modules"
      :member="editing"
      :candidates="candidates"
      :can-sensitive="canSensitive"
      @saved="saved"
      @close="close"
    />
  </SettingsPage>
</template>
<style scoped>
.s-badge.warning {
  margin-left: 0;
}
</style>
