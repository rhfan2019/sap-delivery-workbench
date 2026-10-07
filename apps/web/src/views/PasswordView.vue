<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, identity } from '../services/session';
import AppIcon from '../components/AppIcon.vue';
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
  <div class="password-page">
    <section class="password-card">
      <div class="form-symbol"><AppIcon name="shield" :size="26" /></div>
      <p class="eyebrow">ACCOUNT SECURITY</p>
      <h1>{{ identity?.mustChangePassword ? '设置你的专属密码' : '修改登录密码' }}</h1>
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
        <button class="primary-button login-submit" :disabled="busy">
          {{ busy ? '正在保存…' : '更新密码并重新登录' }}<AppIcon name="arrow" />
        </button>
      </form>
      <button class="text-button password-exit" :disabled="busy" @click="logout">退出登录</button>
    </section>
  </div>
</template>
