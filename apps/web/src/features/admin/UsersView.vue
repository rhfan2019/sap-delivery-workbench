<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Users } from '@lucide/vue';
import { PERSON_TYPES } from '@sap-delivery-workbench/contracts/access/catalog';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { askConfirmation } from '../../services/confirmation';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useLoad } from '../settings/useLoad';
import { accessApi, day, expiresSoon, type Position } from '../access/api';
import { adminApi, type AdminUser } from './api';
import UserDrawer from './UserDrawer.vue';
import '../settings/settings.css';

// 企业 → 用户: a settings list (DESIGN.md 6.2); a user opens on their own page, a new one is
// created in the drawer.
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
const detail = (u: AdminUser) => '/settings/users/' + u.id;
// A click on the row opens the user's page; the name and 查看 are links of their own.
function openRow(e: MouseEvent, u: AdminUser) {
  if ((e.target as Element).closest('a, button')) return;
  void router.push(detail(u));
}

// The drawer creates a user; the temporary password is then shown once in a small dialog.
const open = ref(false);
const drawer = ref<InstanceType<typeof UserDrawer> | null>(null);
const created = ref<{ user: AdminUser; temporaryPassword: string; granted: string[] } | null>(null);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的新用户？'));
}
function openCreate() {
  open.value = true;
}
async function close() {
  if (await canLeave()) open.value = false;
}
useDrawerLeave(canLeave, () => !!drawer.value?.dirty);
async function onCreated(result: {
  user: AdminUser;
  temporaryPassword: string;
  granted: string[];
}) {
  open.value = false;
  created.value = result;
  await reload();
}
async function copyPassword() {
  try {
    await navigator.clipboard.writeText(created.value!.temporaryPassword);
  } catch {
    // The password stays on screen to copy by hand.
  }
}
</script>
<template>
  <SettingsPage
    title="用户"
    description="企业的账号、人员类型、职位与企业级角色。项目内的角色在各项目的“成员与权限”中分配。"
    list
    :drawer="open"
  >
    <template #actions>
      <button class="icon-button" aria-label="刷新用户列表" :disabled="loading" @click="load">
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
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
            <tr v-for="u in rows" :key="u.id" class="clickable" @click="openRow($event, u)">
              <td>
                <div class="s-table-person">
                  <BaseAvatar :name="u.displayName" :size="32" />
                  <div>
                    <RouterLink :to="detail(u)" class="s-table-name">{{
                      u.displayName
                    }}</RouterLink>
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
                  <RouterLink :to="detail(u)" class="text-button">查看</RouterLink>
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
        停用、重置密码、职位与企业级角色在用户页中处理；项目内的角色在各项目的“成员与权限”中分配。
      </p>
    </template>

    <UserDrawer
      v-if="open"
      ref="drawer"
      key="new"
      :positions="positions"
      @created="onCreated"
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
        <BaseButton variant="primary" @click="router.push(detail(created!.user))"
          >查看用户</BaseButton
        >
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
