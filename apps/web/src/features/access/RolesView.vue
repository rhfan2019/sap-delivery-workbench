<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronLeft, ChevronRight, Copy, Plus, RefreshCw, Search, ShieldCheck } from '@lucide/vue';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PROJECT_SCOPES,
} from '@sap-delivery-workbench/contracts/access/catalog';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { askConfirmation } from '../../services/confirmation';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useLoad } from '../settings/useLoad';
import RoleDrawer from './RoleDrawer.vue';
import { accessApi, day, type Holder, type Role } from './api';
import '../settings/settings.css';

// 企业 → 角色与权限 (docs/specs/project-access-admin.md 2.5, 2.8): built-in and custom roles in
// one settings list (DESIGN.md 6.2), each opening on its own page; and the permission report
// (who holds a permission, through which role).
const router = useRouter();
const { data, loading, error, reload } = useLoad(accessApi.roles);
onMounted(reload);
const view = ref<'roles' | 'report'>('roles');
const filter = ref('all');
const query = ref('');
const page = ref(1);
const roles = computed(() => data.value ?? []);
// Project composites first, then project singles, then organization roles, as the groups were.
const rank = (r: Role) => (r.scope === 'organization' ? 2 : r.kind === 'composite' ? 0 : 1);
const filtered = computed(() =>
  roles.value
    .filter((r) =>
      filter.value === 'all'
        ? true
        : filter.value === 'custom'
          ? !r.builtIn
          : filter.value === 'builtIn'
            ? r.builtIn
            : r.scope === filter.value,
    )
    .filter((r) =>
      (r.name + r.code + r.description).toLowerCase().includes(query.value.trim().toLowerCase()),
    )
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([filter, query], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
const filters = computed(() => [
  { id: 'all', label: '全部角色', count: roles.value.length },
  {
    id: 'project',
    label: '项目级',
    count: roles.value.filter((r) => r.scope === 'project').length,
  },
  {
    id: 'organization',
    label: '企业级',
    count: roles.value.filter((r) => r.scope === 'organization').length,
  },
  { id: 'builtIn', label: '系统角色', count: roles.value.filter((r) => r.builtIn).length },
  { id: 'custom', label: '自定义', count: roles.value.filter((r) => !r.builtIn).length },
]);
const unused = computed(() => roles.value.filter((r) => !r.builtIn && !r.inUse).length);
const usage = (r: Role) => r.assignmentCount + r.projectAssignmentCount;
const typeText = (r: Role) =>
  r.scope === 'organization'
    ? '企业级角色'
    : r.kind === 'composite'
      ? '项目级复合角色'
      : '项目级单一角色';
const detail = (r: Role) => '/settings/roles/' + r.id;
// A click on the row opens the role's page; the name and 查看 are links of their own.
function openRow(e: MouseEvent, r: Role) {
  if ((e.target as Element).closest('a, button')) return;
  void router.push(detail(r));
}
const manage = computed(() => can('role:manage'));
const rowMenu = (r: Role) => [{ label: '复制为新角色', icon: Copy, run: () => openCreate(r) }];

// The permission report.
const reportCode = ref('');
const holders = ref<Holder[]>([]);
const reportError = ref('');
const reportLoading = ref(false);
async function report(code: string) {
  reportCode.value = code;
  reportLoading.value = true;
  reportError.value = '';
  try {
    holders.value = await accessApi.holders(code);
  } catch (e) {
    reportError.value = (e as Error).message;
  } finally {
    reportLoading.value = false;
  }
}
const permissionGroups = PERMISSION_GROUPS.map((g) => ({
  ...g,
  items: PERMISSIONS.filter((p) => p.group === g.key),
}));
const chosen = computed(() => PERMISSIONS.find((p) => p.code === reportCode.value));

// The drawer creates a role, blank or copied from a row; the new role then opens on its page.
const open = ref(false);
const copying = ref<Role | null>(null);
const drawer = ref<InstanceType<typeof RoleDrawer> | null>(null);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的新角色？'));
}
async function openCreate(copy?: Role) {
  const next = copy ?? null;
  if (open.value && copying.value?.id === next?.id) return;
  if (open.value && !(await canLeave())) return;
  copying.value = next;
  open.value = true;
}
async function close() {
  if (await canLeave()) {
    open.value = false;
    copying.value = null;
  }
}
useDrawerLeave(canLeave, () => !!drawer.value?.dirty);
async function onCreated(role: Role) {
  open.value = false;
  copying.value = null;
  await router.push(detail(role));
}
</script>
<template>
  <SettingsPage
    title="角色与权限"
    description="角色是一组权限点；复合角色由单一角色组成，对应实际岗位。系统角色随版本更新，不能修改，可以复制后调整。"
    list
    :drawer="open"
  >
    <template #actions>
      <button class="icon-button" aria-label="刷新角色列表" :disabled="loading" @click="reload">
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <template v-if="data">
      <p class="s-summary">
        系统角色：<strong>{{ filters[3].count }} 个</strong
        ><span
          >· 自定义角色 {{ filters[4].count }} · 权限点 {{ PERMISSIONS.length }} ·
          未使用的自定义角色 {{ unused }}</span
        >
      </p>
      <div class="s-table-toolbar">
        <template v-if="view === 'roles'">
          <label class="s-table-search"
            ><Search :size="17" /><input
              v-model="query"
              aria-label="搜索角色"
              placeholder="搜索角色名称或编码" /></label
          ><select v-model="filter" aria-label="筛选角色">
            <option v-for="f in filters" :key="f.id" :value="f.id">
              {{ f.label }}（{{ f.count }}）
            </option>
          </select>
        </template>
        <div class="s-table-actions">
          <button
            class="secondary-button"
            :aria-pressed="view === 'report'"
            @click="view = view === 'report' ? 'roles' : 'report'"
          >
            {{ view === 'report' ? '返回角色列表' : '权限报表' }}
          </button>
          <button v-if="manage" class="primary-button" @click="openCreate()">
            <Plus :size="17" />新建角色
          </button>
        </div>
      </div>

      <template v-if="view === 'roles'">
        <div class="s-table-surface">
          <div v-if="!rows.length" class="s-table-empty">
            <ShieldCheck :size="32" />
            <h2>没有匹配的角色</h2>
            <p>调整搜索或筛选条件后再试。</p>
          </div>
          <table v-else class="s-table">
            <thead>
              <tr>
                <th>角色</th>
                <th>类型</th>
                <th class="hide-narrow">说明</th>
                <th>权限点</th>
                <th>分配</th>
                <th class="actions-col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id" class="clickable" @click="openRow($event, r)">
                <td>
                  <RouterLink :to="detail(r)" class="s-table-name">{{ r.name }}</RouterLink
                  ><span v-if="r.status === 'inactive'" class="s-badge muted">停用</span>
                  <small class="mono">{{ r.code }}</small>
                </td>
                <td>
                  <span>{{ typeText(r) }}</span>
                  <small
                    ><BaseTag v-if="!r.builtIn" tone="purple">自定义</BaseTag
                    ><template v-else>系统角色</template></small
                  >
                </td>
                <td class="hide-narrow description">
                  {{
                    r.description ||
                    (r.kind === 'composite' ? r.members.map((m) => m.name).join('、') : '—')
                  }}
                </td>
                <td>
                  <span>{{ r.permissions.length }} 个权限点</span
                  ><small v-if="r.kind === 'composite'"
                    >由 {{ r.members.length }} 个单一角色组成</small
                  >
                </td>
                <td>
                  <span>{{ usage(r) ? usage(r) + ' 次分配' : '未分配' }}</span
                  ><small>{{
                    r.scope === 'organization' ? '在用户页中分配' : '在“成员与权限”中分配'
                  }}</small>
                </td>
                <td>
                  <div class="s-row-actions" @click.stop>
                    <RouterLink :to="detail(r)" class="text-button">查看</RouterLink>
                    <SettingsRowMenu
                      v-if="manage"
                      :label="r.name + '的更多操作'"
                      :items="rowMenu(r)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <footer class="s-table-footer">
            <span>共 {{ filtered.length }} 个角色</span>
            <div>
              <button
                class="icon-button"
                aria-label="上一页"
                :disabled="page === 1"
                @click="page--"
              >
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
          项目级复合角色对应项目中的实际岗位，在“成员与权限”中分配；项目级单一角色是复合角色的组成部分，也可直接补充分配；企业级角色在用户页中分配，可带项目范围。
        </p>
      </template>

      <div v-else class="report">
        <SettingsCard title="选择权限点" flush>
          <div class="report-groups">
            <section v-for="g in permissionGroups" :key="g.key">
              <h3>{{ g.label }}</h3>
              <button
                v-for="p in g.items"
                :key="p.code"
                type="button"
                class="report-item"
                :aria-pressed="reportCode === p.code"
                @click="report(p.code)"
              >
                {{ p.label }}
              </button>
            </section>
          </div>
        </SettingsCard>
        <SettingsCard
          :title="chosen ? '持有“' + chosen.label + '”的人' : '持有人'"
          :description="
            chosen ? chosen.description + '（' + chosen.code + '）' : '在左侧选择一个权限点。'
          "
          flush
        >
          <p v-if="reportError" class="s-error report-pad" role="alert">{{ reportError }}</p>
          <BaseSkeleton v-else-if="reportLoading" height="120px" />
          <div v-else-if="chosen" class="s-list">
            <div v-for="h in holders" :key="h.assignmentId + h.viaCode" class="s-list-row">
              <BaseAvatar :name="h.displayName" :size="24" />
              <span class="s-list-main">
                <strong>{{ h.displayName }}</strong>
                <small>{{
                  h.level === 'project'
                    ? '项目 · ' + h.projectName
                    : '企业级 · ' + PROJECT_SCOPES[h.projectScope as 'all']
                }}</small>
              </span>
              <span class="s-list-side">
                <BaseTag variant="outline">经由 {{ h.viaName }}</BaseTag>
                <span v-if="h.validTo">至 {{ day(h.validTo) }}</span>
              </span>
            </div>
            <p v-if="!holders.length" class="s-note report-pad">没有人持有这个权限点。</p>
          </div>
        </SettingsCard>
      </div>
    </template>

    <RoleDrawer
      v-if="open"
      ref="drawer"
      :key="copying?.id ?? 'new'"
      :roles="roles"
      :copy="copying"
      @created="onCreated"
      @close="close"
    />
  </SettingsPage>
</template>
<style scoped>
.s-badge.muted {
  vertical-align: middle;
}
.description {
  max-width: 360px;
  color: var(--text-muted);
}
.report {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}
.report-groups {
  display: grid;
  gap: var(--space-3);
  max-height: 70vh;
  overflow: auto;
  padding: 0 var(--space-3) var(--space-3);
}
.report-groups h3 {
  margin: var(--space-2) 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
.report-item {
  display: block;
  width: 100%;
  padding: var(--space-1-5) var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.report-item:hover {
  background: var(--hover);
  color: var(--text);
}
.report-item[aria-pressed='true'] {
  background: var(--selected);
  color: var(--text);
  font-weight: var(--weight-550);
}
.report-pad {
  padding: var(--space-4);
}
@media (max-width: 860px) {
  .report {
    grid-template-columns: 1fr;
  }
}
</style>
