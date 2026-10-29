<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from '@lucide/vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useLoad, useSave } from '../settings/useLoad';
import PositionDrawer from './PositionDrawer.vue';
import { accessApi, type Position, type Role } from './api';
import '../settings/settings.css';

// 企业 → 职位 (docs/specs/project-access-admin.md 2.6): a position carries default roles. They
// are used when a user gets the position (organization roles) and when a user joins a project
// (project roles); changing them never rewrites existing assignments. A settings list with its
// drawer (DESIGN.md 6.2).
const { data, loading, error, reload } = useLoad(accessApi.positions);
const roles = ref<Role[]>([]);
onMounted(async () => {
  await reload();
  roles.value = can('role:view') ? await accessApi.roles().catch(() => []) : [];
});
const manage = computed(() => can('position:manage'));
const all = computed(() => data.value ?? []);

const query = ref('');
const filter = ref('');
const page = ref(1);
const filtered = computed(() =>
  all.value
    .filter((p) => !filter.value || p.status === filter.value)
    .filter((p) =>
      (p.name + p.code + p.description + p.roles.map((r) => r.name).join(''))
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
    ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([filter, query], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
const inactive = computed(() => all.value.filter((p) => p.status === 'inactive').length);
const holders = computed(() => all.value.reduce((n, p) => n + p.userCount, 0));

// The drawer: one position at a time; another row or “新建职位” asks before dropping changes.
const open = ref(false);
const editing = ref<Position | null>(null);
const drawer = ref<InstanceType<typeof PositionDrawer> | null>(null);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的职位修改？'));
}
async function edit(p: Position | null) {
  if (!manage.value) return;
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
async function saved() {
  open.value = false;
  editing.value = null;
  await reload();
  toast('职位已保存。', 'green');
}

const action = useSave();
async function toggle(p: Position) {
  const status = p.status === 'active' ? 'inactive' : 'active';
  if (
    status === 'inactive' &&
    !(await askConfirmation(`停用职位“${p.name}”？停用后不能再设给用户。`))
  )
    return;
  const body = {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    status,
    roleIds: p.roles.map((r) => r.id),
    rowVersion: p.rowVersion,
  };
  if (await action.run(() => accessApi.savePosition(p.id, body))) {
    await reload();
    toast(status === 'active' ? '职位已启用。' : '职位已停用。', 'green');
  }
}
async function remove(p: Position) {
  if (!(await askConfirmation(`删除职位“${p.name}”？`))) return;
  if (await action.run(() => accessApi.deletePosition(p.id, p.rowVersion))) {
    if (editing.value?.id === p.id) {
      open.value = false;
      editing.value = null;
    }
    await reload();
  }
}
const rowMenu = (p: Position) => [
  p.status === 'active'
    ? { label: '停用', icon: CirclePause, disabled: action.busy.value, run: () => toggle(p) }
    : { label: '启用', icon: CirclePlay, disabled: action.busy.value, run: () => toggle(p) },
  { label: '删除', icon: Trash2, danger: true, disabled: action.busy.value, run: () => remove(p) },
];
</script>
<template>
  <SettingsPage
    title="职位"
    description="职位是用户在实施方的岗位，用来带出默认角色。修改默认角色不会改动已有的分配。"
    list
    :drawer="open"
  >
    <template #actions>
      <button class="icon-button" aria-label="刷新职位列表" :disabled="loading" @click="reload">
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <p v-if="action.error.value" class="s-error" role="alert">{{ action.error.value }}</p>
    <BaseSkeleton v-if="loading && !data" height="200px" />
    <template v-if="data">
      <p class="s-summary">
        职位：<strong>{{ all.length }} 个</strong
        ><span>· 停用 {{ inactive }} · 已设给 {{ holders }} 人</span>
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索职位"
            placeholder="搜索职位名称、编码或角色" /></label
        ><select v-model="filter" aria-label="筛选职位">
          <option value="">全部职位</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
        </select>
        <div v-if="manage" class="s-table-actions">
          <button class="primary-button" @click="edit(null)"><Plus :size="17" />新建职位</button>
        </div>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <BriefcaseBusiness :size="32" />
          <h2>{{ query || filter ? '没有匹配的职位' : '还没有职位' }}</h2>
          <p>
            {{
              query || filter ? '调整搜索或筛选条件后再试。' : '建立职位后，可为用户带出默认角色。'
            }}
          </p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th>职位</th>
              <th>默认角色</th>
              <th class="hide-narrow">说明</th>
              <th>人数</th>
              <th v-if="manage" class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in rows"
              :key="p.id"
              :class="{ clickable: manage, selected: open && editing?.id === p.id }"
              @click="edit(p)"
            >
              <td>
                <button class="s-table-name" :disabled="!manage" @click.stop="edit(p)">
                  {{ p.name }}</button
                ><span v-if="p.status === 'inactive'" class="s-badge muted">停用</span>
                <small class="mono">{{ p.code }}</small>
              </td>
              <td>
                <div v-if="p.roles.length" class="s-table-tags">
                  <BaseTag
                    v-for="r in p.roles"
                    :key="r.id"
                    :tone="r.scope === 'project' ? 'blue' : 'purple'"
                    >{{ r.name }}</BaseTag
                  >
                </div>
                <span v-else class="muted">未设默认角色</span>
              </td>
              <td class="hide-narrow">
                <span class="muted">{{ p.description || '—' }}</span>
              </td>
              <td>{{ p.userCount }} 人</td>
              <td v-if="manage">
                <div class="s-row-actions" @click.stop>
                  <button class="text-button" @click="edit(p)">编辑</button>
                  <SettingsRowMenu :label="p.name + '的更多操作'" :items="rowMenu(p)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="s-table-footer">
          <span>共 {{ filtered.length }} 个职位</span>
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
        紫色为企业级默认角色，设置职位时可一并授予；蓝色为加入项目时带出的默认项目角色。修改默认角色不会改动已有的分配。
      </p>
    </template>
    <PositionDrawer
      v-if="open"
      ref="drawer"
      :key="editing?.id ?? 'new'"
      :position="editing"
      :roles="roles"
      @saved="saved"
      @close="close"
    />
  </SettingsPage>
</template>
