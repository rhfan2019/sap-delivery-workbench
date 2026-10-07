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
    <section class="login-story">
      <a class="brand" href="/login"
        ><span class="brand-mark">S<span>↗</span></span
        ><span>SAP 智能交付<span class="brand-sub">DELIVERY WORKBENCH</span></span></a
      >
      <div class="story-body">
        <p class="eyebrow"><span class="tiny-line"></span> 从需求到价值 · 每一步皆可追溯</p>
        <h1>让专业，<br />成为交付的力量<span class="blue-dot">。</span></h1>
        <p class="story-description">
          连接业务洞察与技术实践，<br />在同一工作台，推进 SAP 项目的每一次交付。
        </p>
        <div class="delivery-art" aria-label="需求、设计、开发、测试交付流程">
          <div class="art-orbit orbit-one"></div>
          <div class="art-orbit orbit-two"></div>
          <div class="art-cross cross-one">+</div>
          <div class="art-cross cross-two">+</div>
          <div class="art-center">
            <AppIcon name="layers" :size="32" /><span>构建可信的交付闭环</span
            ><small>CONNECTED DELIVERY</small>
          </div>
          <div class="flow-steps">
            <span><b>01</b>需求 FS</span><i></i><span><b>02</b>设计 TS</span><i></i
            ><span><b>03</b>开发 DEV</span><i></i><span><b>04</b>测试 TEST</span>
          </div>
        </div>
      </div>
      <div class="story-footer">
        <span>SAP DELIVERY WORKBENCH</span><span>专业协作 · 持续沉淀</span>
      </div>
    </section>
    <section class="login-panel">
      <span class="edition"><span></span> 团队工作空间</span>
      <div class="login-form-wrap">
        <div class="form-symbol"><AppIcon name="lock" :size="25" /></div>
        <p class="eyebrow">WELCOME BACK</p>
        <h2>登录你的工作台</h2>
        <p class="muted">从这里出发，让下一次交付更进一步。</p>
        <div v-if="route.query.changed" class="success-note" role="status">
          密码已更新，请使用新密码登录。
        </div>
        <form @submit.prevent="submit">
          <label for="login-name">账号</label>
          <div class="input-wrap">
            <AppIcon name="users" /><input
              id="login-name"
              v-model="loginName"
              autocomplete="username"
              placeholder="请输入你的账号"
              required
              maxlength="64"
              autofocus
            />
          </div>
          <label for="login-password">密码</label>
          <div class="input-wrap">
            <AppIcon name="lock" /><input
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
          <div class="form-meta">
            <span><AppIcon name="shield" :size="14" /> 安全会话登录</span
            ><button type="button" class="text-button" @click="help = !help">无法登录？</button>
          </div>
          <p v-if="help" class="help-note">
            请联系部署管理员开通或恢复账号。首次初始化的临时密码位于本机
            .runtime/initial-login.txt。
          </p>
          <p v-if="error" class="error-note" role="alert">{{ error }}</p>
          <button class="primary-button login-submit" :disabled="busy">
            {{ busy ? '正在验证账号…' : '登录工作台' }}<AppIcon name="arrow" />
          </button>
        </form>
        <p class="login-hint">仅限已授权的企业与项目成员使用</p>
      </div>
      <footer class="login-footer">
        <span>© {{ new Date().getFullYear() }} SAP 智能交付平台</span><span>让交付有据可循</span>
      </footer>
    </section>
  </main>
</template>
