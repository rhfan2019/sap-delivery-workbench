<script setup lang="ts">
import { computed, ref } from 'vue';
import { HEALTH, HEALTH_DIMENSIONS } from '@sap-delivery-workbench/contracts/projects/options';
import { api } from '../../services/session';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import type { HealthReport, ProjectDetail } from './useProject';

// Reporting the project's weekly health in a drawer (docs/specs/project-access-admin.md 1.6;
// DESIGN.md 5 “抽屉”): starts from the latest report.
const props = defineProps<{ projectId: string; latest?: HealthReport }>();
const emit = defineEmits<{ saved: [project: ProjectDetail]; close: [] }>();
const levels = Object.entries(HEALTH) as [keyof typeof HEALTH, string][];
const dimensions = Object.entries(HEALTH_DIMENSIONS) as [keyof typeof HEALTH_DIMENSIONS, string][];
const form = ref<Record<string, string>>({
  overall: props.latest?.overall ?? 'green',
  schedule: props.latest?.schedule ?? 'green',
  scope: props.latest?.scope ?? 'green',
  cost: props.latest?.cost ?? 'green',
  quality: props.latest?.quality ?? 'green',
  note: '',
});
const initial = JSON.stringify(form.value);
const dirty = computed(() => JSON.stringify(form.value) !== initial);
const save = useSave();
async function submit() {
  if (save.busy.value) return;
  const result = await save.run(() =>
    api<ProjectDetail>(`/projects/${props.projectId}/health`, form.value),
  );
  if (result) emit('saved', result);
}
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    title="更新健康度"
    description="四个维度各取绿、黄、红；综合状态由你判断，不自动取最差值。"
    close-label="关闭健康度抽屉"
    note="保存为一条新的健康度记录"
    :busy="save.busy.value"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <section>
      <h3>综合</h3>
      <div class="s-field" role="radiogroup" aria-label="综合">
        <span>综合状态</span>
        <div class="health-options">
          <label v-for="[level, name] in levels" :key="level" class="health-option">
            <input
              v-model="form.overall"
              type="radio"
              name="h-overall"
              :value="level"
              :disabled="save.busy.value"
            />
            <i :class="'dot ' + level" aria-hidden="true"></i>{{ name }}
          </label>
        </div>
      </div>
    </section>
    <section>
      <h3>维度</h3>
      <div
        v-for="[key, label] in dimensions"
        :key="key"
        class="s-field"
        role="radiogroup"
        :aria-label="label"
      >
        <span>{{ label }}</span>
        <div class="health-options">
          <label v-for="[level, name] in levels" :key="level" class="health-option">
            <input
              v-model="form[key]"
              type="radio"
              :name="'h-' + key"
              :value="level"
              :disabled="save.busy.value"
            />
            <i :class="'dot ' + level" aria-hidden="true"></i>{{ name }}
          </label>
        </div>
      </div>
    </section>
    <section>
      <h3>说明</h3>
      <label class="s-field top"
        ><span>一句话说明</span
        ><textarea
          v-model="form.note"
          class="s-textarea"
          maxlength="500"
          placeholder="如：蓝图签字延期一周，已调整开发计划"
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
      ><button class="primary-button" :disabled="save.busy.value">
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
<style scoped>
.health-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.health-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-6);
  cursor: pointer;
}
.health-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.health-option:has(input:checked) {
  border-color: var(--border-emphasis);
  background: var(--selected);
  font-weight: var(--weight-550);
}
.health-option:has(input:focus-visible) {
  box-shadow: 0 0 0 2px var(--focus);
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--neutral-fill-3);
}
.dot.green {
  background: var(--green-solid-1);
}
.dot.yellow {
  background: var(--yellow-solid-1);
}
.dot.red {
  background: var(--red-solid-1);
}
</style>
