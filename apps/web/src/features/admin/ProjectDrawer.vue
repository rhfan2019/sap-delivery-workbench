<script setup lang="ts">
import { computed, ref } from 'vue';
import { PROJECT_TYPES } from '@sap-delivery-workbench/contracts/projects/options';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import { adminApi, type AdminUser, type Customer } from './api';

// Creating a project in the list's drawer (DESIGN.md 5 “抽屉”): the backend adds the SAP Activate
// phases and milestones, and the chosen manager joins as 项目经理.
const props = defineProps<{ customers: Customer[]; users: AdminUser[] }>();
const emit = defineEmits<{ created: []; close: [] }>();
const draft = ref({
  customerId: props.customers[0]?.id ?? '',
  code: '',
  name: '',
  shortName: '',
  projectType: 'implementation',
  plannedStartDate: '',
  plannedEndDate: '',
  managerId: '',
});
const initial = JSON.stringify(draft.value);
const dirty = computed(() => JSON.stringify(draft.value) !== initial);
const ready = computed(() => !!draft.value.customerId && !!draft.value.code && !!draft.value.name);
const save = useSave();
async function submit() {
  if (!ready.value || save.busy.value) return;
  const created = await save.run(() =>
    adminApi.createProject({ ...draft.value, managerId: draft.value.managerId || null }),
  );
  if (created) emit('created');
}
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    title="新建项目"
    description="创建后自动生成 SAP Activate 六个阶段与九个预置里程碑。"
    close-label="关闭新建项目抽屉"
    note="创建后点开项目补充其余设置"
    :busy="save.busy.value"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <p v-if="!customers.length" class="s-drawer-note">请先在“客户”中建立有效的客户。</p>
    <section>
      <h3>基本信息</h3>
      <label class="s-field"
        ><span>客户 <b>*</b></span
        ><select v-model="draft.customerId" required :disabled="save.busy.value">
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select></label
      >
      <label class="s-field"
        ><span>项目编号 <b>*</b></span
        ><input
          v-model="draft.code"
          class="mono"
          maxlength="32"
          required
          autofocus
          :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>项目名称 <b>*</b></span
        ><input v-model="draft.name" maxlength="200" required :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>简称</span
        ><input v-model="draft.shortName" maxlength="20" :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>项目类型</span
        ><select v-model="draft.projectType" :disabled="save.busy.value">
          <option v-for="(label, key) in PROJECT_TYPES" :key="key" :value="key">
            {{ label }}
          </option>
        </select></label
      >
    </section>
    <section>
      <h3>负责人与计划</h3>
      <label class="s-field"
        ><span>项目经理</span
        ><select v-model="draft.managerId" :disabled="save.busy.value">
          <option value="">稍后在成员中指定</option>
          <option v-for="u in users" :key="u.id" :value="u.id">
            {{ u.displayName }}{{ u.position ? ' · ' + u.position.name : '' }}
          </option>
        </select></label
      >
      <p class="s-drawer-help">指定的项目经理会以“项目经理”角色加入项目。</p>
      <label class="s-field"
        ><span>计划开始</span
        ><input v-model="draft.plannedStartDate" type="date" :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>计划结束</span
        ><input v-model="draft.plannedEndDate" type="date" :disabled="save.busy.value"
      /></label>
    </section>
    <template #actions>
      <button
        type="button"
        class="secondary-button"
        :disabled="save.busy.value"
        @click="emit('close')"
      >
        取消</button
      ><button class="primary-button" :disabled="save.busy.value || !ready">
        {{ save.busy.value ? '正在处理…' : '创建' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
