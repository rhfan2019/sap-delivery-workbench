<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CONTRACT_ROLES,
  METHODOLOGIES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
} from '@sap-delivery-workbench/contracts/projects/options';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import { api, ApiError, identity } from '../../services/session';
import { allows } from '../access/permissions';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import type { ProjectDetail } from '../projects/useProject';
import type { DirectoryProject } from './api';

// A project's main data in the list's drawer (DESIGN.md 5 “抽屉”, docs/specs/project-access-admin.md
// 1.1–1.2): the fields of 基本信息, editable with project:edit while the project is not archived.
// The SAP landscape, team and plan stay in the project's settings.
const props = defineProps<{ project: DirectoryProject }>();
const emit = defineEmits<{ saved: [project: ProjectDetail]; close: []; settings: [] }>();
const fields = [
  'code',
  'name',
  'shortName',
  'projectType',
  'status',
  'isPaused',
  'methodology',
  'contractRole',
  'primeContractor',
  'description',
  'plannedStartDate',
  'plannedEndDate',
] as const;
type Draft = Pick<ProjectDetail, (typeof fields)[number]>;
const detail = ref<ProjectDetail | null>(null);
const draft = ref<Draft | null>(null);
const loading = ref(true);
// Outside the user's projects (404) the drawer shows the list's summary; other failures say so.
const hidden = ref(false);
const failed = ref('');
let initial = '';
onMounted(async () => {
  try {
    detail.value = await api<ProjectDetail>('/projects/' + props.project.id);
    draft.value = JSON.parse(
      JSON.stringify(Object.fromEntries(fields.map((f) => [f, detail.value![f] ?? null]))),
    ) as Draft;
    initial = JSON.stringify(draft.value);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) hidden.value = true;
    else failed.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
const archived = computed(() => props.project.status === 'archived');
const editable = computed(
  () =>
    !!detail.value &&
    detail.value.status !== 'archived' &&
    allows(detail.value.access, 'project:edit', undefined, identity.value?.user.id),
);
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== initial);
const ready = computed(() => !!draft.value?.code && !!draft.value?.name);
const statuses = computed(() =>
  Object.entries(PROJECT_STATUSES).filter(([k]) => k !== 'archived' || archived.value),
);
const save = useSave();
async function submit() {
  if (!editable.value || !ready.value || save.busy.value) return;
  const p = detail.value!;
  // The API takes the whole of 基本信息 and SAP 系统形态; the latter goes back unchanged.
  const next = await save.run(() =>
    api<ProjectDetail>(
      '/projects/' + p.id,
      { ...p, ...draft.value, rowVersion: p.rowVersion },
      'PATCH',
    ),
  );
  if (next) emit('saved', next);
}
const disabled = computed(() => !editable.value || save.busy.value);
defineExpose({ dirty, busy: save.busy });
</script>
<template>
  <SettingsDrawer
    :title="project.name"
    :description="project.code + ' · ' + project.customerName"
    close-label="关闭项目抽屉"
    :note="editable ? 'SAP 系统形态、团队与计划在项目设置中维护' : ''"
    :busy="save.busy.value"
    @close="emit('close')"
    @submit="submit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <BaseSkeleton v-if="loading" height="320px" />
    <template v-else-if="draft && detail">
      <p v-if="archived" class="s-drawer-note">项目已归档：项目及其全部数据只读、不可恢复。</p>
      <p v-else-if="!editable" class="s-drawer-note">
        你在该项目中没有修改项目信息的权限，只能查看。
      </p>
      <section>
        <h3>基本信息</h3>
        <label class="s-field"
          ><span>客户</span><input :value="detail.customerName" disabled
        /></label>
        <label class="s-field"
          ><span>项目编号 <b v-if="editable">*</b></span
          ><input v-model="draft.code" class="mono" maxlength="32" required :disabled="disabled"
        /></label>
        <label class="s-field"
          ><span>项目名称 <b v-if="editable">*</b></span
          ><input v-model="draft.name" maxlength="200" required :disabled="disabled"
        /></label>
        <label class="s-field"
          ><span>简称</span><input v-model="draft.shortName" maxlength="20" :disabled="disabled"
        /></label>
        <label class="s-field"
          ><span>项目类型</span
          ><select v-model="draft.projectType" :disabled="disabled">
            <option v-for="(label, key) in PROJECT_TYPES" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
        <label class="s-field"
          ><span>项目状态</span
          ><select v-model="draft.status" :disabled="disabled">
            <option v-for="[value, label] in statuses" :key="value" :value="value">
              {{ label }}
            </option>
          </select></label
        >
        <label class="s-check"
          ><input
            v-model="draft.isPaused"
            type="checkbox"
            :disabled="disabled || !['preparing', 'active'].includes(draft.status)"
          />暂停（只有筹备中或实施中的项目可以暂停）</label
        >
        <label class="s-field"
          ><span>实施方法论</span
          ><select v-model="draft.methodology" :disabled="disabled">
            <option v-for="(label, key) in METHODOLOGIES" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
        <label class="s-field"
          ><span>我方角色</span
          ><select v-model="draft.contractRole" :disabled="disabled">
            <option v-for="(label, key) in CONTRACT_ROLES" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
        <label v-if="draft.contractRole === 'subcontract'" class="s-field"
          ><span>总包方 <b v-if="editable">*</b></span
          ><input v-model="draft.primeContractor" maxlength="200" required :disabled="disabled"
        /></label>
        <label class="s-field top"
          ><span>项目说明</span
          ><textarea v-model="draft.description" maxlength="4000" :disabled="disabled" />
        </label>
      </section>
      <section>
        <h3>负责人与计划</h3>
        <div class="s-field">
          <span>项目经理</span
          ><span :class="{ muted: !detail.keyRoles.manager }">{{
            detail.keyRoles.manager?.displayName ?? '未指定'
          }}</span>
        </div>
        <div class="s-field">
          <span>当前阶段</span
          ><span :class="{ muted: !detail.currentPhase }">{{ detail.currentPhase ?? '—' }}</span>
        </div>
        <p class="s-drawer-help">项目经理与关键岗位在项目设置的“团队与干系人”中调整。</p>
        <label class="s-field"
          ><span>计划开始</span
          ><input v-model="draft.plannedStartDate" type="date" :disabled="disabled"
        /></label>
        <label class="s-field"
          ><span>计划结束</span
          ><input v-model="draft.plannedEndDate" type="date" :disabled="disabled"
        /></label>
      </section>
    </template>
    <p v-else-if="failed" class="error-note" role="alert">{{ failed }}</p>
    <template v-else-if="hidden">
      <p class="s-drawer-note">你不在该项目中，只能查看项目一览中的概要。</p>
      <section>
        <h3>基本信息</h3>
        <div class="s-field">
          <span>客户</span><span>{{ project.customerName }}</span>
        </div>
        <div class="s-field">
          <span>项目编号</span><span class="mono">{{ project.code }}</span>
        </div>
        <div class="s-field">
          <span>项目类型</span><span>{{ PROJECT_TYPES[project.projectType as 'other'] }}</span>
        </div>
        <div class="s-field">
          <span>项目状态</span><span>{{ PROJECT_STATUSES[project.status as 'active'] }}</span>
        </div>
      </section>
      <section>
        <h3>负责人与计划</h3>
        <div class="s-field">
          <span>项目经理</span><span>{{ project.managerName ?? '未指定' }}</span>
        </div>
        <div class="s-field">
          <span>计划起止</span
          ><span>{{ project.plannedStartDate ?? '—' }} 至 {{ project.plannedEndDate ?? '—' }}</span>
        </div>
      </section>
    </template>
    <template #actions>
      <button
        v-if="detail"
        type="button"
        class="text-button"
        :disabled="save.busy.value"
        @click="emit('settings')"
      >
        打开项目设置</button
      ><button
        type="button"
        class="secondary-button"
        :disabled="save.busy.value"
        @click="emit('close')"
      >
        {{ editable ? '取消' : '关闭' }}</button
      ><button
        v-if="editable"
        class="primary-button"
        :disabled="save.busy.value || !ready || !dirty"
      >
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
