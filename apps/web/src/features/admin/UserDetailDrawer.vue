<script setup lang="ts">
import { computed, ref } from 'vue';
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
import ChoiceChips from '../settings/ChoiceChips.vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
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

// One account in the users list's wide drawer (docs/specs/project-access-admin.md 2.6–2.8;
// DESIGN.md 5 “抽屉”): the account and its position, its organization roles with their project
// scope, its project roles, and every effective permission with where it comes from. The footer
// saves the account; role assignments take effect one by one. The account opens to read unless
// its 编辑 was clicked (development-discipline.md 4.1); roles, the password and SAP credentials
// keep their own actions either way.
const props = defineProps<{ userId: string; edit?: boolean }>();
const emit = defineEmits<{ changed: []; close: [] }>();
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
    user.value = await adminApi.user(props.userId);
    reset(user.value);
    access.value = await accessApi.userAccess(props.userId);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
  if (!user.value) return;
  positions.value = await accessApi.positions().catch(() => []);
  if (can('assignment:manage')) {
    roles.value = await accessApi.roles().catch(() => []);
    customers.value = await adminApi.customers().catch(() => []);
    projects.value = await adminApi.projects().catch(() => []);
  }
}
void load();
// The list changed the account (停用 / 启用 in its ⋯ menu): take the new version and status,
// keeping any other unsaved edits.
async function refresh() {
  const next = await adminApi.user(props.userId).catch(() => null);
  if (!next) return;
  const keep = accountDirty.value ? { ...form.value, status: next.status } : null;
  user.value = next;
  reset(next);
  if (keep) form.value = keep;
  access.value = await accessApi.userAccess(props.userId).catch(() => access.value);
}

const self = computed(() => user.value?.id === identity.value?.user.id);
const editable = computed(() => can('user:manage'));
const reading = ref(!props.edit);
function startEdit() {
  if (editable.value) reading.value = false;
}
function cancel() {
  if (user.value) reset(user.value);
  save.error.value = '';
  reading.value = true;
}
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
  const u = user.value;
  if (!u || !editable.value || !accountDirty.value || busy.value) return;
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
    reading.value = true;
    access.value = await accessApi.userAccess(u.id);
    emit('changed');
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
    await refresh();
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

// Organization roles: an inline form under the list adds one or changes its scope and validity.
const orgRoles = computed(() =>
  roles.value.filter((r) => r.scope === 'organization' && r.status === 'active'),
);
const manageRoles = computed(() => can('assignment:manage') && !self.value);
const editing = ref<{
  id?: string;
  roleId: string;
  projectScope: string;
  scopeIds: string[];
  validFrom: string;
  validTo: string;
  rowVersion?: string;
} | null>(null);
let editingInitial = '';
const assignmentDirty = computed(
  () => !!editing.value && JSON.stringify(editing.value) !== editingInitial,
);
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
  editingInitial = JSON.stringify(editing.value);
}
async function afterAssignment() {
  editing.value = null;
  access.value = await accessApi.userAccess(props.userId);
  user.value = await adminApi.user(props.userId);
  emit('changed');
}
async function saveAssignment() {
  const e = editing.value;
  if (!e?.roleId || assign.busy.value) return;
  const body = { ...e, validFrom: e.validFrom || undefined, validTo: e.validTo || null };
  const next = await assign.run(() =>
    e.id ? accessApi.saveAssignment(e.id, body) : accessApi.assign(props.userId, body),
  );
  if (next) {
    await afterAssignment();
    toast('企业级角色已保存。', 'green');
  }
}
// Enter in the inline form saves the assignment, not the account around it.
function assignOnEnter(e: KeyboardEvent) {
  if (!(e.target as Element).matches('input, select')) return;
  e.preventDefault();
  void saveAssignment();
}
async function revoke(a: Assignment) {
  if (!(await askConfirmation(`撤销 ${user.value!.displayName} 的“${a.roleName}”？`))) return;
  if (await assign.run(() => accessApi.revoke(a.id, a.rowVersion))) await afterAssignment();
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
const busy = computed(
  () => save.busy.value || assign.busy.value || reset1.busy.value || purge.busy.value,
);
const dirty = computed(() => accountDirty.value || assignmentDirty.value);
defineExpose({ dirty, busy, refresh, startEdit });
</script>
<template>
  <SettingsDrawer
    :title="user?.displayName ?? '用户'"
    :description="user ? user.loginName + (user.email ? ' · ' + user.email : '') : ''"
    close-label="关闭用户抽屉"
    :note="editable ? '保存只保存账号与职位；企业级角色逐条立即生效' : ''"
    :busy="busy"
    :reading="reading"
    :editable="editable && !!user"
    wide
    @close="emit('close')"
    @submit="saveAccount"
    @edit="startEdit"
  >
    <p v-if="error || reset1.error.value || save.error.value" class="error-note" role="alert">
      {{ error || reset1.error.value || save.error.value }}
    </p>
    <BaseSkeleton v-if="loading && !user" height="240px" />
    <template v-if="user">
      <section>
        <h3>账号</h3>
        <fieldset class="s-fields" :class="{ reading }" :disabled="reading">
          <div class="s-field">
            <span>登录账号</span><span class="mono">{{ user.loginName }}</span>
          </div>
          <label class="s-field"
            ><span>姓名 <b v-if="editable">*</b></span
            ><input
              v-model="form.displayName"
              maxlength="100"
              required
              :disabled="!editable || save.busy.value"
          /></label>
          <label class="s-field"
            ><span>邮箱</span
            ><input
              v-model="form.email"
              type="email"
              maxlength="254"
              placeholder="如 name@example.com"
              :disabled="!editable || save.busy.value"
          /></label>
          <label class="s-field"
            ><span>人员类型</span
            ><select v-model="form.personType" :disabled="!editable || save.busy.value">
              <option v-for="(text, key) in PERSON_TYPES" :key="key" :value="key">
                {{ text }}
              </option>
            </select></label
          >
          <p class="s-drawer-help">分包与外部人员的角色必须设结束日期。</p>
          <div class="s-field">
            <span>账号状态</span>
            <label class="s-check"
              ><input
                type="checkbox"
                :checked="form.status === 'active'"
                :disabled="!editable || self || save.busy.value"
                @change="form.status = form.status === 'active' ? 'disabled' : 'active'"
              />启用</label
            >
          </div>
          <p class="s-drawer-help">
            {{
              self
                ? '不能停用当前登录的账号。'
                : '停用后立即退出所有登录，并清除其保存的 SAP 凭据。'
            }}
          </p>
        </fieldset>
        <div class="s-field">
          <span>最近登录</span
          ><span :class="{ muted: !user.lastLoginAt }">{{
            user.lastLoginAt ? day(user.lastLoginAt) : '从未登录'
          }}</span>
        </div>
        <div v-if="can('user.password:reset') && !self" class="s-field">
          <span>密码</span>
          <div>
            <BaseButton size="sm" :loading="reset1.busy.value" @click="resetPassword"
              >重置密码</BaseButton
            >
          </div>
        </div>
      </section>

      <section>
        <h3>职位与模块</h3>
        <fieldset class="s-fields" :class="{ reading }" :disabled="reading">
          <label class="s-field"
            ><span>职位</span
            ><select v-model="form.positionId" :disabled="!editable || save.busy.value">
              <option value="">未设置</option>
              <option
                v-for="p in positions"
                :key="p.id"
                :value="p.id"
                :disabled="p.status !== 'active'"
              >
                {{ p.name }}
              </option>
            </select></label
          >
          <label
            v-if="
              editable &&
              !reading &&
              position &&
              position.roles.some((r) => r.scope === 'organization') &&
              form.personType === 'employee'
            "
            class="s-check"
            ><input
              v-model="form.grantPositionRoles"
              type="checkbox"
              :disabled="save.busy.value"
            />同时授予职位的企业级角色（只增不减）</label
          >
          <div class="s-field top">
            <span>擅长模块</span>
            <ChoiceChips
              v-model="form.skillModules"
              :options="moduleOptions"
              label="擅长模块"
              :disabled="!editable || save.busy.value"
            />
          </div>
          <p class="s-drawer-help">加入项目时用作默认的模块范围。</p>
        </fieldset>
      </section>

      <section>
        <div class="section-head">
          <h3>企业级角色</h3>
          <button
            v-if="manageRoles && !editing"
            type="button"
            class="text-button"
            :disabled="assign.busy.value || !orgRoles.length"
            @click="openAssignment()"
          >
            分配角色
          </button>
        </div>
        <p class="s-drawer-help">
          在企业范围生效；角色中的项目权限只在所选项目范围内生效。{{
            self && can('assignment:manage') ? '不能修改自己的角色。' : ''
          }}
        </p>
        <p v-if="assign.error.value && !editing" class="s-error" role="alert">
          {{ assign.error.value }}
        </p>
        <div class="s-list drawer-list">
          <div v-for="a in access?.assignments ?? []" :key="a.id" class="s-list-row">
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
              <template v-if="manageRoles">
                <button
                  type="button"
                  class="text-button"
                  :disabled="assign.busy.value"
                  @click="openAssignment(a)"
                >
                  调整</button
                ><button
                  type="button"
                  class="text-button danger"
                  :disabled="assign.busy.value"
                  @click="revoke(a)"
                >
                  撤销
                </button>
              </template>
            </span>
          </div>
          <p v-if="!access?.assignments.length" class="empty-note">没有企业级角色。</p>
        </div>
        <div
          v-if="editing"
          class="assignment-form"
          role="group"
          :aria-label="editing.id ? '调整企业级角色' : '分配企业级角色'"
          @keydown.enter="assignOnEnter"
        >
          <h4>{{ editing.id ? '调整企业级角色' : '分配企业级角色' }}</h4>
          <label class="s-field"
            ><span>角色 <b>*</b></span
            ><select v-model="editing.roleId" :disabled="!!editing.id || assign.busy.value">
              <option v-for="r in orgRoles" :key="r.id" :value="r.id">
                {{ r.name }} — {{ r.description }}
              </option>
            </select></label
          >
          <label class="s-field"
            ><span>项目范围</span
            ><select
              v-model="editing.projectScope"
              :disabled="assign.busy.value"
              @change="editing.scopeIds = []"
            >
              <option v-for="(text, key) in PROJECT_SCOPES" :key="key" :value="key">
                {{ text }}
              </option>
            </select></label
          >
          <div v-if="['customers', 'projects'].includes(editing.projectScope)" class="s-field top">
            <span>{{ editing.projectScope === 'customers' ? '客户' : '项目' }}</span>
            <ChoiceChips
              v-model="editing.scopeIds"
              :options="scopeObjects"
              :label="editing.projectScope === 'customers' ? '客户' : '项目'"
              :disabled="assign.busy.value"
            />
          </div>
          <label class="s-field"
            ><span>开始日期</span
            ><input v-model="editing.validFrom" type="date" :disabled="assign.busy.value"
          /></label>
          <label class="s-field"
            ><span>结束日期</span
            ><input v-model="editing.validTo" type="date" :disabled="assign.busy.value"
          /></label>
          <p class="s-drawer-help">只能授予你自己持有的权限；不能修改自己的角色。</p>
          <p v-if="assign.error.value" class="s-error" role="alert">{{ assign.error.value }}</p>
          <div class="assignment-actions">
            <button
              type="button"
              class="secondary-button"
              :disabled="assign.busy.value"
              @click="editing = null"
            >
              取消</button
            ><button
              type="button"
              class="primary-button"
              :disabled="assign.busy.value || !editing.roleId"
              @click="saveAssignment"
            >
              {{ assign.busy.value ? '正在处理…' : editing.id ? '保存' : '分配' }}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3>所在项目</h3>
        <p class="s-drawer-help">项目内的角色在各项目的“成员与权限”中由项目经理分配。</p>
        <div class="s-list drawer-list">
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
      </section>

      <section>
        <h3>有效权限</h3>
        <p class="s-drawer-help">当前生效的全部权限点，以及它们来自哪个角色。</p>
        <details class="effective">
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
      </section>

      <section v-if="can('org.security:manage')">
        <h3>SAP 凭据</h3>
        <p class="s-drawer-help">
          离职或安全事件时，清除此人在所有项目保存的 SAP 用户与密码（不查看内容）。
        </p>
        <BaseButton variant="danger" size="sm" :loading="purge.busy.value" @click="purgeSap"
          >清除全部 SAP 凭据</BaseButton
        >
        <p v-if="purge.error.value" class="s-error" role="alert">{{ purge.error.value }}</p>
      </section>
    </template>
    <template #actions>
      <button type="button" class="secondary-button" :disabled="busy" @click="cancel">取消</button
      ><button class="primary-button" :disabled="busy || !accountDirty || !form.displayName">
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>

  <BaseDialog
    :open="!!temporary"
    title="新的临时密码"
    description="通过安全渠道交给本人；关闭后无法再查看。"
    @update:open="(v) => !v && (temporary = '')"
  >
    <code class="temporary">{{ temporary }}</code>
  </BaseDialog>
</template>
<style scoped>
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}
.section-head h3 {
  margin-bottom: 0;
}
.drawer-list .s-list-row {
  padding-inline: 0;
}
.empty-note {
  margin: 0;
  padding: var(--space-3) 0;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.text-button.danger {
  color: var(--red-text-2);
}
.assignment-form {
  margin-top: var(--space-3);
  padding: var(--space-1) var(--space-4) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
}
.assignment-form h4 {
  margin: var(--space-3) 0 0;
  font-size: var(--font-14);
  font-weight: var(--weight-550);
}
.assignment-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
.effective {
  margin-top: var(--space-2);
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
