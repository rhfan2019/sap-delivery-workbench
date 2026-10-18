<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CONTRACT_ROLES,
  DEPLOYMENTS,
  METHODOLOGIES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  SAP_MODULES,
  SAP_PRODUCTS,
  TRANSPORT_METHODS,
} from '@sap-delivery-workbench/contracts/projects/options';
import BaseButton from '../../components/base/BaseButton.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { loadProjects } from '../../services/projectContext';
import { api } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import ChoiceChips from '../settings/ChoiceChips.vue';
import { useSave } from '../settings/useLoad';
import ProjectGate from './ProjectGate.vue';
import { useProject, type ProjectDetail } from './useProject';
import '../settings/settings.css';

// 项目 → 基本信息 (docs/specs/project-access-admin.md 1.1–1.2).
const { project, loading, error, reload, replace, can, readOnly } = useProject();
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
  'sapProduct',
  'sapRelease',
  'deployment',
  'modules',
  'language',
  'namespace',
  'defaultPackage',
  'transportMethod',
] as const;
type Draft = Pick<ProjectDetail, (typeof fields)[number]>;
const draft = ref<Draft | null>(null);
const pick = (p: ProjectDetail): Draft =>
  JSON.parse(JSON.stringify(Object.fromEntries(fields.map((f) => [f, p[f] ?? null])))) as Draft;
watch(project, (p) => (draft.value = p ? pick(p) : null), { immediate: true });
const basicKeys: (keyof Draft)[] = [
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
];
const landscapeKeys = fields.filter((f) => !basicKeys.includes(f));
const changed = (keys: readonly (keyof Draft)[]) =>
  !!project.value &&
  !!draft.value &&
  keys.some(
    (k) => JSON.stringify(draft.value![k] ?? null) !== JSON.stringify(project.value![k] ?? null),
  );
const editable = computed(() => can('project:edit') && !readOnly.value);
const basic = useSave(),
  landscape = useSave(),
  archive = useSave();
async function save(state: ReturnType<typeof useSave>) {
  const p = project.value!;
  const result = await state.run(() =>
    api<ProjectDetail>('/projects/' + p.id, { ...draft.value, rowVersion: p.rowVersion }, 'PATCH'),
  );
  if (result) {
    replace(result);
    toast('项目信息已保存。', 'green');
  }
}
async function archiveProject() {
  const p = project.value!;
  if (
    !(await askConfirmation(
      `归档后“${p.name}”的开发清单、助手对话与设置都只能查看，不能再修改，且不能撤销。确定归档吗？`,
    ))
  )
    return;
  if (
    await archive.run(() => api('/projects/' + p.id + '/archive', { rowVersion: p.rowVersion }))
  ) {
    toast('项目已归档。', 'green');
    await Promise.all([reload(), loadProjects()]);
  }
}
const options = (o: Record<string, string>) =>
  Object.entries(o).map(([value, label]) => ({ value, label }));
const moduleOptions = SAP_MODULES.map((m) => ({ value: m, label: m }));
const statuses = Object.entries(PROJECT_STATUSES).filter(([k]) => k !== 'archived');
</script>
<template>
  <SettingsPage
    title="基本信息"
    description="项目的基本信息与 SAP 系统形态。助手在每一轮对话中读取 SAP 系统形态。"
  >
    <ProjectGate :loading="loading" :error="error" :ready="!!draft" :archived="readOnly">
      <template v-if="draft && project">
        <SettingsCard
          title="项目信息"
          :editable="editable"
          :dirty="changed(basicKeys)"
          :saving="basic.busy.value"
          :error="basic.error.value"
          @save="save(basic)"
        >
          <SettingsField label="客户">
            <input class="s-input" :value="project.customerName" disabled />
          </SettingsField>
          <SettingsField
            label="项目编号"
            for="p-code"
            required
            help="企业内唯一，英文字母、数字、下划线或连字符。"
          >
            <input
              id="p-code"
              v-model="draft.code"
              class="s-input mono"
              maxlength="32"
              :disabled="!editable"
            />
          </SettingsField>
          <SettingsField label="项目名称" for="p-name" required>
            <input
              id="p-name"
              v-model="draft.name"
              class="s-input"
              maxlength="200"
              :disabled="!editable"
            />
          </SettingsField>
          <SettingsField
            label="简称"
            for="p-short"
            help="显示在项目切换器与设置菜单中，最多 20 字。"
          >
            <input
              id="p-short"
              v-model="draft.shortName"
              class="s-input"
              maxlength="20"
              :disabled="!editable"
            />
          </SettingsField>
          <SettingsField label="项目类型" for="p-type">
            <select id="p-type" v-model="draft.projectType" class="s-select" :disabled="!editable">
              <option v-for="o in options(PROJECT_TYPES)" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </SettingsField>
          <SettingsField label="项目状态" for="p-status">
            <div class="s-row">
              <select id="p-status" v-model="draft.status" class="s-select" :disabled="!editable">
                <option v-for="[value, label] in statuses" :key="value" :value="value">
                  {{ label }}
                </option>
              </select>
              <label class="s-check"
                ><input
                  v-model="draft.isPaused"
                  type="checkbox"
                  :disabled="!editable || !['preparing', 'active'].includes(draft.status)"
                />暂停</label
              >
            </div>
          </SettingsField>
          <SettingsField label="实施方法论" for="p-method">
            <select
              id="p-method"
              v-model="draft.methodology"
              class="s-select"
              :disabled="!editable"
            >
              <option v-for="o in options(METHODOLOGIES)" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </SettingsField>
          <SettingsField label="我方角色" for="p-role">
            <div class="s-row">
              <select
                id="p-role"
                v-model="draft.contractRole"
                class="s-select"
                :disabled="!editable"
              >
                <option v-for="o in options(CONTRACT_ROLES)" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <input
                v-if="draft.contractRole === 'subcontract'"
                v-model="draft.primeContractor"
                class="s-input"
                placeholder="总包方名称"
                aria-label="总包方名称"
                maxlength="200"
                :disabled="!editable"
              />
            </div>
          </SettingsField>
          <SettingsField label="计划起止" help="项目合同周期。">
            <div class="s-row">
              <input
                v-model="draft.plannedStartDate"
                class="s-input"
                type="date"
                aria-label="计划开始"
                :disabled="!editable"
              />
              <span class="s-note">至</span>
              <input
                v-model="draft.plannedEndDate"
                class="s-input"
                type="date"
                aria-label="计划结束"
                :disabled="!editable"
              />
            </div>
          </SettingsField>
          <SettingsField label="项目说明" for="p-desc">
            <textarea
              id="p-desc"
              v-model="draft.description"
              class="s-textarea"
              maxlength="4000"
              :disabled="!editable"
            />
          </SettingsField>
        </SettingsCard>

        <SettingsCard
          title="SAP 系统形态"
          description="决定助手能做什么、该怎么写代码，例如公有云不能写经典报表、对象名要遵守命名空间。"
          :editable="editable"
          :dirty="changed(landscapeKeys)"
          :saving="landscape.busy.value"
          :error="landscape.error.value"
          @save="save(landscape)"
        >
          <SettingsField label="SAP 产品" for="p-product">
            <div class="s-row">
              <select
                id="p-product"
                v-model="draft.sapProduct"
                class="s-select"
                :disabled="!editable"
              >
                <option :value="null">未设置</option>
                <option v-for="o in options(SAP_PRODUCTS)" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <input
                v-model="draft.sapRelease"
                class="s-input"
                placeholder="版本，如 S/4HANA 2023 FPS02"
                aria-label="产品版本"
                maxlength="60"
                :disabled="!editable"
              />
            </div>
          </SettingsField>
          <SettingsField label="部署形态" for="p-deploy">
            <select id="p-deploy" v-model="draft.deployment" class="s-select" :disabled="!editable">
              <option :value="null">未设置</option>
              <option v-for="o in options(DEPLOYMENTS)" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </SettingsField>
          <SettingsField label="实施模块" help="也是成员“模块范围”的可选项。">
            <ChoiceChips
              v-model="draft.modules"
              :options="moduleOptions"
              label="实施模块"
              :disabled="!editable"
            />
          </SettingsField>
          <SettingsField label="主语言" for="p-lang" help="SAP 系统登录语言的默认值，两位字母。">
            <input
              id="p-lang"
              v-model="draft.language"
              class="s-input mono"
              maxlength="2"
              :disabled="!editable"
            />
          </SettingsField>
          <SettingsField label="开发命名空间" for="p-ns" help="Z、Y 或 /XXX/。">
            <input
              id="p-ns"
              v-model="draft.namespace"
              class="s-input mono"
              maxlength="12"
              :disabled="!editable"
            />
          </SettingsField>
          <SettingsField label="默认开发包" for="p-pkg" help="写入开发方案的手工步骤。">
            <input
              id="p-pkg"
              v-model="draft.defaultPackage"
              class="s-input mono"
              maxlength="30"
              placeholder="如 ZFI_REPORT"
              :disabled="!editable"
            />
          </SettingsField>
          <SettingsField label="传输方式" for="p-transport" help="只登记，平台不管理传输请求。">
            <select
              id="p-transport"
              v-model="draft.transportMethod"
              class="s-select"
              :disabled="!editable"
            >
              <option :value="null">未设置</option>
              <option v-for="o in options(TRANSPORT_METHODS)" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </SettingsField>
        </SettingsCard>

        <SettingsCard
          v-if="can('project:archive') && !readOnly"
          title="归档项目"
          description="项目结束后归档：数据无限期保留，全部只读，不能撤销。"
        >
          <div>
            <BaseButton variant="danger" :loading="archive.busy.value" @click="archiveProject"
              >归档此项目</BaseButton
            >
          </div>
          <p v-if="archive.error.value" class="s-error" role="alert">{{ archive.error.value }}</p>
        </SettingsCard>
      </template>
    </ProjectGate>
  </SettingsPage>
</template>
