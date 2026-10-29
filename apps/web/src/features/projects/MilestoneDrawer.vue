<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../../services/session';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import type { Milestone, Phase, ProjectDetail } from './useProject';

// Adding or editing a milestone of 计划与健康 in the list's drawer
// (docs/specs/project-access-admin.md 1.3; DESIGN.md 5 “抽屉”).
const props = defineProps<{
  projectId: string;
  milestone: Milestone | null;
  phases: Phase[];
}>();
const emit = defineEmits<{ saved: [project: ProjectDetail]; close: [] }>();
const form = ref<Partial<Milestone>>(
  props.milestone
    ? { ...props.milestone }
    : { name: '', phaseKey: 'realize', plannedOn: null, achievedOn: null, notes: '' },
);
const initial = JSON.stringify(form.value);
const dirty = computed(() => JSON.stringify(form.value) !== initial);
const save = useSave();
async function submit() {
  if (save.busy.value || !form.value.name) return;
  const m = form.value;
  const base = `/projects/${props.projectId}/milestones`;
  const result = await save.run(() =>
    m.id ? api<ProjectDetail>(`${base}/${m.id}`, m, 'PATCH') : api<ProjectDetail>(base, m),
  );
  if (result) emit('saved', result);
}
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    :title="milestone ? '编辑里程碑' : '新增里程碑'"
    description="填写计划日期；达成后补上实际日期。"
    close-label="关闭里程碑抽屉"
    note="开发冻结与上线显示在开发清单与项目列表中"
    :busy="save.busy.value"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <p v-if="milestone?.key" class="s-drawer-note">
      预置里程碑可改名与改日期，不能删除；不需要时清空计划日期即可。
    </p>
    <section>
      <h3>基本信息</h3>
      <label class="s-field"
        ><span>名称 <b>*</b></span
        ><input v-model="form.name" maxlength="60" required autofocus :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>所在阶段</span
        ><select v-model="form.phaseKey" :disabled="save.busy.value">
          <option :value="null">未指定</option>
          <option v-for="p in phases" :key="p.key" :value="p.key">{{ p.name }}</option>
        </select></label
      >
    </section>
    <section>
      <h3>日期</h3>
      <label class="s-field"
        ><span>计划日期</span
        ><input v-model="form.plannedOn" type="date" :disabled="save.busy.value"
      /></label>
      <label class="s-field"
        ><span>实际日期</span
        ><input v-model="form.achievedOn" type="date" :disabled="save.busy.value"
      /></label>
      <p class="s-drawer-help">有实际日期即为已达成；计划日期已过仍未达成显示为已延期。</p>
    </section>
    <section>
      <h3>说明</h3>
      <label class="s-field top"
        ><span>说明</span
        ><textarea
          v-model="form.notes"
          class="s-textarea"
          maxlength="500"
          :disabled="save.busy.value"
        />
      </label>
    </section>
    <template #actions>
      <button
        type="button"
        class="secondary-button"
        :disabled="save.busy.value"
        @click="emit('close')"
      >
        取消</button
      ><button class="primary-button" :disabled="save.busy.value || !form.name">
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
