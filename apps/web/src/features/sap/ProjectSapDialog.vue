<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import SapConfigPanel from './SapConfigPanel.vue';
import { askConfirmation } from '../../services/confirmation';
const props = defineProps<{ projectId: string; projectName: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null),
  panel = ref<InstanceType<typeof SapConfigPanel> | null>(null);
async function mayLeave() {
  if (panel.value?.busy) return false;
  return !panel.value?.dirty || (await askConfirmation('放弃未保存的 SAP 配置？'));
}
async function close() {
  if (!(await mayLeave())) return;
  emit('close');
}
onBeforeRouteLeave(mayLeave);
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog ref="dialog" class="sap-dialog" @cancel.prevent="close">
    <header>
      <h2>{{ props.projectName }} · 默认 SAP 系统</h2>
      <button class="secondary-button" :disabled="panel?.busy" @click="close">关闭</button>
    </header>
    <SapConfigPanel ref="panel" :path="'/admin/projects/' + projectId + '/sap'" mode="project" />
  </dialog>
</template>
