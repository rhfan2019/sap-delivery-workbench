<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import { api, identity, type Identity } from '../services/session';
const router = useRouter();
const route = useRoute();
const loginName = ref('');
const password = ref('');
const visible = ref(false);
const busy = ref(false);
const error = ref(route.query.unavailable ? '服务暂不可用，请确认平台已启动后重试。' : '');
const help = ref(false);
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    identity.value = await api<Identity>('/login', {
      loginName: loginName.value,
      password: password.value,
    });
    password.value = '';
    await router.replace(identity.value.mustChangePassword ? '/password' : '/home');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="login-page">
    <section class="login-card">
      <a class="brand" href="/login"
        ><span class="brand-mark">S<span>↗</span></span
        ><span>SAP 智能交付工作台</span></a
      >
      <h1>登录工作台</h1>
      <p class="login-lead">使用管理员为你开通的账号。</p>
      <div v-if="route.query.changed" class="success-note" role="status">
        密码已更新，请使用新密码登录。
      </div>
      <form @submit.prevent="submit">
        <label for="login-name">账号</label>
        <input
          id="login-name"
          v-model="loginName"
          autocomplete="username"
          placeholder="请输入你的账号"
          required
          maxlength="64"
          autofocus
        />
        <label for="login-password">密码</label>
        <div class="password-field">
          <input
            id="login-password"
            v-model="password"
            :type="visible ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="请输入密码"
            required
            maxlength="256"
          /><button
            type="button"
            class="icon-button"
            :aria-label="visible ? '隐藏密码' : '显示密码'"
            @click="visible = !visible"
          >
            <AppIcon :name="visible ? 'eye-off' : 'eye'" />
          </button>
        </div>
        <p v-if="error" class="error-note" role="alert">{{ error }}</p>
        <button class="primary-button login-submit" :disabled="busy">
          {{ busy ? '正在验证账号…' : '登录' }}
        </button>
      </form>
      <button
        type="button"
        class="text-button login-help"
        :aria-expanded="help"
        @click="help = !help"
      >
        无法登录？
      </button>
      <p v-if="help" class="help-note">
        请联系部署管理员开通或恢复账号。首次初始化的临时密码位于本机 .runtime/initial-login.txt。
      </p>
    </section>
    <p class="login-foot">© {{ new Date().getFullYear() }} SAP 智能交付平台</p>
  </main>
</template>
<style scoped>
/* Sign-in (DESIGN.md 6.5): one centred card on the page ground. */
.login-page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-10) var(--space-4);
  background: var(--page);
  color: var(--text);
}
.login-card {
  width: 100%;
  max-width: 380px;
  padding: var(--space-8);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  box-shadow: var(--shadow-card);
}
.brand {
  margin-bottom: var(--space-8);
  font-size: var(--font-14);
}
.login-card h1 {
  font-size: var(--font-20);
  line-height: var(--leading-28);
  font-weight: var(--weight-550);
}
.login-lead {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-14);
}
form {
  margin-top: var(--space-6);
}
form label:first-child {
  margin-top: 0;
}
/* Browser autofill keeps the field colours. */
form input:-webkit-autofill {
  -webkit-text-fill-color: var(--text);
  box-shadow: 0 0 0 100px var(--panel) inset;
}
.password-field {
  position: relative;
}
.password-field input {
  padding-right: var(--space-10);
}
.password-field .icon-button {
  position: absolute;
  right: var(--space-0-5);
  top: 50%;
  width: var(--space-8);
  height: var(--space-6);
  transform: translateY(-50%);
}
.login-submit {
  width: 100%;
  margin-top: var(--space-6);
}
.login-submit:active:not(:disabled) {
  transform: scale(0.985);
}
.login-help {
  margin-top: var(--space-4);
}
.login-foot {
  color: var(--text-subtle);
  font-size: var(--font-12);
}
@media (max-width: 480px) {
  .login-page {
    justify-content: flex-start;
  }
  .login-card {
    padding: var(--space-6);
  }
}
</style>
