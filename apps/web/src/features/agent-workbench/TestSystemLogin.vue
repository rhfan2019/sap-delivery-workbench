<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import SapLoginDialog from '../sap/SapLoginDialog.vue';
import { credentialLabel, sapApi } from '../sap/api';
import { useProjectSap } from '../sap/useProjectSap';

// Contract 3.4: the project's default test system and the user's own login to it, for test data.
// Logging in uses the shared SAP login (this login only, or saved under the policy).
const props = withDefaults(defineProps<{ base: string; compact?: boolean }>(), {
  compact: false,
});
const emit = defineEmits<{ status: [system: { ready: boolean }] }>();
const projectId = computed(() => props.base.split('/')[2] ?? '');
const sap = useProjectSap(() => projectId.value);
onMounted(() => sap.reload());
const system = computed(() => sap.defaultOf('test'));
const ready = computed(() => !!system.value && system.value.credential?.state !== 'none');
watch(ready, (value) => emit('status', { ready: value }), { immediate: true });
const loginOpen = ref(false);
const error = ref('');
async function logout() {
  if (!system.value) return;
  try {
    sap.adopt(await sapApi.logout(projectId.value, system.value.id));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div v-if="system" class="space-y-2 text-sm">
    <p class="text-xs text-muted-foreground">
      测试系统 {{ system.sid }} client {{ system.client }}：
      <template v-if="ready"
        >{{ credentialLabel[system.credential!.state] }}
        {{ system.credential?.username }}
        <button
          v-if="system.credential?.state !== 'profile'"
          type="button"
          class="underline"
          @click="logout"
        >
          退出
        </button></template
      >
      <template v-else>未登录</template>
    </p>
    <Button v-if="!ready && !compact" type="button" size="sm" @click="loginOpen = true"
      >用本人的 SAP 用户登录测试系统</Button
    >
    <button v-else-if="!ready" type="button" class="text-xs underline" @click="loginOpen = true">
      登录
    </button>
    <p v-if="error" class="text-destructive" role="alert">{{ error }}</p>
    <SapLoginDialog
      v-if="sap.view.value"
      v-model:open="loginOpen"
      :project-id="projectId"
      :system="system"
      :can-save="sap.view.value.canSave"
      :policy="sap.view.value.policy"
      :profile-login="sap.view.value.profileLogin"
      @saved="sap.adopt"
    />
  </div>
  <p v-else-if="sap.view.value && !compact" class="text-sm text-destructive">
    项目还没有登记测试系统，请项目经理在“设置 → 项目 → SAP 系统”中登记。
  </p>
</template>
