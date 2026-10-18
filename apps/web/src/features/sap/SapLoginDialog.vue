<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import { useSave } from '../settings/useLoad';
import { purposeLabel, sapApi, type ProjectSystems, type SapSystem } from './api';
import '../settings/settings.css';

// Logging in to one project SAP system with the person's own SAP user (docs/specs/
// project-access-admin.md 3.3). The platform logs in to SAP once to check it; only an accepted
// credential is kept, for this login or saved encrypted under the organization's policy.
const props = defineProps<{
  projectId: string;
  system: SapSystem | null;
  canSave: boolean;
  policy: { maxDays: number; idleDays: number };
  profileLogin?: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ saved: [view: ProjectSystems] }>();
const username = ref('');
const password = ref('');
const mode = ref<'saved' | 'session'>('saved');
const save = useSave();
watch(open, (value) => {
  if (!value) return;
  save.error.value = '';
  username.value = props.system?.credential?.username ?? '';
  password.value = '';
  mode.value = props.canSave ? 'saved' : 'session';
});
async function submit() {
  const view = await save.run(() =>
    sapApi.login(props.projectId, props.system!.id, {
      username: username.value,
      password: password.value,
      mode: mode.value,
    }),
  );
  password.value = '';
  if (view) {
    emit('saved', view);
    open.value = false;
  }
}
async function useProfile() {
  const view = await save.run(() => sapApi.loginWithProfile(props.projectId, props.system!.id));
  if (view) {
    emit('saved', view);
    open.value = false;
  }
}
</script>
<template>
  <BaseDialog
    v-model:open="open"
    :title="system ? '登录 ' + system.name : '登录 SAP'"
    :description="
      system
        ? `${purposeLabel(system.purpose)} · ${system.sid} client ${system.client}。请用你本人的 SAP 用户；平台先登录一次验证，成功后才保存。`
        : undefined
    "
  >
    <form class="login-form" autocomplete="on" @submit.prevent="submit">
      <label
        >SAP 用户<input
          v-model="username"
          class="s-input mono"
          name="username"
          autocomplete="username"
          maxlength="128"
          required
      /></label>
      <label
        >密码<input
          v-model="password"
          class="s-input"
          type="password"
          name="password"
          autocomplete="current-password"
          maxlength="256"
          required
      /></label>
      <fieldset class="modes">
        <legend>保存方式</legend>
        <label class="mode" :class="{ disabled: !canSave }">
          <input v-model="mode" type="radio" value="saved" :disabled="!canSave" />
          <span
            ><strong>加密保存</strong
            ><small>{{
              canSave
                ? `保存 ${policy.maxDays} 天，${policy.idleDays} 天不用自动失效；只用于你本人的请求。`
                : '企业安全策略不允许你保存 SAP 密码。'
            }}</small></span
          >
        </label>
        <label class="mode">
          <input v-model="mode" type="radio" value="session" />
          <span
            ><strong>本次登录有效</strong
            ><small>只存在服务进程内存中；退出平台、登录过期或服务重启后需要重新输入。</small></span
          >
        </label>
      </fieldset>
      <p class="s-note">SAP 拒绝的密码会立即作废，平台不会自动重试，避免把你的 SAP 用户锁定。</p>
      <p v-if="save.error.value" class="s-error" role="alert">{{ save.error.value }}</p>
      <button type="submit" hidden></button>
    </form>
    <template #footer>
      <BaseButton v-if="profileLogin" class="left" :loading="save.busy.value" @click="useProfile"
        >使用本机凭据文件</BaseButton
      >
      <BaseButton @click="open = false">取消</BaseButton>
      <BaseButton
        variant="primary"
        :loading="save.busy.value"
        :disabled="!username || !password"
        @click="submit"
        >{{ save.busy.value ? '正在验证…' : '登录' }}</BaseButton
      >
    </template>
  </BaseDialog>
</template>
<style scoped>
.login-form {
  display: grid;
  gap: var(--space-3);
}
.login-form > label {
  display: grid;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.modes {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}
.modes legend {
  margin-bottom: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.mode {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-8);
  cursor: pointer;
}
.mode:has(input:checked) {
  border-color: var(--blue-border-3);
  background: var(--blue-bg-2);
}
.mode.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.mode input {
  margin-top: var(--space-0-5);
  accent-color: var(--primary);
}
.mode span {
  display: grid;
  gap: var(--space-0-5);
}
.mode strong {
  font-weight: var(--weight-550);
}
.mode small {
  color: var(--text-muted);
  font-size: var(--font-12);
}
.left {
  margin-right: auto;
}
</style>
