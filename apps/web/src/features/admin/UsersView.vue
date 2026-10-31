<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
  Users,
  UserX,
} from '@lucide/vue';
import { PERSON_TYPES } from '@sap-delivery-workbench/contracts/access/catalog';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { can, identity } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useLoad, useSave } from '../settings/useLoad';
import { accessApi, day, expiresSoon, type Position } from '../access/api';
import { adminApi, type AdminUser } from './api';
import UserDetailDrawer from './UserDetailDrawer.vue';
import UserDrawer from './UserDrawer.vue';
import '../settings/settings.css';

// 企业 → 用户: a settings list (DESIGN.md 6.2); a user is created and edited in the drawer.
const router = useRouter();
const { data, loading, error, reload } = useLoad(adminApi.users);
const positions = ref<Position[]>([]);
async function load() {
  await reload();
  positions.value = (await accessApi.positions().catch(() => [])).filter(
    (p) => p.status === 'active',
  );
}
onMounted(load);
const filter = ref('active');
const query = ref('');
const page = ref(1);
const users = computed(() => data.value ?? []);
const soon = (u: AdminUser) => u.roles.some((r) => expiresSoon(r.validTo));
const external = (u: AdminUser) => u.personType !== 'employee';
const filtered = computed(() =>
  users.value
    .filter((u) =>
      filter.value === 'active'
        ? u.status === 'active'
        : filter.value === 'disabled'
          ? u.status !== 'active'
          : filter.value === 'external'
            ? external(u)
            : true,
    )
    .filter((u) =>
      (u.displayName + u.loginName + (u.email ?? '') + (u.position?.name ?? ''))
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
    ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([filter, query], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
const activeCount = computed(() => users.value.filter((u) => u.status === 'active').length);
const filters = computed(() => [
  { id: 'active', label: '在职', count: activeCount.value },
  { id: 'disabled', label: '已停用', count: users.value.length - activeCount.value },
  { id: 'external', label: '分包与外部', count: users.value.filter(external).length },
  { id: 'all', label: '全部', count: users.value.length },
]);
const admins = computed(
  () => users.value.filter((u) => u.roles.some((r) => r.code === 'SYS_SUPER_ADMIN')).length,
);
const expiring = computed(() => users.value.filter(soon).length);
const self = (u: AdminUser) => u.id === identity.value?.user.id;

// The drawer (DESIGN.md 5 “抽屉”): a new user, or one user at a time in the wide drawer; another
// row asks before dropping changes. `?user=<id>` opens that user's drawer and follows it, so the
// workbench tab keeps the address.
const route = useRoute();
const here = route.path;
const creating = ref(false);
const openId = ref<string | null>(null);
// A row opens the account to read; its 编辑 straight to edit (development-discipline.md 4.1).
const editNow = ref(false);
const createDrawer = ref<InstanceType<typeof UserDrawer> | null>(null);
const userDrawer = ref<InstanceType<typeof UserDetailDrawer> | null>(null);
const created = ref<{ user: AdminUser; temporaryPassword: string; granted: string[] } | null>(null);
const current = () => (creating.value ? createDrawer.value : userDrawer.value);
async function canLeave() {
  const d = current();
  if (d?.busy) return false;
  return (
    !d?.dirty ||
    (await askConfirmation(creating.value ? '放弃尚未保存的新用户？' : '放弃尚未保存的用户修改？'))
  );
}
function follow(id: string | null) {
  const query = { ...route.query };
  if (id) query.user = id;
  else delete query.user;
  void router.replace({ query }).catch(() => {});
}
async function openUser(id: string, now = false) {
  if (openId.value === id) {
    if (now) userDrawer.value?.startEdit();
    return;
  }
  if ((creating.value || openId.value) && !(await canLeave())) return;
  creating.value = false;
  editNow.value = now;
  openId.value = id;
  follow(id);
}
async function openCreate() {
  if (creating.value) return;
  if (openId.value && !(await canLeave())) return;
  openId.value = null;
  creating.value = true;
  follow(null);
}
async function close() {
  if (!(await canLeave())) return;
  creating.value = false;
  openId.value = null;
  follow(null);
}
watch(
  () => route.query.user,
  async (id) => {
    if (route.path !== here) return;
    const next = typeof id === 'string' && id ? id : null;
    if (next === openId.value) return;
    if (next) await openUser(next);
    else if (openId.value) await close();
    // Refused to leave unsaved changes: put the address back.
    if (openId.value !== next) follow(openId.value);
  },
  { immediate: true },
);
useDrawerLeave(canLeave, () => !!current()?.dirty);
// A click on the row opens the user's drawer; its buttons act on their own.
function openRow(e: MouseEvent, u: AdminUser) {
  if ((e.target as Element).closest('a, button')) return;
  void openUser(u.id);
}
async function onCreated(result: {
  user: AdminUser;
  temporaryPassword: string;
  granted: string[];
}) {
  creating.value = false;
  created.value = result;
  await reload();
}
function viewCreated() {
  const id = created.value!.user.id;
  created.value = null;
  void openUser(id);
}
async function copyPassword() {
  try {
    await navigator.clipboard.writeText(created.value!.temporaryPassword);
  } catch {
    // The password stays on screen to copy by hand.
  }
}

// 停用 / 启用 from the row's ⋯ menu; the backend keeps the last super admin and refuses the
// signed-in account.
const statusSave = useSave();
async function toggleStatus(u: AdminUser) {
  const disable = u.status === 'active';
  const question = disable
    ? `停用 ${u.displayName}？停用后立即退出所有登录，并清除其保存的 SAP 凭据。`
    : `启用 ${u.displayName}？启用后可以重新登录。`;
  if (!(await askConfirmation(question))) return;
  const result = await statusSave.run(() =>
    adminApi.saveUser(u.id, {
      displayName: u.displayName,
      email: u.email ?? '',
      status: disable ? 'disabled' : 'active',
      personType: u.personType,
      positionId: u.position?.id ?? null,
      skillModules: u.skillModules,
      grantPositionRoles: false,
      rowVersion: u.rowVersion,
    }),
  );
  if (!result) return;
  toast(disable ? '账号已停用。' : '账号已启用。', 'green');
  await reload();
  if (openId.value === u.id) await userDrawer.value?.refresh();
}
const rowMenu = (u: AdminUser) =>
  u.status === 'active'
    ? [
        {
          label: '停用',
          icon: UserX,
          danger: true,
          disabled: statusSave.busy.value || self(u),
          title: self(u) ? '不能停用当前登录的账号' : '',
          run: () => toggleStatus(u),
        },
      ]
    : [
        {
          label: '启用',
          icon: UserCheck,
          disabled: statusSave.busy.value,
          run: () => toggleStatus(u),
        },
      ];
</script>
<template>
  <SettingsPage
    title="用户"
    description="企业的账号、人员类型、职位与企业级角色。项目内的角色在各项目的“成员与权限”中分配。"
    list
    :drawer="creating ? true : openId ? 'wide' : false"
  >
    <template #actions>
      <button class="icon-button" aria-label="刷新用户列表" :disabled="loading" @click="load">
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <p v-if="statusSave.error.value" class="s-error" role="alert">{{ statusSave.error.value }}</p>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <template v-if="data">
      <p class="s-summary">
        在职账号：<strong>{{ activeCount }} 人</strong
        ><span
          >· 超级管理员 {{ admins }} · 分包与外部 {{ filters[2].count }} · 角色即将到期
          {{ expiring }}</span
        >
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索用户"
            placeholder="搜索姓名、账号、邮箱或职位" /></label
        ><select v-model="filter" aria-label="筛选用户">
          <option v-for="f in filters" :key="f.id" :value="f.id">
            {{ f.label }}（{{ f.count }}）
          </option>
        </select>
        <div v-if="can('user:manage')" class="s-table-actions">
          <button class="primary-button" @click="openCreate"><Plus :size="17" />新建用户</button>
        </div>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <Users :size="32" />
          <h2>{{ query ? '没有匹配的用户' : '这里没有用户' }}</h2>
          <p>{{ query ? '调整搜索或筛选条件后再试。' : '换一个筛选条件，或新建用户。' }}</p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>职位</th>
              <th>企业级角色</th>
              <th class="hide-narrow">项目</th>
              <th>状态</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="u in rows"
              :key="u.id"
              class="clickable"
              :class="{ selected: openId === u.id }"
              @click="openRow($event, u)"
            >
              <td>
                <div class="s-table-person">
                  <BaseAvatar :name="u.displayName" :size="32" />
                  <div>
                    <button class="s-table-name" @click.stop="openUser(u.id)">
                      {{ u.displayName }}</button
                    ><span v-if="self(u)" class="s-badge muted">你</span>
                    <small
                      ><span class="mono">{{ u.loginName }}</span
                      >{{ u.email ? ' · ' + u.email : '' }}</small
                    >
                  </div>
                </div>
              </td>
              <td>
                <span>{{ u.position?.name ?? '未设职位' }}</span
                ><small>{{ PERSON_TYPES[u.personType] }}</small>
              </td>
              <td>
                <div v-if="u.roles.length" class="s-table-tags">
                  <BaseTag v-for="r in u.roles" :key="r.code" tone="purple">{{ r.name }}</BaseTag>
                </div>
                <span v-else class="muted">—</span>
                <small v-if="soon(u)"><span class="s-badge warning">角色即将到期</span></small>
              </td>
              <td class="hide-narrow">
                <span>{{ u.projectCount }} 个项目</span>
              </td>
              <td>
                <span v-if="u.status === 'active'">在职</span
                ><span v-else class="s-badge muted">已停用</span
                ><small>{{ u.lastLoginAt ? '最近登录 ' + day(u.lastLoginAt) : '从未登录' }}</small>
              </td>
              <td>
                <div class="s-row-actions" @click.stop>
                  <button class="text-button" @click="openUser(u.id, can('user:manage'))">
                    {{ can('user:manage') ? '编辑' : '查看' }}
                  </button>
                  <SettingsRowMenu
                    v-if="can('user:manage')"
                    :label="u.displayName + '的更多操作'"
                    :items="rowMenu(u)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="s-table-footer">
          <span>共 {{ filtered.length }} 个用户</span>
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
        账号、重置密码、职位与企业级角色在用户抽屉中处理，停用与启用也可在行尾 ⋯
        菜单中操作；项目内的角色在各项目的“成员与权限”中分配。
      </p>
    </template>

    <UserDrawer
      v-if="creating"
      ref="createDrawer"
      key="new"
      :positions="positions"
      @created="onCreated"
      @close="close"
    />
    <UserDetailDrawer
      v-else-if="openId"
      ref="userDrawer"
      :key="openId"
      :user-id="openId"
      :edit="editNow"
      @changed="reload"
      @close="close"
    />

    <BaseDialog
      :open="!!created"
      title="用户已创建"
      description="把临时密码通过安全渠道交给本人；关闭后无法再查看。"
      @update:open="(v) => !v && (created = null)"
    >
      <div v-if="created" class="password-box">
        <span>{{ created.user.displayName }}（{{ created.user.loginName }}）</span>
        <code>{{ created.temporaryPassword }}</code>
        <small v-if="created.granted.length" class="s-note"
          >已授予：{{ created.granted.join('、') }}</small
        >
      </div>
      <template #footer>
        <BaseButton @click="copyPassword">复制密码</BaseButton>
        <BaseButton variant="primary" @click="viewCreated">查看用户</BaseButton>
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.password-box {
  display: grid;
  gap: var(--space-2);
}
.password-box code {
  padding: var(--space-3);
  border-radius: var(--radius-8);
  background: var(--yellow-bg-2);
  font-family: var(--font-mono);
  font-size: var(--font-16);
  user-select: all;
}
</style>
