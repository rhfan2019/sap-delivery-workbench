<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { PERSON_TYPES } from '@sap-delivery-workbench/contracts/access/catalog';
import BaseTag from '../../components/base/BaseTag.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { toast } from '../../components/base/toast';
import { api, identity, restoreSession } from '../../services/session';
import SettingsPage from './SettingsPage.vue';
import SettingsCard from './SettingsCard.vue';
import SettingsField from './SettingsField.vue';
import { useLoad, useSave } from './useLoad';
import './settings.css';

// 个人资料 (docs/specs/project-access-admin.md 4.3): the account's name and e-mail, the facts an
// administrator keeps (position, person type, skill modules, roles), and the login password.
interface Me {
  id: string;
  loginName: string;
  displayName: string;
  email: string | null;
  rowVersion: string;
  personType: keyof typeof PERSON_TYPES;
  skillModules: string[];
  position: { id: string; name: string } | null;
  roles: { code: string; name: string; validTo: string | null }[];
}
const router = useRouter();
const { data: me, loading, error, reload } = useLoad(() => api<Me>('/me'));
const name = ref(''),
  email = ref('');
const profile = useSave();
const dirty = computed(
  () =>
    !!me.value && (name.value !== me.value.displayName || email.value !== (me.value.email ?? '')),
);
async function load() {
  await reload();
  name.value = me.value?.displayName ?? '';
  email.value = me.value?.email ?? '';
}
async function saveProfile() {
  const saved = await profile.run(() =>
    api<Me>(
      '/me',
      { displayName: name.value, email: email.value, rowVersion: me.value!.rowVersion },
      'PATCH',
    ),
  );
  if (!saved) return;
  me.value = { ...me.value!, ...saved };
  await restoreSession();
  toast('个人资料已保存。', 'green');
}

const current = ref(''),
  next = ref(''),
  confirm = ref('');
const password = useSave();
async function changePassword() {
  if (next.value !== confirm.value) {
    password.error.value = '两次输入的新密码不一致。';
    return;
  }
  const done = await password.run(() =>
    api('/password', { currentPassword: current.value, newPassword: next.value }),
  );
  if (!done) return;
  identity.value = null;
  await router.replace('/login?changed=1');
}
onMounted(load);
</script>
<template>
  <SettingsPage
    title="个人资料"
    description="你的姓名、联系方式与登录密码。职位与角色由管理员维护。"
  >
    <p v-if="error" class="s-error" role="alert">{{ error }}</p>
    <BaseSkeleton v-if="loading && !me" height="160px" />
    <template v-if="me">
      <SettingsCard
        title="基本资料"
        description="姓名会显示在开发清单、对话与审计记录中。"
        editable
        :dirty="dirty"
        :saving="profile.busy.value"
        :error="profile.error.value"
        @save="saveProfile"
      >
        <SettingsField label="登录账号" help="用于登录，不能修改。">
          <input class="s-input mono" :value="me.loginName" disabled />
        </SettingsField>
        <SettingsField label="姓名" for="profile-name" required>
          <input id="profile-name" v-model="name" class="s-input" maxlength="100" />
        </SettingsField>
        <SettingsField label="邮箱" for="profile-email">
          <input id="profile-email" v-model="email" class="s-input" type="email" maxlength="254" />
        </SettingsField>
      </SettingsCard>
      <SettingsCard title="岗位与权限" description="由企业管理员维护；需要调整时请联系管理员。">
        <SettingsField label="职位">
          <span class="profile-value">{{ me.position?.name ?? '未设置' }}</span>
        </SettingsField>
        <SettingsField label="人员类型">
          <span class="profile-value">{{ PERSON_TYPES[me.personType] }}</span>
        </SettingsField>
        <SettingsField label="擅长模块">
          <span class="profile-tags">
            <BaseTag v-for="m in me.skillModules" :key="m" tone="blue">{{ m }}</BaseTag>
            <span v-if="!me.skillModules.length" class="profile-value">未设置</span>
          </span>
        </SettingsField>
        <SettingsField label="企业级角色" help="项目内的角色在各项目的“成员与权限”中查看。">
          <span class="profile-tags">
            <BaseTag v-for="r in me.roles" :key="r.code" variant="outline"
              >{{ r.name
              }}<template v-if="r.validTo"> · 至 {{ r.validTo.slice(0, 10) }}</template></BaseTag
            >
            <span v-if="!me.roles.length" class="profile-value">无</span>
          </span>
        </SettingsField>
      </SettingsCard>
    </template>
    <SettingsCard
      title="登录密码"
      description="至少 12 个字符。修改后所有设备上的登录都会失效，需要重新登录。"
      editable
      save-label="修改密码"
      :dirty="!!current && !!next && !!confirm"
      :saving="password.busy.value"
      :error="password.error.value"
      @save="changePassword"
    >
      <SettingsField label="当前密码" for="pw-current">
        <input
          id="pw-current"
          v-model="current"
          class="s-input"
          type="password"
          autocomplete="current-password"
        />
      </SettingsField>
      <SettingsField label="新密码" for="pw-next">
        <input
          id="pw-next"
          v-model="next"
          class="s-input"
          type="password"
          autocomplete="new-password"
        />
      </SettingsField>
      <SettingsField label="确认新密码" for="pw-confirm">
        <input
          id="pw-confirm"
          v-model="confirm"
          class="s-input"
          type="password"
          autocomplete="new-password"
        />
      </SettingsField>
    </SettingsCard>
  </SettingsPage>
</template>
<style scoped>
.profile-value {
  display: inline-block;
  padding-top: var(--space-1-5);
}
.profile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
  padding-top: var(--space-1);
}
</style>
