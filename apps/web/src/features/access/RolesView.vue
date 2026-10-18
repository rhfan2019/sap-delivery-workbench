<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search } from '@lucide/vue';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PROJECT_SCOPES,
} from '@sap-delivery-workbench/contracts/access/catalog';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseTabs from '../../components/base/BaseTabs.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import StatGrid from '../settings/StatGrid.vue';
import { useLoad, useSave } from '../settings/useLoad';
import { accessApi, day, type Holder, type Role } from './api';
import '../settings/settings.css';

// 企业 → 角色与权限 (docs/specs/project-access-admin.md 2.5, 2.8): built-in and custom roles, and
// the permission report (who holds a permission, through which role).
const router = useRouter();
const { data, loading, error, reload } = useLoad(accessApi.roles);
onMounted(reload);
const tab = ref('all');
const query = ref('');
const roles = computed(() => data.value ?? []);
const shown = computed(() =>
  roles.value
    .filter((r) =>
      tab.value === 'all' ? true : tab.value === 'custom' ? !r.builtIn : r.scope === tab.value,
    )
    .filter((r) =>
      (r.name + r.code + r.description).toLowerCase().includes(query.value.trim().toLowerCase()),
    ),
);
const sections = computed(() =>
  [
    {
      title: '项目级复合角色',
      note: '对应项目中的实际岗位，在“成员与权限”中分配。',
      items: shown.value.filter((r) => r.scope === 'project' && r.kind === 'composite'),
    },
    {
      title: '项目级单一角色',
      note: '复合角色的组成部分，也可直接补充分配。',
      items: shown.value.filter((r) => r.scope === 'project' && r.kind === 'single'),
    },
    {
      title: '企业级角色',
      note: '在用户详情中分配，可带项目范围。',
      items: shown.value.filter((r) => r.scope === 'organization'),
    },
  ].filter((s) => s.items.length),
);
const tabs = computed(() => [
  { id: 'all', label: '全部', count: roles.value.length },
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
  { id: 'custom', label: '自定义', count: roles.value.filter((r) => !r.builtIn).length },
  { id: 'report', label: '权限报表' },
]);
const stats = computed(() => [
  { label: '系统角色', value: roles.value.filter((r) => r.builtIn).length },
  { label: '自定义角色', value: roles.value.filter((r) => !r.builtIn).length },
  { label: '权限点', value: PERMISSIONS.length },
  { label: '未使用的自定义角色', value: roles.value.filter((r) => !r.builtIn && !r.inUse).length },
]);
const usage = (r: Role) => r.assignmentCount + r.projectAssignmentCount;

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

// Creating a role: a code and a name, single or composite, organization or project level; the
// permissions are chosen on the role page afterwards (or copied from an existing role).
const creating = ref(false);
const draft = ref({
  code: 'Z_',
  name: '',
  description: '',
  kind: 'single',
  scope: 'project',
  copyFrom: '',
});
const save = useSave();
const sources = computed(() =>
  roles.value.filter((r) => r.kind === draft.value.kind && r.scope === draft.value.scope),
);
function openCreate(copy?: Role) {
  save.error.value = '';
  draft.value = copy
    ? {
        code: 'Z_' + copy.code.replace(/^(SYS_|C_|PRJ_|DL_|AG_)/, ''),
        name: copy.name + '（副本）',
        description: copy.description,
        kind: copy.kind,
        scope: copy.scope,
        copyFrom: copy.id,
      }
    : { code: 'Z_', name: '', description: '', kind: 'single', scope: 'project', copyFrom: '' };
  creating.value = true;
}
async function create() {
  const source = roles.value.find((r) => r.id === draft.value.copyFrom);
  if (draft.value.kind === 'composite' && !source) {
    save.error.value = '复合角色请先选择“复制自”的复合角色，创建后再调整包含的单一角色。';
    return;
  }
  const role = await save.run(() =>
    accessApi.createRole({
      ...draft.value,
      permissions: source?.kind === 'single' ? source.permissions : [],
      members: source?.kind === 'composite' ? source.members.map((m) => m.id) : [],
    }),
  );
  if (role) {
    creating.value = false;
    await router.push('/settings/roles/' + role.id);
  }
}
</script>
<template>
  <SettingsPage
    title="角色与权限"
    description="角色是一组权限点；复合角色由单一角色组成，对应实际岗位。系统角色随版本更新，不能修改，可以复制后调整。"
    wide
  >
    <template #actions>
      <BaseButton v-if="can('role:manage')" variant="primary" @click="openCreate()"
        >新建角色</BaseButton
      >
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <template v-if="data">
      <StatGrid :stats="stats" />
      <div class="s-toolbar">
        <BaseTabs v-model="tab" :tabs="tabs" label="角色筛选" />
        <label v-if="tab !== 'report'" class="s-search"
          ><Search :size="14" /><input
            v-model="query"
            placeholder="搜索角色名称或编码"
            aria-label="搜索角色"
        /></label>
      </div>

      <template v-if="tab !== 'report'">
        <SettingsCard
          v-for="s in sections"
          :key="s.title"
          :title="s.title"
          :description="s.note"
          flush
        >
          <div class="s-list">
            <RouterLink
              v-for="r in s.items"
              :key="r.id"
              :to="'/settings/roles/' + r.id"
              class="s-list-row"
            >
              <span class="s-list-main">
                <strong
                  >{{ r.name }} <span class="s-mono role-code">{{ r.code }}</span></strong
                >
                <small>{{
                  r.description ||
                  (r.kind === 'composite' ? r.members.map((m) => m.name).join('、') : '')
                }}</small>
              </span>
              <span class="s-list-side">
                <BaseTag v-if="!r.builtIn" tone="purple">自定义</BaseTag>
                <BaseTag v-if="r.status === 'inactive'" strike>停用</BaseTag>
                <span>{{ r.permissions.length }} 个权限点</span>
                <span>{{ usage(r) ? usage(r) + ' 次分配' : '未分配' }}</span>
              </span>
            </RouterLink>
          </div>
        </SettingsCard>
        <p v-if="!sections.length" class="s-note">没有匹配的角色。</p>
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

    <BaseDialog
      v-model:open="creating"
      title="新建角色"
      description="先确定编码、名称与类型；权限点在角色页中勾选。"
      wide
    >
      <form class="create-form" @submit.prevent="create">
        <div class="s-grid-2">
          <label
            >编码<input
              v-model="draft.code"
              class="s-input mono"
              maxlength="40"
              placeholder="Z_ 开头便于区分"
          /></label>
          <label>名称<input v-model="draft.name" class="s-input" maxlength="60" /></label>
          <label
            >类型<select v-model="draft.kind" class="s-select" @change="draft.copyFrom = ''">
              <option value="single">单一角色（一组权限点）</option>
              <option value="composite">复合角色（一组单一角色）</option>
            </select></label
          >
          <label
            >层级<select v-model="draft.scope" class="s-select" @change="draft.copyFrom = ''">
              <option value="project">项目级（在项目中分配）</option>
              <option value="organization">企业级（可带项目范围）</option>
            </select></label
          >
        </div>
        <label
          >复制自<select v-model="draft.copyFrom" class="s-select">
            <option value="">
              {{ draft.kind === 'composite' ? '选择一个复合角色' : '不复制，从空白开始' }}
            </option>
            <option v-for="r in sources" :key="r.id" :value="r.id">
              {{ r.name }}（{{ r.code }}）
            </option>
          </select></label
        >
        <label
          >说明<textarea v-model="draft.description" class="s-textarea" maxlength="300" />
        </label>
        <p v-if="save.error.value" class="s-error" role="alert">{{ save.error.value }}</p>
      </form>
      <template #footer>
        <BaseButton @click="creating = false">取消</BaseButton>
        <BaseButton
          variant="primary"
          :loading="save.busy.value"
          :disabled="!draft.name || draft.code.length < 2"
          @click="create"
          >创建</BaseButton
        >
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.role-code {
  margin-left: var(--space-1-5);
  color: var(--text-subtle);
  font-weight: var(--weight-400);
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
.create-form {
  display: grid;
  gap: var(--space-3);
}
.create-form label {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
@media (max-width: 860px) {
  .report {
    grid-template-columns: 1fr;
  }
}
</style>
