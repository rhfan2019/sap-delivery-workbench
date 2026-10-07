<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { api, type Project } from '../../services/session';
import { askConfirmation } from '../../services/confirmation';
import SapConfigPanel from './SapConfigPanel.vue';
const projects = ref<Project[]>([]),
  selected = ref(''),
  error = ref('');
const panel = ref<InstanceType<typeof SapConfigPanel> | null>(null);
async function mayLeave() {
  if (panel.value?.busy) return false;
  return !panel.value?.dirty || (await askConfirmation('放弃未保存的个人项目参数？'));
}
async function choose(event: Event) {
  const target = event.target as HTMLSelectElement;
  const next = target.value;
  target.value = selected.value;
  if (await mayLeave()) selected.value = next;
}
onBeforeRouteLeave(mayLeave);
defineExpose({ mayLeave });
onMounted(async () => {
  try {
    projects.value = await api<Project[]>('/projects');
    selected.value = projects.value[0]?.id ?? '';
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
<template>
  <section>
    <h2>项目参数</h2>
    <p class="sap-hint">为你参与的项目设置个人 SAP 参数，仅对本人有效。</p>
    <p v-if="error" class="error-note">{{ error }}</p>
    <label for="sap-personal-project">选择项目</label><br /><select
      id="sap-personal-project"
      class="sap-project-picker"
      :value="selected"
      :disabled="panel?.busy"
      @change="choose"
    >
      <option v-if="!projects.length" value="">暂无参与项目</option>
      <option v-for="p in projects" :key="p.id" :value="p.id">
        {{ p.name }} · {{ p.customerName }}
      </option></select
    ><SapConfigPanel
      v-if="selected"
      :key="selected"
      ref="panel"
      :path="'/projects/' + selected + '/sap'"
      mode="personal"
    />
  </section>
</template>
