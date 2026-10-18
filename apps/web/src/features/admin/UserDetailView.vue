<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  PERMISSIONS,
  PERSON_TYPES,
  PROJECT_SCOPES,
} from '@sap-delivery-workbench/contracts/access/catalog';
import { SAP_MODULES } from '@sap-delivery-workbench/contracts/projects/options';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { can, identity } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import ChoiceChips from '../settings/ChoiceChips.vue';
import { useSave } from '../settings/useLoad';
import {
  accessApi,
  day,
  expiresSoon,
  type Assignment,
  type Position,
  type Role,
  type Source,
  type UserAccess,
} from '../access/api';
import { adminApi, type AdminUser, type Customer, type DirectoryProject } from './api';
import '../settings/settings.css';

// One account (docs/specs/project-access-admin.md 2.6–2.8): the account, its position, its
// organization roles with their project scope, its project roles, and every effective
// permission with where it comes from.
const route = useRoute();
const id = computed(() => String(route.params.id));
const user = ref<AdminUser | null>(null);
const access = ref<UserAccess | null>(null);
const positions = ref<Position[]>([]);
const roles = ref<Role[]>([]);
const customers = ref<Customer[]>([]);
const projects = ref<DirectoryProject[]>([]);
const error = ref('');
const loading = ref(false);
const form = ref({
  displayName: '',
  email: '',
  status: 'active',
  personType: 'employee',
  positionId: '',
  skillModules: [] as string[],
  grantPositionRoles: false,
});
function reset(u: AdminUser) {
  form.value = {
    displayName: u.displayName,
    email: u.email ?? '',
    status: u.status,
    personType: u.personType,
    positionId: u.position?.id ?? '',
    skillModules: [...u.skillModules],
    grantPositionRoles: false,
  };
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    user.value = await adminApi.user(id.value);
    reset(user.value);
    access.value = await accessApi.userAccess(id.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(id, load, { immediate: true });
watch(
  () => user.value?.id,
  async () => {
    if (!positions.value.length) positions.value = await accessApi.positions().catch(() => []);
    if (can('assignment:manage') && !roles.value.length) {
      roles.value = await accessApi.roles().catch(() => []);
      customers.value = await adminApi.customers().catch(() => []);
      projects.value = await adminApi.projects().catch(() => []);
    }
  },
);
const self = computed(() => user.value?.id === identity.value?.user.id);
const editable = computed(() => can('user:manage'));
const accountDirty = computed(() => {
  const u = user.value;
  if (!u) return false;
  const f = form.value;
  return (
    f.displayName !== u.displayName ||
    f.email !== (u.email ?? '') ||
    f.status !== u.status ||
    f.personType !== u.personType ||
    f.positionId !== (u.position?.id ?? '') ||
    JSON.stringify(f.skillModules) !== JSON.stringify(u.skillModules) ||
    f.grantPositionRoles
  );
});
const position = computed(() => positions.value.find((p) => p.id === form.value.positionId));
const save = useSave();
async function saveAccount() {
  const u = user.value!;
  const result = await save.run(() =>
    adminApi.saveUser(u.id, {
      ...form.value,
      positionId: form.value.positionId || null,
      grantPositionRoles: form.value.personType === 'employee' && form.value.grantPositionRoles,
      rowVersion: u.rowVersion,
    }),
  );
  if (result) {
    user.value = result.user;
    reset(result.user);
    access.value = await accessApi.userAccess(u.id);
    toast(
      result.granted.length ? '已保存，并授予：' + result.granted.join('、') : '账号已保存。',
      'green',
    );
  }
}
const reset1 = useSave();
const temporary = ref('');
async function resetPassword() {
  const u = user.value!;
  if (!(await askConfirmation(`为 ${u.displayName} 生成新的临时密码？其所有登录会立即失效。`)))
    return;
  const result = await reset1.run(() => adminApi.resetPassword(u.id, u.rowVersion));
  if (result) {
    temporary.value = result.temporaryPassword;
    user.value = await adminApi.user(u.id);
  }
}
const purge = useSave();
async function purgeSap() {
  const u = user.value!;
  if (
    !(await askConfirmation(
      `清除 ${u.displayName} 在所有项目保存的 SAP 凭据？本人需要重新登录各系统。`,
    ))
  )
    return;
  const result = await purge.run(() => adminApi.purgeSapCredentials(u.id));
  if (result) toast(`已清除 ${result.removed} 条保存的 SAP 凭据。`, 'green');
}

// Organization roles.
const orgRoles = computed(() =>
  roles.value.filter((r) => r.scope === 'organization' && r.status === 'active'),
);
const editing = ref<{
  id?: string;
  roleId: string;
  projectScope: string;
  scopeIds: string[];
  validFrom: string;
  validTo: string;
  rowVersion?: string;
} | null>(null);
const assign = useSave();
function openAssignment(a?: Assignment) {
  assign.error.value = '';
  editing.value = a
    ? {
        id: a.id,
        roleId: a.roleId,
        projectScope: a.projectScope,
        scopeIds: [...a.scopeIds],
        validFrom: day(a.validFrom),
        validTo: day(a.validTo),
        rowVersion: a.rowVersion,
      }
    : {
        roleId: orgRoles.value[0]?.id ?? '',
        projectScope: 'all',
        scopeIds: [],
        validFrom: '',
        validTo: '',
      };
}
async function saveAssignment() {
  const e = editing.value!;
  const body = { ...e, validFrom: e.validFrom || undefined, validTo: e.validTo || null };
  const next = await assign.run(() =>
    e.id ? accessApi.saveAssignment(e.id, body) : accessApi.assign(user.value!.id, body),
  );
  if (next) {
    editing.value = null;
    access.value = await accessApi.userAccess(user.value!.id);
    user.value = await adminApi.user(user.value!.id);
    toast('企业级角色已保存。', 'green');
  }
}
async function revoke(a: Assignment) {
  if (!(await askConfirmation(`撤销 ${user.value!.displayName} 的“${a.roleName}”？`))) return;
  if (await assign.run(() => accessApi.revoke(a.id, a.rowVersion))) {
    editing.value = null;
    access.value = await accessApi.userAccess(user.value!.id);
    user.value = await adminApi.user(user.value!.id);
  }
}
const scopeObjects = computed(() =>
  editing.value?.projectScope === 'customers'
    ? customers.value.map((c) => ({ value: c.id, label: c.name }))
    : projects.value
        .filter((p) => p.status !== 'archived')
        .map((p) => ({ value: p.id, label: p.name })),
);
const scopeText = (a: Assignment) => {
  if (a.projectScope === 'customers')
    return (
      '客户：' +
      a.scopeIds.map((x) => customers.value.find((c) => c.id === x)?.name ?? '…').join('、')
    );
  if (a.projectScope === 'projects')
    return (
      '项目：' +
      a.scopeIds.map((x) => projects.value.find((p) => p.id === x)?.name ?? '…').join('、')
    );
  return PROJECT_SCOPES[a.projectScope];
};

// Effective permissions.
const label = (code: string) => PERMISSIONS.find((p) => p.code === code)?.label ?? code;
const via = (sources: Source[]) =>
  [
    ...new Set(
      sources.map(
        (s) =>
          s.roleName +
          (s.modules.length ? '（' + s.modules.join('、') + '）' : '') +
          (s.ownOnly ? '（仅本人）' : ''),
      ),
    ),
  ].join('、');
const moduleOptions = SAP_MODULES.map((m) => ({ value: m, label: m }));
</script>
<template>
  <SettingsPage
    :title="user?.displayName ?? '用户'"
    :description="user ? user.loginName + (user.email ? ' · ' + user.email : '') : ''"
    :back="{ to: '/settings/users', label: '用户' }"
  >
    <template #actions>
      <BaseButton
        v-if="user && can('user.password:reset') && !self"
        :loading="reset1.busy.value"
        @click="resetPassword"
        >重置密码</BaseButton
      >
    </template>
    <p v-if="error || reset1.error.value" class="s-error" role="alert">
      {{ error || reset1.error.value }}
    </p>
    <BaseSkeleton v-if="loading && !user" height="240px" />
    <template v-if="user">
      <SettingsCard
        title="账号与岗位"
        :editable="editable"
        :dirty="accountDirty"
        :saving="save.busy.value"
        :error="save.error.value"
        @save="saveAccount"
      >
        <SettingsField label="姓名" for="u-name">
          <input
            id="u-name"
            v-model="form.displayName"
            class="s-input"
            maxlength="100"
            :disabled="!editable"
          />
        </SettingsField>
        <SettingsField label="邮箱" for="u-email">
          <input
            id="u-email"
            v-model="form.email"
            class="s-input"
            type="email"
            maxlength="254"
            :disabled="!editable"
          />
        </SettingsField>
        <SettingsField label="账号状态" help="停用后立即退出所有登录，并清除其保存的 SAP 凭据。">
          <label class="s-check"
            ><input
              type="checkbox"
              :checked="form.status === 'active'"
              :disabled="!editable || self"
              @change="form.status = form.status === 'active' ? 'disabled' : 'active'"
            />启用</label
          >
        </SettingsField>
        <SettingsField label="人员类型" for="u-type" help="分包与外部人员的角色必须设结束日期。">
          <select id="u-type" v-model="form.personType" class="s-select" :disabled="!editable">
            <option v-for="(text, key) in PERSON_TYPES" :key="key" :value="key">{{ text }}</option>
          </select>
        </SettingsField>
        <SettingsField label="职位" for="u-position">
          <select id="u-position" v-model="form.positionId" class="s-select" :disabled="!editable">
            <option value="">未设置</option>
            <option
              v-for="p in positions"
              :key="p.id"
              :value="p.id"
              :disabled="p.status !== 'active'"
            >
              {{ p.name }}
            </option>
          </select>
          <label
            v-if="
              editable &&
              position &&
              position.roles.some((r) => r.scope === 'organization') &&
              form.personType === 'employee'
            "
            class="s-check"
            ><input
              v-model="form.grantPositionRoles"
              type="checkbox"
            />同时授予职位的企业级角色（只增不减）</label
          >
        </SettingsField>
        <SettingsField label="擅长模块" help="加入项目时用作默认的模块范围。">
          <ChoiceChips
            v-model="form.skillModules"
            :options="moduleOptions"
            label="擅长模块"
            :disabled="!editable"
          />
        </SettingsField>
      </SettingsCard>

      <SettingsCard
        title="企业级角色"
        description="在企业范围生效；角色中的项目权限只在所选项目范围内生效。"
        flush
      >
        <template #headerActions>
          <BaseButton v-if="can('assignment:manage') && !self" size="sm" @click="openAssignment()"
            >分配角色</BaseButton
          >
        </template>
        <div class="s-list">
          <button
            v-for="a in access?.assignments ?? []"
            :key="a.id"
            type="button"
            class="s-list-row"
            :disabled="!can('assignment:manage') || self"
            @click="openAssignment(a)"
          >
            <span class="s-list-main">
              <strong>{{ a.roleName }}</strong>
              <small
                >{{ scopeText(a) }}{{ a.grantedBy ? ' · 由 ' + a.grantedBy + ' 授予' : '' }}</small
              >
            </span>
            <span class="s-list-side">
              <BaseTag v-if="!a.active" strike>未生效</BaseTag>
              <BaseTag v-if="expiresSoon(a.validTo)" tone="yellow">即将到期</BaseTag>
              <span>{{ day(a.validFrom) }} 起{{ a.validTo ? ' · 至 ' + day(a.validTo) : '' }}</span>
            </span>
          </button>
          <p v-if="!access?.assignments.length" class="empty-note">没有企业级角色。</p>
        </div>
      </SettingsCard>

      <SettingsCard title="项目角色" description="在各项目的“成员与权限”中由项目经理分配。" flush>
        <div class="s-list">
          <div v-for="r in access?.projectRoles ?? []" :key="r.id" class="s-list-row">
            <span class="s-list-main">
              <strong>{{ r.projectName }}</strong>
              <small
                >{{ r.roleName }}{{ r.modules.length ? ' · ' + r.modules.join('、') : ''
                }}{{ r.ownOnly ? ' · 仅本人负责' : '' }}</small
              >
            </span>
            <span class="s-list-side">
              <BaseTag v-if="!r.active" strike>未生效</BaseTag>
              <BaseTag v-if="expiresSoon(r.validTo)" tone="yellow">即将到期</BaseTag>
              <span v-if="r.validTo">至 {{ day(r.validTo) }}</span>
            </span>
          </div>
          <p v-if="!access?.projectRoles.length" class="empty-note">没有加入任何项目。</p>
        </div>
      </SettingsCard>

      <SettingsCard title="有效权限" description="当前生效的全部权限点，以及它们来自哪个角色。">
        <details class="effective" open>
          <summary>企业级（{{ access?.organization.length ?? 0 }}）</summary>
          <ul>
            <li v-for="p in access?.organization ?? []" :key="p.code">
              <span>{{ label(p.code) }}</span
              ><small>{{ via(p.sources) }}</small>
            </li>
          </ul>
        </details>
        <details v-for="p in access?.projects ?? []" :key="p.projectId" class="effective">
          <summary>{{ p.projectName }}（{{ p.permissions.length }}）</summary>
          <ul>
            <li v-for="x in p.permissions" :key="x.code">
              <span>{{ label(x.code) }}</span
              ><small>{{ via(x.sources) }}</small>
            </li>
          </ul>
        </details>
      </SettingsCard>

      <SettingsCard
        v-if="can('org.security:manage')"
        title="SAP 凭据"
        description="离职或安全事件时，清除此人在所有项目保存的 SAP 用户与密码（不查看内容）。"
      >
        <div>
          <BaseButton variant="danger" :loading="purge.busy.value" @click="purgeSap"
            >清除全部 SAP 凭据</BaseButton
          >
        </div>
        <p v-if="purge.error.value" class="s-error" role="alert">{{ purge.error.value }}</p>
      </SettingsCard>
    </template>

    <BaseDialog
      :open="!!editing"
      :title="editing?.id ? '调整企业级角色' : '分配企业级角色'"
      wide
      @update:open="(v) => !v && (editing = null)"
    >
      <form v-if="editing" class="dialog-form" @submit.prevent="saveAssignment">
        <label
          >角色<select v-model="editing.roleId" class="s-select" :disabled="!!editing.id">
            <option v-for="r in orgRoles" :key="r.id" :value="r.id">
              {{ r.name }} — {{ r.description }}
            </option>
          </select></label
        >
        <label
          >项目范围<select
            v-model="editing.projectScope"
            class="s-select"
            @change="editing.scopeIds = []"
          >
            <option v-for="(text, key) in PROJECT_SCOPES" :key="key" :value="key">
              {{ text }}
            </option>
          </select></label
        >
        <div v-if="['customers', 'projects'].includes(editing.projectScope)" class="dialog-field">
          <span>{{ editing.projectScope === 'customers' ? '客户' : '项目' }}</span>
          <ChoiceChips
            v-model="editing.scopeIds"
            :options="scopeObjects"
            :label="editing.projectScope === 'customers' ? '客户' : '项目'"
          />
        </div>
        <div class="s-grid-2">
          <label>开始日期<input v-model="editing.validFrom" class="s-input" type="date" /></label>
          <label>结束日期<input v-model="editing.validTo" class="s-input" type="date" /></label>
        </div>
        <p class="s-note">只能授予你自己持有的权限；不能修改自己的角色。</p>
        <p v-if="assign.error.value" class="s-error" role="alert">{{ assign.error.value }}</p>
      </form>
      <template #footer>
        <BaseButton
          v-if="editing?.id"
          variant="danger"
          class="left"
          @click="revoke(access!.assignments.find((a) => a.id === editing!.id)!)"
          >撤销</BaseButton
        >
        <BaseButton @click="editing = null">取消</BaseButton>
        <BaseButton
          variant="primary"
          :loading="assign.busy.value"
          :disabled="!editing?.roleId"
          @click="saveAssignment"
          >保存</BaseButton
        >
      </template>
    </BaseDialog>

    <BaseDialog
      :open="!!temporary"
      title="新的临时密码"
      description="通过安全渠道交给本人；关闭后无法再查看。"
      @update:open="(v) => !v && (temporary = '')"
    >
      <code class="temporary">{{ temporary }}</code>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
.effective summary {
  cursor: pointer;
  font-weight: var(--weight-550);
}
.effective ul {
  display: grid;
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}
.effective li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1-5) 0;
  border-top: 1px solid var(--border);
}
.effective small {
  color: var(--text-muted);
  font-size: var(--font-12);
  text-align: right;
}
.dialog-form {
  display: grid;
  gap: var(--space-3);
}
.dialog-form label,
.dialog-field {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.left {
  margin-right: auto;
}
.temporary {
  display: block;
  padding: var(--space-3);
  border-radius: var(--radius-8);
  background: var(--yellow-bg-2);
  font-family: var(--font-mono);
  font-size: var(--font-16);
  user-select: all;
}
</style>
