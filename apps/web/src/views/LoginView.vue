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
.login-page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-10) var(--space-4);
  background: var(--bg);
  color: var(--text);
}
.login-card {
  width: 100%;
  max-width: 400px;
  padding: var(--space-8);
  background: var(--card-bg);
  border: var(--card-border-width) solid var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}
.brand {
  margin-bottom: var(--space-8);
  font-size: var(--font-size-lg);
}
.login-card h1 {
  font-family: var(--font-display);
  font-size: var(--font-size-2xl);
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-letter-spacing);
}
.login-lead {
  margin-top: var(--space-1-5);
  color: var(--muted);
  font-size: var(--font-size-md);
}
form {
  margin-top: var(--space-6);
}
form label {
  margin-top: var(--space-4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}
form label:first-child {
  margin-top: 0;
}
form input {
  height: 44px;
  border-radius: var(--input-radius);
  border-color: var(--input-border);
  background: var(--input-bg);
  font-size: var(--font-size-lg);
  transition: border-color 0.15s;
}
/* Browser autofill keeps the theme's field colours. */
form input:-webkit-autofill {
  -webkit-text-fill-color: var(--text);
  box-shadow: 0 0 0 100px var(--input-bg) inset;
}
form input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
  border-color: var(--input-focus-border);
}
.password-field {
  position: relative;
}
.password-field input {
  padding-right: var(--space-12);
}
.password-field .icon-button {
  position: absolute;
  right: var(--space-1-5);
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
}
.password-field .icon-button:hover {
  background: var(--hover);
}
.login-submit {
  width: 100%;
  height: 44px;
  margin-top: var(--space-6);
  font-size: var(--font-size-lg);
}
.login-submit:active:not(:disabled) {
  transform: scale(0.985);
}
.login-help {
  margin-top: var(--space-4);
  font-size: var(--font-size-sm);
}
.login-foot {
  color: var(--muted);
  font-size: var(--font-size-xs);
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
