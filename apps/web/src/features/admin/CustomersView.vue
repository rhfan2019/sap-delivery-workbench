<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  Building2,
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
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useLoad, useSave } from '../settings/useLoad';
import CustomerDrawer from './CustomerDrawer.vue';
import { adminApi, type Customer } from './api';
import '../settings/settings.css';

// 企业 → 客户: customer records as a settings list with its drawer (DESIGN.md 6.2). The SAP
// landscape and everything else live on projects.
const { data, loading, error, reload } = useLoad(adminApi.customers);
onMounted(reload);
const manage = computed(() => can('customer:manage'));
const all = computed(() => data.value ?? []);

const query = ref('');
const filter = ref('');
const page = ref(1);
const filtered = computed(() =>
  all.value
    .filter((c) => !filter.value || c.status === filter.value)
    .filter((c) =>
      (c.name + c.code + c.description).toLowerCase().includes(query.value.trim().toLowerCase()),
    ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([filter, query], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));
const count = (f: (c: Customer) => boolean) => all.value.filter(f).length;

// The drawer: one customer at a time; another row or “新建客户” asks before dropping changes.
const open = ref(false);
const editing = ref<Customer | null>(null);
const drawer = ref<InstanceType<typeof CustomerDrawer> | null>(null);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的客户修改？'));
}
async function edit(c: Customer | null) {
  if (!manage.value) return;
  if (open.value && c && editing.value?.id === c.id) return;
  if (open.value && !(await canLeave())) return;
  editing.value = c;
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
  toast('客户已保存。', 'green');
}

const action = useSave();
async function toggle(c: Customer) {
  const status = c.status === 'active' ? 'inactive' : 'active';
  if (
    status === 'inactive' &&
    !(await askConfirmation(`停用客户“${c.name}”？停用后不能再为其新建项目。`))
  )
    return;
  if (await action.run(() => adminApi.saveCustomer({ ...c, status }, c.id))) {
    await reload();
    toast(status === 'active' ? '客户已启用。' : '客户已停用。', 'green');
  }
}
async function remove(c: Customer) {
  if (!(await askConfirmation(`删除客户“${c.name}”？删除后不能恢复。`))) return;
  if (await action.run(() => adminApi.removeCustomer(c.id, c.rowVersion))) {
    if (editing.value?.id === c.id) {
      open.value = false;
      editing.value = null;
    }
    await reload();
    toast('客户已删除。', 'green');
  }
}
const rowMenu = (c: Customer) => [
  c.status === 'active'
    ? { label: '停用', icon: CirclePause, disabled: action.busy.value, run: () => toggle(c) }
    : { label: '启用', icon: CirclePlay, disabled: action.busy.value, run: () => toggle(c) },
  {
    label: '删除',
    icon: Trash2,
    danger: true,
    disabled: action.busy.value || c.projectCount > 0,
    title: c.projectCount > 0 ? '客户下有项目，不能删除；不再使用时请停用' : '',
    run: () => remove(c),
  },
];
</script>
<template>
  <SettingsPage
    title="客户"
    description="客户档案。项目的 SAP 系统形态、团队与系统登记在各项目中。"
    list
    :drawer="open"
  >
    <template #actions>
      <button class="icon-button" aria-label="刷新客户列表" :disabled="loading" @click="reload">
        <RefreshCw :size="18" />
      </button>
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <p v-if="action.error.value" class="s-error" role="alert">{{ action.error.value }}</p>
    <BaseSkeleton v-if="loading && !data" height="200px" />
    <template v-if="data">
      <p class="s-summary">
        客户：<strong>{{ all.length }} 个</strong
        ><span
          >· 外部客户 {{ count((c) => c.customerKind === 'external') }} · 本企业
          {{ count((c) => c.customerKind === 'self') }} · 停用
          {{ count((c) => c.status === 'inactive') }}</span
        >
      </p>
      <div class="s-table-toolbar">
        <label class="s-table-search"
          ><Search :size="17" /><input
            v-model="query"
            aria-label="搜索客户"
            placeholder="搜索客户名称或编码" /></label
        ><select v-model="filter" aria-label="筛选客户">
          <option value="">全部客户</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
        </select>
        <div v-if="manage" class="s-table-actions">
          <button class="primary-button" @click="edit(null)"><Plus :size="17" />新建客户</button>
        </div>
      </div>
      <div class="s-table-surface">
        <div v-if="!rows.length" class="s-table-empty">
          <Building2 :size="32" />
          <h2>{{ query || filter ? '没有匹配的客户' : '还没有客户' }}</h2>
          <p>
            {{ query || filter ? '调整搜索或筛选条件后再试。' : '建立客户后，才能为其新建项目。' }}
          </p>
        </div>
        <table v-else class="s-table">
          <thead>
            <tr>
              <th>客户</th>
              <th>类型</th>
              <th class="hide-narrow">说明</th>
              <th>项目</th>
              <th v-if="manage" class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in rows"
              :key="c.id"
              :class="{ clickable: manage, selected: open && editing?.id === c.id }"
              @click="edit(c)"
            >
              <td>
                <button class="s-table-name" :disabled="!manage" @click.stop="edit(c)">
                  {{ c.name }}</button
                ><span v-if="c.status === 'inactive'" class="s-badge muted">停用</span>
                <small class="mono">{{ c.code }}</small>
              </td>
              <td>
                <span>{{ c.customerKind === 'self' ? '本企业' : '外部客户' }}</span
                ><small v-if="c.customerKind === 'self'">内部项目</small>
              </td>
              <td class="hide-narrow">
                <span class="clamp">{{ c.description || '—' }}</span>
              </td>
              <td>{{ c.projectCount }} 个项目</td>
              <td v-if="manage">
                <div class="s-row-actions" @click.stop>
                  <button class="text-button" @click="edit(c)">编辑</button>
                  <SettingsRowMenu :label="c.name + '的更多操作'" :items="rowMenu(c)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="s-table-footer">
          <span>共 {{ filtered.length }} 个客户</span>
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
        停用的客户保留其项目与历史，但不能再为其新建项目；没有项目的客户可以删除。项目的 SAP
        系统形态、团队与系统登记在各项目中。
      </p>
    </template>
    <CustomerDrawer
      v-if="open"
      ref="drawer"
      :key="editing?.id ?? 'new'"
      :customer="editing"
      @saved="saved"
      @close="close"
    />
  </SettingsPage>
</template>
