<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  HEALTH,
  HEALTH_DIMENSIONS,
  HEALTH_STALE_DAYS,
  MILESTONE_STATES,
  PHASES,
  PHASE_STATUSES,
  milestoneState,
} from '@sap-delivery-workbench/contracts/projects/options';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { api } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import { useSave } from '../settings/useLoad';
import ProjectGate from './ProjectGate.vue';
import {
  useProject,
  type HealthReport,
  type Milestone,
  type Phase,
  type ProjectDetail,
} from './useProject';
import '../settings/settings.css';

// 项目 → 计划与健康 (docs/specs/project-access-admin.md 1.3, 1.6).
const { project, loading, error, replace, can, readOnly } = useProject();
const phases = ref<Phase[]>([]);
watch(project, (p) => (phases.value = p ? JSON.parse(JSON.stringify(p.phases)) : []), {
  immediate: true,
});
const phasesDirty = computed(
  () => !!project.value && JSON.stringify(phases.value) !== JSON.stringify(project.value.phases),
);
const planEditable = computed(() => can('project.plan:edit') && !readOnly.value);
const phaseSave = useSave();
async function savePhases() {
  const result = await phaseSave.run(() =>
    api<ProjectDetail>(`/projects/${project.value!.id}/phases`, { phases: phases.value }, 'PUT'),
  );
  if (result) {
    replace(result);
    toast('阶段已保存。', 'green');
  }
}

const phaseName = (key: string | null) =>
  phases.value.find((p) => p.key === key)?.name ?? PHASES.find((p) => p.key === key)?.name ?? '—';
const stateTone = {
  achieved: 'green',
  delayed: 'red',
  due: 'yellow',
  upcoming: 'neutral',
  unplanned: 'neutral',
} as const;
const milestones = computed(() =>
  (project.value?.milestones ?? []).map((m) => ({ ...m, state: milestoneState(m) })),
);
const counts = computed(() => ({
  achieved: milestones.value.filter((m) => m.state === 'achieved').length,
  delayed: milestones.value.filter((m) => m.state === 'delayed').length,
}));

const editing = ref<Partial<Milestone> | null>(null);
const milestoneSave = useSave();
function openMilestone(m?: Milestone) {
  milestoneSave.error.value = '';
  editing.value = m
    ? { ...m }
    : { name: '', phaseKey: 'realize', plannedOn: null, achievedOn: null, notes: '' };
}
async function saveMilestone() {
  const m = editing.value!;
  const base = `/projects/${project.value!.id}/milestones`;
  const result = await milestoneSave.run(() =>
    m.id ? api<ProjectDetail>(`${base}/${m.id}`, m, 'PATCH') : api<ProjectDetail>(base, m),
  );
  if (result) {
    replace(result);
    editing.value = null;
    toast('里程碑已保存。', 'green');
  }
}
async function removeMilestone(m: Milestone) {
  if (!(await askConfirmation(`删除里程碑“${m.name}”？`))) return;
  const result = await milestoneSave.run(() =>
    api<ProjectDetail>(
      `/projects/${project.value!.id}/milestones/${m.id}`,
      { rowVersion: m.rowVersion },
      'DELETE',
    ),
  );
  if (result) {
    replace(result);
    editing.value = null;
  }
}

const levels = Object.entries(HEALTH) as [keyof typeof HEALTH, string][];
const dimensions = Object.entries(HEALTH_DIMENSIONS) as [keyof typeof HEALTH_DIMENSIONS, string][];
const pickRows: [string, string][] = [['overall', '综合'], ...dimensions];
const levelOf = (h: HealthReport, key: string) => h[key as 'overall'] as keyof typeof HEALTH;
const healthTone = { green: 'green', yellow: 'yellow', red: 'red' } as const;
const latest = computed(() => project.value?.health[0]);
const reporting = ref<Record<string, string> | null>(null);
const healthSave = useSave();
function openReport() {
  healthSave.error.value = '';
  const base = latest.value;
  reporting.value = {
    overall: base?.overall ?? 'green',
    schedule: base?.schedule ?? 'green',
    scope: base?.scope ?? 'green',
    cost: base?.cost ?? 'green',
    quality: base?.quality ?? 'green',
    note: '',
  };
}
async function saveReport() {
  const result = await healthSave.run(() =>
    api<ProjectDetail>(`/projects/${project.value!.id}/health`, reporting.value),
  );
  if (result) {
    replace(result);
    reporting.value = null;
    toast('健康度已更新。', 'green');
  }
}
</script>
<template>
  <SettingsPage
    title="计划与健康"
    description="SAP Activate 阶段、关键里程碑，以及项目经理每周更新的健康度。"
    wide
  >
    <ProjectGate :loading="loading" :error="error" :ready="!!project" :archived="readOnly">
      <template v-if="project">
        <SettingsCard
          title="项目健康度"
          :description="`每周更新一次；超过 ${HEALTH_STALE_DAYS} 天未更新会提示已过期。`"
        >
          <template #headerActions>
            <BaseButton v-if="can('project.health:edit') && !readOnly" size="sm" @click="openReport"
              >更新健康度</BaseButton
            >
          </template>
          <div v-if="latest" class="health-now">
            <div class="health-overall">
              <BaseTag :tone="healthTone[latest.overall as 'green']"
                >综合 · {{ HEALTH[latest.overall as 'green'] }}</BaseTag
              >
              <BaseTag v-if="project.healthStale" tone="yellow">已过期</BaseTag>
              <span class="s-note">{{ latest.reportedOn }} · {{ latest.reportedBy }}</span>
            </div>
            <div class="health-dims">
              <span v-for="[key, label] in dimensions" :key="key" class="health-dim">
                <i :class="'dot ' + levelOf(latest, key)" aria-hidden="true"></i>{{ label }}
                {{ HEALTH[levelOf(latest, key)] }}
              </span>
            </div>
            <p v-if="latest.note" class="health-note">{{ latest.note }}</p>
            <details v-if="project.health.length > 1" class="health-history">
              <summary>历史（{{ project.health.length - 1 }} 次）</summary>
              <ul>
                <li v-for="h in project.health.slice(1)" :key="h.id">
                  <i :class="'dot ' + h.overall" aria-hidden="true"></i>{{ h.reportedOn }} ·
                  {{ HEALTH[h.overall as 'green'] }} · {{ h.reportedBy
                  }}<span v-if="h.note"> — {{ h.note }}</span>
                </li>
              </ul>
            </details>
          </div>
          <p v-else class="s-note">还没有健康度记录。</p>
        </SettingsCard>

        <SettingsCard
          title="阶段"
          description="当前阶段取第一个“进行中”的阶段。"
          :editable="planEditable"
          :dirty="phasesDirty"
          :saving="phaseSave.busy.value"
          :error="phaseSave.error.value"
          @save="savePhases"
        >
          <div class="phase-table" role="table" aria-label="阶段">
            <div class="phase-row head" role="row">
              <span role="columnheader">阶段</span><span role="columnheader">状态</span
              ><span role="columnheader">计划开始</span><span role="columnheader">计划结束</span
              ><span role="columnheader">实际开始</span><span role="columnheader">实际结束</span>
            </div>
            <div v-for="p in phases" :key="p.key" class="phase-row" role="row">
              <input
                v-model="p.name"
                class="s-input"
                :aria-label="p.key + ' 名称'"
                maxlength="30"
                :disabled="!planEditable"
              />
              <select
                v-model="p.status"
                class="s-select"
                :aria-label="p.name + ' 状态'"
                :disabled="!planEditable"
              >
                <option v-for="(label, key) in PHASE_STATUSES" :key="key" :value="key">
                  {{ label }}
                </option>
              </select>
              <input
                v-model="p.plannedStart"
                type="date"
                class="s-input"
                :aria-label="p.name + ' 计划开始'"
                :disabled="!planEditable"
              />
              <input
                v-model="p.plannedEnd"
                type="date"
                class="s-input"
                :aria-label="p.name + ' 计划结束'"
                :disabled="!planEditable"
              />
              <input
                v-model="p.actualStart"
                type="date"
                class="s-input"
                :aria-label="p.name + ' 实际开始'"
                :disabled="!planEditable"
              />
              <input
                v-model="p.actualEnd"
                type="date"
                class="s-input"
                :aria-label="p.name + ' 实际结束'"
                :disabled="!planEditable"
              />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          title="里程碑"
          :description="`已达成 ${counts.achieved} 个${counts.delayed ? `，已延期 ${counts.delayed} 个` : ''}。开发冻结与上线会显示在开发清单与项目列表中。`"
          flush
        >
          <template #headerActions>
            <BaseButton v-if="planEditable" size="sm" @click="openMilestone()"
              >新增里程碑</BaseButton
            >
          </template>
          <div class="s-list">
            <button
              v-for="m in milestones"
              :key="m.id"
              type="button"
              class="s-list-row"
              :disabled="!planEditable"
              @click="openMilestone(m)"
            >
              <span class="s-list-main">
                <strong>{{ m.name }}</strong>
                <small
                  >{{ phaseName(m.phaseKey)
                  }}<template v-if="m.notes"> · {{ m.notes }}</template></small
                >
              </span>
              <span class="s-list-side">
                <span v-if="m.achievedOn || m.plannedOn">{{
                  m.achievedOn ? '实际 ' + m.achievedOn : '计划 ' + m.plannedOn
                }}</span>
                <BaseTag :tone="stateTone[m.state as keyof typeof stateTone]">{{
                  MILESTONE_STATES[m.state as keyof typeof MILESTONE_STATES]
                }}</BaseTag>
              </span>
            </button>
          </div>
        </SettingsCard>
      </template>
    </ProjectGate>

    <BaseDialog
      :open="!!editing"
      :title="editing?.id ? '编辑里程碑' : '新增里程碑'"
      :description="
        editing?.key ? '预置里程碑可改名与改日期，不能删除；不需要时清空计划日期即可。' : undefined
      "
      @update:open="(v) => !v && (editing = null)"
    >
      <form v-if="editing" class="dialog-form" @submit.prevent="saveMilestone">
        <label>名称<input v-model="editing.name" class="s-input" maxlength="60" required /></label>
        <label
          >所在阶段<select v-model="editing.phaseKey" class="s-select">
            <option :value="null">未指定</option>
            <option v-for="p in phases" :key="p.key" :value="p.key">{{ p.name }}</option>
          </select></label
        >
        <div class="s-grid-2">
          <label>计划日期<input v-model="editing.plannedOn" type="date" class="s-input" /></label>
          <label>实际日期<input v-model="editing.achievedOn" type="date" class="s-input" /></label>
        </div>
        <label>说明<textarea v-model="editing.notes" class="s-textarea" maxlength="500" /></label>
        <p v-if="milestoneSave.error.value" class="s-error" role="alert">
          {{ milestoneSave.error.value }}
        </p>
      </form>
      <template #footer>
        <BaseButton
          v-if="editing?.id && !editing.key"
          variant="danger"
          class="dialog-left"
          @click="removeMilestone(editing as Milestone)"
          >删除</BaseButton
        >
        <BaseButton @click="editing = null">取消</BaseButton>
        <BaseButton
          variant="primary"
          :loading="milestoneSave.busy.value"
          :disabled="!editing?.name"
          @click="saveMilestone"
          >保存</BaseButton
        >
      </template>
    </BaseDialog>

    <BaseDialog
      :open="!!reporting"
      title="更新健康度"
      description="四个维度各取绿、黄、红；综合状态由你判断，不自动取最差值。"
      @update:open="(v) => !v && (reporting = null)"
    >
      <form v-if="reporting" class="dialog-form" @submit.prevent="saveReport">
        <fieldset v-for="[key, label] in pickRows" :key="key" class="health-pick">
          <legend>{{ label }}</legend>
          <label v-for="[level, name] in levels" :key="level" class="health-option" :class="level">
            <input v-model="reporting[key]" type="radio" :name="'h-' + key" :value="level" />
            <i :class="'dot ' + level" aria-hidden="true"></i>{{ name }}
          </label>
        </fieldset>
        <label
          >一句话说明<textarea
            v-model="reporting.note"
            class="s-textarea"
            maxlength="500"
            placeholder="如：蓝图签字延期一周，已调整开发计划"
          />
        </label>
        <p v-if="healthSave.error.value" class="s-error" role="alert">
          {{ healthSave.error.value }}
        </p>
      </form>
      <template #footer>
        <BaseButton @click="reporting = null">取消</BaseButton>
        <BaseButton variant="primary" :loading="healthSave.busy.value" @click="saveReport"
          >保存</BaseButton
        >
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.health-now {
  display: grid;
  gap: var(--space-3);
}
.health-overall,
.health-dims {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.health-dims {
  gap: var(--space-4);
}
.health-dim {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
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
.health-note {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-8);
  background: var(--neutral-bg-2);
}
.health-history summary {
  color: var(--text-muted);
  font-size: var(--font-12);
  cursor: pointer;
}
.health-history ul {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-12);
}
.health-history li {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
}
.phase-table {
  display: grid;
  gap: var(--space-1-5);
  overflow-x: auto;
}
.phase-row {
  display: grid;
  grid-template-columns: minmax(96px, 1.2fr) minmax(96px, 1fr) repeat(4, minmax(132px, 1fr));
  gap: var(--space-2);
  align-items: center;
  min-width: 840px;
}
.phase-row.head {
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
.dialog-form {
  display: grid;
  gap: var(--space-3);
}
.dialog-form label:not(.health-option) {
  display: grid;
  gap: var(--space-1);
  font-size: var(--font-12);
  color: var(--text-muted);
}
.dialog-left {
  margin-right: auto;
}
.health-pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}
.health-pick legend {
  float: left;
  width: 48px;
  color: var(--text-muted);
  font-size: var(--font-12);
}
.health-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  height: var(--control-tab);
  padding: 0 var(--space-2-5);
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
</style>
