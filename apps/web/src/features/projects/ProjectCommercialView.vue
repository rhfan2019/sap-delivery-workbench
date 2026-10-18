<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CONTRACT_MODELS } from '@sap-delivery-workbench/contracts/projects/options';
import BaseBanner from '../../components/base/BaseBanner.vue';
import { toast } from '../../components/base/toast';
import { api } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import { useSave } from '../settings/useLoad';
import ProjectGate from './ProjectGate.vue';
import { useProject, type ProjectDetail } from './useProject';
import '../settings/settings.css';

// 项目 → 规模与商务 (docs/specs/project-access-admin.md 1.5): visible with project.commercial:view.
const { project, loading, error, replace, can, readOnly } = useProject();
const editable = computed(() => can('project.commercial:edit') && !readOnly.value);
const draft = ref({
  contractNo: '',
  contractModel: null as string | null,
  contractDays: null as number | null,
  devBudgetDays: null as number | null,
  teamSize: null as number | null,
});
watch(
  project,
  (p) => {
    if (!p) return;
    draft.value = {
      contractNo: p.contractNo ?? '',
      contractModel: p.contractModel ?? null,
      contractDays: p.contractDays ?? null,
      devBudgetDays: p.devBudgetDays ?? null,
      teamSize: p.teamSize ?? null,
    };
  },
  { immediate: true },
);
const dirty = computed(() => {
  const p = project.value;
  if (!p) return false;
  const norm = (v: unknown) => (v === '' || v === undefined ? null : v);
  return (Object.keys(draft.value) as (keyof typeof draft.value)[]).some(
    (k) => norm(draft.value[k]) !== norm(p[k]),
  );
});
const state = useSave();
async function save() {
  const p = project.value!;
  const result = await state.run(() =>
    api<ProjectDetail>(
      `/projects/${p.id}/commercial`,
      { ...draft.value, rowVersion: p.rowVersion },
      'PATCH',
    ),
  );
  if (result) {
    replace(result);
    toast('商务信息已保存。', 'green');
  }
}
// Planned development days against the budget (section 1.5): over the budget turns red.
const usage = computed(() => {
  const p = project.value;
  if (!p?.devBudgetDays) return null;
  const planned = p.plannedDays ?? 0;
  return { planned, budget: p.devBudgetDays, ratio: planned / p.devBudgetDays };
});
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('zh-CN');
</script>
<template>
  <SettingsPage
    title="规模与商务"
    description="合同口径的人天与预算。只有持有商务权限的成员能看到本页。"
  >
    <ProjectGate :loading="loading" :error="error" :ready="!!project" :archived="readOnly">
      <template v-if="project">
        <BaseBanner v-if="!can('project.commercial:view')" tone="yellow"
          >你没有查看商务信息的权限。</BaseBanner
        >
        <template v-else>
          <SettingsCard
            title="开发人天"
            description="已计划人天 = 开发清单中 FSD 与开发阶段的人天预估之和，实时汇总。"
          >
            <div v-if="usage" class="budget">
              <div class="budget-numbers">
                <strong :class="{ over: usage.ratio > 1 }">{{ fmt(usage.planned) }}</strong>
                <span>/ {{ fmt(usage.budget) }} 人天</span>
                <span class="budget-percent" :class="{ over: usage.ratio > 1 }"
                  >{{ Math.round(usage.ratio * 100) }}%</span
                >
              </div>
              <div
                class="budget-bar"
                role="progressbar"
                :aria-valuenow="Math.round(usage.ratio * 100)"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="已计划人天占开发人天预算"
              >
                <span
                  :class="{ over: usage.ratio > 1 }"
                  :style="{ width: Math.min(usage.ratio, 1) * 100 + '%' }"
                ></span>
              </div>
              <p v-if="usage.ratio > 1" class="s-error">
                已计划人天超出预算 {{ fmt(usage.planned - usage.budget) }} 人天。
              </p>
            </div>
            <p v-else class="s-note">
              已计划 {{ fmt(project.plannedDays ?? 0) }} 人天。填写下方的开发人天预算后会显示进度。
            </p>
          </SettingsCard>
          <SettingsCard
            title="合同"
            :editable="editable"
            :dirty="dirty"
            :saving="state.busy.value"
            :error="state.error.value"
            @save="save"
          >
            <SettingsField label="合同编号" for="c-no">
              <input
                id="c-no"
                v-model="draft.contractNo"
                class="s-input mono"
                maxlength="60"
                :disabled="!editable"
              />
            </SettingsField>
            <SettingsField label="合同模式" for="c-model">
              <select
                id="c-model"
                v-model="draft.contractModel"
                class="s-select"
                :disabled="!editable"
              >
                <option :value="null">未设置</option>
                <option v-for="(label, key) in CONTRACT_MODELS" :key="key" :value="key">
                  {{ label }}
                </option>
              </select>
            </SettingsField>
            <SettingsField label="合同人天" for="c-days" help="一位小数。">
              <input
                id="c-days"
                v-model.number="draft.contractDays"
                class="s-input"
                type="number"
                min="0"
                step="0.5"
                :disabled="!editable"
              />
            </SettingsField>
            <SettingsField label="开发人天预算" for="c-dev" help="RICEFW 开发部分。">
              <input
                id="c-dev"
                v-model.number="draft.devBudgetDays"
                class="s-input"
                type="number"
                min="0"
                step="0.5"
                :disabled="!editable"
              />
            </SettingsField>
            <SettingsField label="计划团队规模" for="c-team">
              <input
                id="c-team"
                v-model.number="draft.teamSize"
                class="s-input"
                type="number"
                min="0"
                step="1"
                :disabled="!editable"
              />
            </SettingsField>
          </SettingsCard>
        </template>
      </template>
    </ProjectGate>
  </SettingsPage>
</template>
<style scoped>
.budget {
  display: grid;
  gap: var(--space-2);
}
.budget-numbers {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--text-muted);
}
.budget-numbers strong {
  color: var(--text);
  font-size: var(--font-24);
  font-weight: var(--weight-400);
  font-variant-numeric: tabular-nums;
}
.budget-percent {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.over {
  color: var(--red-text-2) !important;
}
.budget-bar {
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--neutral-fill-1);
  overflow: hidden;
}
.budget-bar span {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--blue-solid-1);
  transition: width var(--motion-slow);
}
.budget-bar span.over {
  background: var(--red-solid-1);
}
</style>
