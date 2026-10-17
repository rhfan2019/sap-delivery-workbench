<script setup lang="ts">
import { ref } from 'vue';
import PasswordView from './PasswordView.vue';
import ProjectParameters from '../features/sap/ProjectParameters.vue';
const tab = ref('security'),
  parameters = ref<InstanceType<typeof ProjectParameters> | null>(null);
async function choose(next: string) {
  if (next === tab.value) return;
  if (tab.value === 'project' && !(await parameters.value?.mayLeave())) return;
  tab.value = next;
}
</script>
<template>
  <section>
    <header class="page-heading"><h1>个人设置</h1></header>
    <nav class="tabs sap-settings-tabs" aria-label="个人设置页签">
      <button :class="{ active: tab === 'security' }" @click="choose('security')">账号安全</button
      ><button :class="{ active: tab === 'project' }" @click="choose('project')">项目参数</button>
    </nav>
    <PasswordView v-if="tab === 'security'" /><ProjectParameters v-else ref="parameters" />
  </section>
</template>
