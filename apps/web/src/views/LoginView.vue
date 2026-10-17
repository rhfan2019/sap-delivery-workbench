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
// A sample development item, drawn with the workbench's own phases and statuses.
const phases = [
  { label: 'FSD', status: '已完成', tone: 'done' },
  { label: '开发', status: '进行中 60%', tone: 'active' },
  { label: '顾问测试', status: '未开始', tone: 'idle' },
  { label: 'IT/用户测试', status: '未开始', tone: 'idle' },
];
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
    <section class="login-intro">
      <header>
        <a class="brand" href="/login"
          ><span class="brand-mark">S<span>↗</span></span
          ><span>SAP 智能交付工作台</span></a
        >
      </header>
      <div class="intro-body">
        <h1 class="rise">每个开发项，<br />从说明书走到上线</h1>
        <p class="intro-lead rise">
          功能说明书、ABAP 开发和测试记录挂在同一个开发项上，团队随时知道它走到了哪一步。
        </p>
        <article class="item-preview rise" data-ui aria-label="开发项示例">
          <header>
            <h2>销售订单交付跟踪报表</h2>
            <p>SD · 报表 · 事务码 <code>ZSD012</code></p>
          </header>
          <ol>
            <li
              v-for="(phase, i) in phases"
              :key="phase.label"
              class="rise"
              :style="{ animationDelay: `${280 + i * 80}ms` }"
            >
              <span>{{ phase.label }}</span>
              <span class="phase-status" :class="phase.tone">{{ phase.status }}</span>
            </li>
          </ol>
          <footer>
            <span><AppIcon name="file" :size="16" />功能说明书 · 第 3 版</span>
            <span class="objects"
              ><code>VBAK</code><code>LIKP</code><code>ZSDR_DLV_TRACK</code></span
            >
          </footer>
        </article>
      </div>
      <p class="intro-foot">© {{ new Date().getFullYear() }} SAP 智能交付平台</p>
    </section>
    <section class="login-panel">
      <div class="login-form">
        <h2 class="rise">登录工作台</h2>
        <p class="login-lead rise">使用管理员为你开通的账号。</p>
        <div v-if="route.query.changed" class="success-note" role="status">
          密码已更新，请使用新密码登录。
        </div>
        <form class="rise" @submit.prevent="submit">
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
          <button
            type="button"
            class="text-button login-help"
            :aria-expanded="help"
            @click="help = !help"
          >
            无法登录？
          </button>
          <p v-if="help" class="help-note">
            请联系部署管理员开通或恢复账号。首次初始化的临时密码位于本机
            .runtime/initial-login.txt。
          </p>
        </form>
      </div>
    </section>
  </main>
</template>
<style scoped>
.login-page {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(360px, 1fr);
  background: var(--bg);
  color: var(--text);
}
.login-intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-8) clamp(var(--space-6), 6vw, var(--space-16));
}
.brand {
  font-size: var(--font-size-lg);
}
.intro-body {
  margin: auto 0;
  max-width: 720px;
}
.intro-body h1 {
  font-family: var(--font-display);
  font-size: var(--font-size-display);
  font-weight: var(--font-weight-semibold);
  line-height: 1.08;
  letter-spacing: -0.03em;
}
.intro-lead {
  max-width: 34em;
  margin-top: var(--space-6);
  font-size: var(--font-size-xl);
  line-height: 1.6;
  text-wrap: pretty;
}
.item-preview {
  margin-top: var(--space-12);
  max-width: 560px;
  padding: var(--space-5) var(--space-6);
  background: var(--surface);
  border: 1px solid var(--border); /* taste-skill-ignore: the item card of the product */
  border-radius: var(--card-radius);
}
.item-preview h2 {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}
.item-preview header p {
  margin-top: var(--space-1);
  color: var(--muted);
  font-size: var(--font-size-sm);
}
.item-preview ol {
  list-style: none;
  margin: var(--space-4) 0;
  padding: 0;
}
.item-preview li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 40px;
  border-top: 1px solid var(--border); /* taste-skill-ignore: table rows of the product */
  font-size: var(--font-size-md);
}
.phase-status {
  padding: var(--space-0-5) var(--space-2);
  border-radius: var(--badge-radius);
  font-size: var(--font-size-xs);
  font-weight: var(--badge-font-weight);
}
.phase-status.done {
  background: var(--success-bg);
  color: var(--success-text);
}
.phase-status.active {
  background: var(--active);
  color: var(--link);
}
.phase-status.idle {
  background: var(--surface-muted);
  color: var(--muted);
}
.item-preview footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--muted);
  font-size: var(--font-size-sm);
}
.item-preview footer > span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
}
.item-preview code {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  padding: var(--space-0-5) var(--space-1-5);
  border-radius: var(--radius-xs);
  background: var(--surface-muted);
  color: var(--text);
}
.objects {
  gap: var(--space-1);
}
.intro-foot {
  color: var(--muted);
  font-size: var(--font-size-sm);
}
.login-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-10) clamp(var(--space-6), 5vw, var(--space-16));
  background: var(--surface);
}
.login-form {
  width: 100%;
  max-width: 380px;
}
.login-form h2 {
  font-family: var(--font-display);
  font-size: var(--font-size-3xl);
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-letter-spacing);
}
.login-lead {
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--font-size-lg);
}
form {
  margin-top: var(--space-6);
}
form label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}
form input {
  height: 44px;
  border-radius: var(--input-radius);
  border-color: var(--input-border);
  background: var(--input-bg);
  font-size: var(--font-size-lg);
  transition: border-color 0.15s;
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
  margin-top: var(--space-8);
  font-size: var(--font-size-lg);
}
.login-submit:active:not(:disabled) {
  transform: scale(0.985);
}
.login-help {
  margin-top: var(--space-4);
  font-size: var(--font-size-sm);
}
.rise {
  animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.intro-lead.rise,
.login-lead.rise {
  animation-delay: 80ms;
}
form.rise {
  animation-delay: 160ms;
}
.item-preview.rise {
  animation-delay: 160ms;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rise {
    animation: none;
  }
}
@media (max-width: 950px) {
  .login-page {
    grid-template-columns: 1fr;
  }
  .login-intro {
    gap: var(--space-12);
    padding: var(--space-6) var(--space-4) var(--space-10);
  }
  .intro-body {
    margin: 0;
  }
  .intro-lead {
    font-size: var(--font-size-lg);
  }
  .item-preview,
  .intro-foot {
    display: none;
  }
  .login-panel {
    align-items: flex-start;
    justify-content: flex-start;
    padding: var(--space-8) var(--space-4) var(--space-12);
  }
}
</style>
