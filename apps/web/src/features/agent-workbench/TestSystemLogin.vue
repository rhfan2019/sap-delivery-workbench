<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { api } from '../../services/session';

// Contract 3.4: the user's own QAS user for this login, entered in a form the browser can
// remember. The server keeps it in memory only.
const props = withDefaults(defineProps<{ base: string; compact?: boolean }>(), {
  compact: false,
});
const emit = defineEmits<{ status: [system: TestSystem] }>();
interface TestSystem {
  configured: boolean;
  systemCode?: string;
  client?: string | null;
  username?: string;
  ready: boolean;
}
const projectId = computed(() => props.base.split('/')[2]);
const system = ref<TestSystem | null>(null),
  username = ref(''),
  password = ref(''),
  open = ref(!props.compact),
  busy = ref(false),
  error = ref('');
const path = () => `/projects/${projectId.value}/sap/test-system`;
function adopt(value: TestSystem) {
  system.value = value;
  username.value = value.username ?? username.value;
  emit('status', value);
}
onMounted(async () => {
  try {
    adopt(await api<TestSystem>(path()));
  } catch (e) {
    error.value = (e as Error).message;
  }
});
async function login() {
  busy.value = true;
  error.value = '';
  try {
    adopt(
      await api<TestSystem>(path(), { username: username.value, password: password.value }, 'POST'),
    );
    open.value = !props.compact;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    password.value = '';
    busy.value = false;
  }
}
async function logout() {
  try {
    adopt(await api<TestSystem>(path(), undefined, 'DELETE'));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div v-if="system?.configured" class="space-y-2 text-sm">
    <p class="text-xs text-muted-foreground">
      测试系统 QAS（{{ system.systemCode }} client {{ system.client }}）：
      <template v-if="system.ready"
        >已登录 {{ system.username }}
        <button type="button" class="underline" @click="logout">退出</button></template
      >
      <template v-else
        >未登录<button
          v-if="compact && !open"
          type="button"
          class="ml-1 underline"
          @click="open = true"
        >
          登录
        </button></template
      >
    </p>
    <form
      v-if="!system.ready && open"
      class="flex flex-wrap items-center gap-2"
      autocomplete="on"
      @submit.prevent="login"
    >
      <input
        v-model="username"
        name="username"
        autocomplete="username"
        required
        placeholder="您本人的 QAS 用户"
        class="rounded border px-2 py-1"
      />
      <input
        v-model="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
        placeholder="QAS 密码"
        class="rounded border px-2 py-1"
      />
      <Button type="submit" size="sm" :disabled="busy">{{
        busy ? '正在验证…' : '登录 QAS'
      }}</Button>
    </form>
    <p v-if="error" class="text-destructive" role="alert">{{ error }}</p>
  </div>
  <p v-else-if="system && !compact" class="text-sm text-destructive">
    项目未配置 QAS 系统，请联系管理员在项目参数中配置。
  </p>
</template>
