<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  MinusCircle,
  Plus,
  Search,
  Trash2,
} from '@lucide/vue';
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
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { api } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useSave } from '../settings/useLoad';
import HealthDrawer from './HealthDrawer.vue';
import MilestoneDrawer from './MilestoneDrawer.vue';
import ProjectGate from './ProjectGate.vue';
import {
  useProject,
  type HealthReport,
  type Milestone,
  type Phase,
  type ProjectDetail,
} from './useProject';
import '../settings/settings.css';

// 项目 → 计划与健康 (docs/specs/project-access-admin.md 1.3, 1.6): health and phases as settings
// cards, milestones as a settings list; adding a milestone or a health report is done in a
// drawer (DESIGN.md 6.2).
const { project, loading, error, replace, can, readOnly } = useProject();
const phases = ref<Phase[]>([]);
watch(project, (p) => (phases.value = p ? JSON.parse(JSON.stringify(p.phases)) : []), {
  immediate: true,
});
const phasesDirty = computed(
  () => !!project.value && JSON.stringify(phases.value) !== JSON.stringify(project.value.phases),
);
const planEditable = computed(() => can('project.plan:edit') && !readOnly.value);
const healthEditable = computed(() => can('project.health:edit') && !readOnly.value);
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
type MilestoneState = keyof typeof MILESTONE_STATES;
const stateClass: Record<MilestoneState, string> = {
  achieved: 'passed',
  delayed: 'failed',
  due: 'warning',
  upcoming: 'untested',
  unplanned: 'untested',
};
const stateIcon = {
  achieved: CheckCircle2,
  delayed: AlertCircle,
  due: Clock,
  upcoming: CalendarClock,
  unplanned: MinusCircle,
};
const milestones = computed(() =>
  (project.value?.milestones ?? []).map((m) => ({
    ...m,
    state: milestoneState(m) as MilestoneState,
  })),
);
const counts = computed(() => ({
  achieved: milestones.value.filter((m) => m.state === 'achieved').length,
  delayed: milestones.value.filter((m) => m.state === 'delayed').length,
}));
const query = ref('');
const stateFilter = ref('');
const page = ref(1);
const filtered = computed(() =>
  milestones.value.filter(
    (m) =>
      (!stateFilter.value || m.state === stateFilter.value) &&
      (m.name + phaseName(m.phaseKey) + m.notes)
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([query, stateFilter], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));

// The drawer holds one milestone or a health report at a time; opening another asks before
// dropping changes.
const panel = ref<'milestone' | 'health' | null>(null);
const editing = ref<Milestone | null>(null);
const drawer = ref<InstanceType<typeof MilestoneDrawer> | InstanceType<typeof HealthDrawer> | null>(
  null,
);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return (
    !drawer.value?.dirty ||
    (await askConfirmation(
      panel.value === 'health' ? '放弃尚未保存的健康度修改？' : '放弃尚未保存的里程碑修改？',
    ))
  );
}
async function openMilestone(m: Milestone | null) {
  if (!planEditable.value) return;
  if (panel.value === 'milestone' && m && editing.value?.id === m.id) return;
  if (panel.value && !(await canLeave())) return;
  editing.value = m;
  panel.value = 'milestone';
}
async function openReport() {
  if (!healthEditable.value || panel.value === 'health') return;
  if (panel.value && !(await canLeave())) return;
  editing.value = null;
  panel.value = 'health';
}
async function close() {
  if (await canLeave()) {
    panel.value = null;
    editing.value = null;
  }
}
useDrawerLeave(canLeave, () => !!drawer.value?.dirty);
function saved(result: ProjectDetail) {
  const kind = panel.value;
  replace(result);
  panel.value = null;
  editing.value = null;
  toast(kind === 'health' ? '健康度已更新。' : '里程碑已保存。', 'green');
}
const removal = useSave();
async function removeMilestone(m: Milestone) {
  if (!(await askConfirmation(`删除里程碑“${m.name}”？`))) return;
  const result = await removal.run(() =>
    api<ProjectDetail>(
      `/projects/${project.value!.id}/milestones/${m.id}`,
      { rowVersion: m.rowVersion },
      'DELETE',
    ),
  );
  if (result) {
    replace(result);
    if (editing.value?.id === m.id) {
      panel.value = null;
      editing.value = null;
    }
  }
}
const rowMenu = (m: Milestone) => [
  {
    label: '删除',
    icon: Trash2,
    danger: true,
    disabled: removal.busy.value || !!m.key,
    title: m.key ? '预置里程碑不能删除' : '',
    run: () => removeMilestone(m),
  },
];

const dimensions = Object.entries(HEALTH_DIMENSIONS) as [keyof typeof HEALTH_DIMENSIONS, string][];
const levelOf = (h: HealthReport, key: string) => h[key as 'overall'] as keyof typeof HEALTH;
const healthTone = { green: 'green', yellow: 'yellow', red: 'red' } as const;
const latest = computed(() => project.value?.health[0]);
</script>
<template>
  <SettingsPage
    title="计划与健康"
    description="SAP Activate 阶段、关键里程碑，以及项目经理每周更新的健康度。"
    wide
    :drawer="!!panel"
  >
    <ProjectGate :loading="loading" :error="error" :ready="!!project" :archived="readOnly">
      <template v-if="project">
        <SettingsCard
          title="项目健康度"
          :description="`每周更新一次；超过 ${HEALTH_STALE_DAYS} 天未更新会提示已过期。`"
        >
          <template #headerActions>
            <BaseButton v-if="healthEditable" size="sm" @click="openReport">更新健康度</BaseButton>
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

        <section class="s-list-section" aria-labelledby="milestones-title">
          <header class="s-list-head">
            <h2 id="milestones-title">里程碑</h2>
            <p>
              已达成 {{ counts.achieved }} 个<template v-if="counts.delayed"
                >，已延期 {{ counts.delayed }} 个</template
              >。开发冻结与上线会显示在开发清单与项目列表中。
            </p>
          </header>
          <p v-if="removal.error.value" class="s-error" role="alert">{{ removal.error.value }}</p>
          <div class="s-table-toolbar">
            <label class="s-table-search"
              ><Search :size="17" /><input
                v-model="query"
                aria-label="搜索里程碑"
                placeholder="搜索名称、阶段或说明" /></label
            ><select v-model="stateFilter" aria-label="筛选里程碑状态">
              <option value="">全部状态</option>
              <option v-for="(label, key) in MILESTONE_STATES" :key="key" :value="key">
                {{ label }}
              </option>
            </select>
            <div v-if="planEditable" class="s-table-actions">
              <button class="primary-button" @click="openMilestone(null)">
                <Plus :size="17" />新增里程碑
              </button>
            </div>
          </div>
          <div class="s-table-surface">
            <div v-if="!rows.length" class="s-table-empty">
              <Flag :size="32" />
              <h2>{{ query || stateFilter ? '没有匹配的里程碑' : '还没有里程碑' }}</h2>
              <p>
                {{
                  query || stateFilter
                    ? '调整搜索或筛选条件后再试。'
                    : '新增里程碑并填写计划日期后显示在这里。'
                }}
              </p>
            </div>
            <table v-else class="s-table">
              <thead>
                <tr>
                  <th>里程碑</th>
                  <th class="hide-narrow">所在阶段</th>
                  <th>日期</th>
                  <th>状态</th>
                  <th v-if="planEditable" class="actions-col">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="m in rows"
                  :key="m.id"
                  :class="{
                    clickable: planEditable,
                    selected: panel === 'milestone' && editing?.id === m.id,
                  }"
                  @click="openMilestone(m)"
                >
                  <td>
                    <button
                      class="s-table-name"
                      :disabled="!planEditable"
                      @click.stop="openMilestone(m)"
                    >
                      {{ m.name }}</button
                    ><span v-if="m.key" class="s-badge muted">预置</span>
                    <small>{{ m.notes || '—' }}</small>
                  </td>
                  <td class="hide-narrow">{{ phaseName(m.phaseKey) }}</td>
                  <td>
                    <span>{{ m.plannedOn ? '计划 ' + m.plannedOn : '未排期' }}</span
                    ><small v-if="m.achievedOn">实际 {{ m.achievedOn }}</small>
                  </td>
                  <td>
                    <span class="s-state" :class="stateClass[m.state]"
                      ><component :is="stateIcon[m.state]" :size="17" />{{
                        MILESTONE_STATES[m.state]
                      }}</span
                    >
                  </td>
                  <td v-if="planEditable">
                    <div class="s-row-actions" @click.stop>
                      <button class="text-button" @click="openMilestone(m)">编辑</button>
                      <SettingsRowMenu :label="m.name + '的更多操作'" :items="rowMenu(m)" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <footer class="s-table-footer">
              <span>共 {{ filtered.length }} 个里程碑</span>
              <div>
                <button
                  class="icon-button"
                  aria-label="上一页"
                  :disabled="page === 1"
                  @click="page--"
                >
                  <ChevronLeft :size="17" /></button
                ><span>{{ page }} / {{ pages }}</span
                ><button
                  class="icon-button"
                  aria-label="下一页"
                  :disabled="page === pages"
                  @click="page++"
                >
                  <ChevronRight :size="17" />
                </button>
              </div>
            </footer>
          </div>
        </section>
      </template>
    </ProjectGate>

    <MilestoneDrawer
      v-if="project && panel === 'milestone'"
      ref="drawer"
      :key="editing?.id ?? 'new'"
      :project-id="project.id"
      :milestone="editing"
      :phases="phases"
      @saved="saved"
      @close="close"
    />
    <HealthDrawer
      v-else-if="project && panel === 'health'"
      ref="drawer"
      :project-id="project.id"
      :latest="latest"
      @saved="saved"
      @close="close"
    />
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
</style>
