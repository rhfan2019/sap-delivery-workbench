<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search } from '@lucide/vue';
import { PERSON_TYPES } from '@sap-delivery-workbench/contracts/access/catalog';
import { SAP_MODULES } from '@sap-delivery-workbench/contracts/projects/options';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTabs from '../../components/base/BaseTabs.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { can } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import StatGrid from '../settings/StatGrid.vue';
import ChoiceChips from '../settings/ChoiceChips.vue';
import { useLoad, useSave } from '../settings/useLoad';
import { accessApi, expiresSoon, type Position } from '../access/api';
import { adminApi, type AdminUser } from './api';
import '../settings/settings.css';

// 企业 → 用户 (after Plain's Members): accounts, their position and organization roles.
const router = useRouter();
const { data, loading, error, reload } = useLoad(adminApi.users);
const positions = ref<Position[]>([]);
onMounted(async () => {
  await reload();
  positions.value = (await accessApi.positions().catch(() => [])).filter(
    (p) => p.status === 'active',
  );
});
const tab = ref('active');
const query = ref('');
const users = computed(() => data.value ?? []);
const soon = (u: AdminUser) => u.roles.some((r) => expiresSoon(r.validTo));
const shown = computed(() =>
  users.value
    .filter((u) =>
      tab.value === 'active'
        ? u.status === 'active'
        : tab.value === 'disabled'
          ? u.status !== 'active'
          : tab.value === 'external'
            ? u.personType !== 'employee'
            : true,
    )
    .filter((u) =>
      (u.displayName + u.loginName + (u.email ?? '') + (u.position?.name ?? ''))
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
    ),
);
const tabs = computed(() => [
  { id: 'active', label: '在职', count: users.value.filter((u) => u.status === 'active').length },
  {
    id: 'disabled',
    label: '已停用',
    count: users.value.filter((u) => u.status !== 'active').length,
  },
  {
    id: 'external',
    label: '分包与外部',
    count: users.value.filter((u) => u.personType !== 'employee').length,
  },
  { id: 'all', label: '全部', count: users.value.length },
]);
const stats = computed(() => [
  { label: '在职账号', value: users.value.filter((u) => u.status === 'active').length },
  {
    label: '超级管理员',
    value: users.value.filter((u) => u.roles.some((r) => r.code === 'SYS_SUPER_ADMIN')).length,
  },
  { label: '分包与外部', value: users.value.filter((u) => u.personType !== 'employee').length },
  {
    label: '角色即将到期',
    value: users.value.filter(soon).length,
    tone: users.value.some(soon) ? ('yellow' as const) : undefined,
  },
]);

const creating = ref(false);
const draft = ref({
  loginName: '',
  displayName: '',
  email: '',
  personType: 'employee',
  positionId: '',
  grantPositionRoles: true,
  skillModules: [] as string[],
});
const created = ref<{ user: AdminUser; temporaryPassword: string; granted: string[] } | null>(null);
const save = useSave();
function openCreate() {
  save.error.value = '';
  draft.value = {
    loginName: '',
    displayName: '',
    email: '',
    personType: 'employee',
    positionId: '',
    grantPositionRoles: true,
    skillModules: [],
  };
  creating.value = true;
}
async function create() {
  const result = await save.run(() =>
    adminApi.createUser({
      ...draft.value,
      positionId: draft.value.positionId || null,
      grantPositionRoles: draft.value.personType === 'employee' && draft.value.grantPositionRoles,
    }),
  );
  if (result) {
    creating.value = false;
    created.value = result;
    await reload();
  }
}
const position = computed(() => positions.value.find((p) => p.id === draft.value.positionId));
const moduleOptions = SAP_MODULES.map((m) => ({ value: m, label: m }));
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
    wide
  >
    <template #actions>
      <BaseButton v-if="can('user:manage')" variant="primary" @click="openCreate"
        >新建用户</BaseButton
      >
    </template>
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !data" height="240px" />
    <template v-if="data">
      <StatGrid :stats="stats" />
      <div class="s-toolbar">
        <BaseTabs v-model="tab" :tabs="tabs" label="用户筛选" />
        <label class="s-search"
          ><Search :size="14" /><input
            v-model="query"
            placeholder="搜索姓名、账号、邮箱或职位"
            aria-label="搜索用户"
        /></label>
      </div>
      <SettingsCard flush>
        <div class="s-list">
          <RouterLink
            v-for="u in shown"
            :key="u.id"
            :to="'/settings/users/' + u.id"
            class="s-list-row"
          >
            <BaseAvatar :name="u.displayName" :size="32" />
            <span class="s-list-main">
              <strong>{{ u.displayName }}</strong>
              <small>{{ u.loginName }}{{ u.email ? ' · ' + u.email : '' }}</small>
            </span>
            <span class="s-list-side">
              <span>{{ u.position?.name ?? '未设职位' }}</span>
              <BaseTag v-if="u.personType !== 'employee'" tone="yellow">{{
                PERSON_TYPES[u.personType]
              }}</BaseTag>
              <BaseTag v-for="r in u.roles" :key="r.code" tone="purple">{{ r.name }}</BaseTag>
              <BaseTag v-if="u.status !== 'active'" strike>已停用</BaseTag>
              <span>{{ u.projectCount }} 个项目</span>
            </span>
          </RouterLink>
          <p v-if="!shown.length" class="empty-note">
            {{ query ? '没有匹配的用户。' : '这里没有用户。' }}
          </p>
        </div>
      </SettingsCard>
    </template>

    <BaseDialog
      v-model:open="creating"
      title="新建用户"
      description="创建后生成一次性临时密码；首次登录必须修改。"
      wide
    >
      <form class="dialog-form" @submit.prevent="create">
        <div class="s-grid-2">
          <label
            >登录账号<input
              v-model="draft.loginName"
              class="s-input mono"
              maxlength="64"
              placeholder="3–64 位英文字母、数字、点、下划线或连字符"
              required
          /></label>
          <label
            >姓名<input v-model="draft.displayName" class="s-input" maxlength="100" required
          /></label>
          <label
            >邮箱<input v-model="draft.email" class="s-input" type="email" maxlength="254"
          /></label>
          <label
            >人员类型<select v-model="draft.personType" class="s-select">
              <option v-for="(label, key) in PERSON_TYPES" :key="key" :value="key">
                {{ label }}
              </option>
            </select></label
          >
        </div>
        <label
          >职位<select v-model="draft.positionId" class="s-select">
            <option value="">暂不设置</option>
            <option v-for="p in positions" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select></label
        >
        <label
          v-if="position && position.roles.some((r) => r.scope === 'organization')"
          class="s-check"
          ><input
            v-model="draft.grantPositionRoles"
            type="checkbox"
            :disabled="draft.personType !== 'employee'"
          />同时授予职位的企业级角色：{{
            position.roles
              .filter((r) => r.scope === 'organization')
              .map((r) => r.name)
              .join('、')
          }}</label
        >
        <div class="dialog-field">
          <span>擅长模块</span>
          <ChoiceChips v-model="draft.skillModules" :options="moduleOptions" label="擅长模块" />
          <small class="s-note">加入项目时用作默认的模块范围。</small>
        </div>
        <p v-if="save.error.value" class="s-error" role="alert">{{ save.error.value }}</p>
      </form>
      <template #footer>
        <BaseButton @click="creating = false">取消</BaseButton>
        <BaseButton
          variant="primary"
          :loading="save.busy.value"
          :disabled="!draft.loginName || !draft.displayName"
          @click="create"
          >创建</BaseButton
        >
      </template>
    </BaseDialog>

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
        <BaseButton variant="primary" @click="router.push('/settings/users/' + created!.user.id)"
          >查看用户</BaseButton
        >
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
.dialog-form {
  display: grid;
  gap: var(--space-3);
}
.dialog-form label:not(.s-check),
.dialog-field {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
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
