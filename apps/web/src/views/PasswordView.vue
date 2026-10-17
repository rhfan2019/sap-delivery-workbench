<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, identity } from '../services/session';
import AppIcon from '../components/AppIcon.vue';
// Standalone at /password (first sign-in), or one section of 个人设置 when embedded.
defineProps<{ embedded?: boolean }>();
const router = useRouter();
const oldPassword = ref('');
const newPassword = ref('');
const confirm = ref('');
const error = ref('');
const busy = ref(false);
async function submit() {
  error.value = '';
  if (newPassword.value !== confirm.value) {
    error.value = '两次输入的新密码不一致。';
    return;
  }
  busy.value = true;
  try {
    await api('/password', { currentPassword: oldPassword.value, newPassword: newPassword.value });
    identity.value = null;
    await router.replace('/login?changed=1');
  } catch (e) {
    error.value = (e as Error).message;
    if (!identity.value) await router.replace('/login');
  } finally {
    busy.value = false;
  }
}
async function logout() {
  busy.value = true;
  try {
    await api('/logout', {});
    identity.value = null;
    await router.replace('/login');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div :class="embedded ? 'password-embedded' : 'password-page'">
    <section :class="embedded ? 'password-section' : 'password-card'">
      <div v-if="!embedded" class="form-symbol"><AppIcon name="shield" :size="20" /></div>
      <component :is="embedded ? 'h2' : 'h1'">{{
        identity?.mustChangePassword ? '设置你的专属密码' : '修改登录密码'
      }}</component>
      <p class="muted">
        {{
          identity?.mustChangePassword
            ? '首次登录，请先修改临时密码后进入工作台。'
            : '修改密码后，所有设备上的登录会话将失效。'
        }}
      </p>
      <form @submit.prevent="submit">
        <label for="old-password">当前密码</label
        ><input
          id="old-password"
          v-model="oldPassword"
          type="password"
          autocomplete="current-password"
          required
          maxlength="256"
        /><label for="new-password">新密码</label
        ><input
          id="new-password"
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          required
          minlength="12"
          maxlength="128"
          placeholder="12–128 个字符，建议使用长口令"
        /><label for="confirm-password">确认新密码</label
        ><input
          id="confirm-password"
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          required
          minlength="12"
          maxlength="128"
        />
        <p v-if="error" class="error-note" role="alert">{{ error }}</p>
        <button class="primary-button password-submit" :disabled="busy">
          {{ busy ? '正在保存…' : '更新密码并重新登录' }}
        </button>
      </form>
      <button v-if="!embedded" class="text-button password-exit" :disabled="busy" @click="logout">
        退出登录
      </button>
    </section>
  </div>
</template>
<style scoped>
.password-section {
  max-width: 420px;
  padding-top: var(--space-5);
}
.password-section h2 {
  font-size: var(--font-16);
}
.password-submit {
  width: 100%;
  margin-top: var(--space-6);
}
.password-section .password-submit {
  width: auto;
}
</style>
