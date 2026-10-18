<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CONTACT_ROLES,
  KEY_ROLES,
  SAP_MODULES,
} from '@sap-delivery-workbench/contracts/projects/options';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseDialog from '../../components/base/BaseDialog.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { api } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import ChoiceChips from '../settings/ChoiceChips.vue';
import { useSave } from '../settings/useLoad';
import ProjectGate from './ProjectGate.vue';
import { useProject, type Contact, type ProjectDetail } from './useProject';
import '../settings/settings.css';

// 项目 → 团队与干系人 (docs/specs/project-access-admin.md 1.4).
const { project, loading, error, replace, can, readOnly } = useProject();
const editable = computed(() => can('project.team:edit') && !readOnly.value);
const keyRoles = ref<Record<string, string | null>>({});
const leads = ref<Record<string, string | null>>({});
function reset(p: ProjectDetail | null) {
  if (!p) return;
  keyRoles.value = Object.fromEntries(
    Object.keys(KEY_ROLES).map((k) => [k, p.keyRoles[k]?.id ?? null]),
  );
  leads.value = Object.fromEntries(
    (p.modules.length ? p.modules : []).map((m) => [
      m,
      p.moduleLeads.find((l) => l.module === m)?.userId ?? null,
    ]),
  );
  for (const l of p.moduleLeads) if (!(l.module in leads.value)) leads.value[l.module] = l.userId;
}
watch(project, reset, { immediate: true });
const dirty = computed(() => {
  const p = project.value;
  if (!p) return false;
  const keysChanged = Object.keys(KEY_ROLES).some(
    (k) => (p.keyRoles[k]?.id ?? null) !== keyRoles.value[k],
  );
  const leadsChanged = Object.entries(leads.value).some(
    ([m, u]) => (p.moduleLeads.find((l) => l.module === m)?.userId ?? null) !== u,
  );
  return keysChanged || leadsChanged;
});
const team = useSave();
async function saveTeam() {
  const p = project.value!;
  const result = await team.run(() =>
    api<ProjectDetail>(
      `/projects/${p.id}/team`,
      {
        keyRoles: keyRoles.value,
        moduleLeads: Object.entries(leads.value)
          .filter(([, u]) => u)
          .map(([module, userId]) => ({ module, userId })),
        rowVersion: p.rowVersion,
      },
      'PUT',
    ),
  );
  if (result) {
    replace(result);
    toast('团队已保存。', 'green');
  }
}

type ContactDraft = Omit<Contact, 'id' | 'rowVersion'> & { id?: string; rowVersion?: string };
const editing = ref<ContactDraft | null>(null);
const contactSave = useSave();
const moduleOptions = computed(() =>
  (project.value?.modules.length ? project.value.modules : SAP_MODULES).map((m) => ({
    value: m,
    label: m,
  })),
);
function openContact(c?: Contact) {
  contactSave.error.value = '';
  editing.value = c
    ? { ...c, modules: [...c.modules] }
    : {
        name: '',
        title: '',
        department: '',
        contactRole: 'key_user',
        modules: [],
        phone: '',
        email: '',
        notes: '',
      };
}
async function saveContact() {
  const c = editing.value!;
  const base = `/projects/${project.value!.id}/contacts`;
  const result = await contactSave.run(() =>
    c.id ? api<ProjectDetail>(`${base}/${c.id}`, c, 'PATCH') : api<ProjectDetail>(base, c),
  );
  if (result) {
    replace(result);
    editing.value = null;
    toast('联系人已保存。', 'green');
  }
}
async function removeContact(c: Contact) {
  if (!(await askConfirmation(`删除联系人“${c.name}”？`))) return;
  const result = await contactSave.run(() =>
    api<ProjectDetail>(
      `/projects/${project.value!.id}/contacts/${c.id}`,
      { rowVersion: c.rowVersion },
      'DELETE',
    ),
  );
  if (result) {
    replace(result);
    editing.value = null;
  }
}
const roleTone = {
  customer_pm: 'blue',
  it_lead: 'purple',
  business_owner: 'green',
  key_user: 'yellow',
  other: 'neutral',
} as const;
</script>
<template>
  <SettingsPage title="团队与干系人" description="我方关键岗位、模块负责人，以及客户方联系人。">
    <ProjectGate :loading="loading" :error="error" :ready="!!project" :archived="readOnly">
      <template v-if="project">
        <SettingsCard
          title="我方团队"
          description="关键岗位与模块负责人取自项目成员；需要先在“成员与权限”中加入项目。"
          :editable="editable"
          :dirty="dirty"
          :saving="team.busy.value"
          :error="team.error.value"
          @save="saveTeam"
        >
          <SettingsField
            v-for="(label, key) in KEY_ROLES"
            :key="key"
            :label="label"
            :for="'kr-' + key"
          >
            <select
              :id="'kr-' + key"
              v-model="keyRoles[key]"
              class="s-select"
              :disabled="!editable"
            >
              <option :value="null">未指定</option>
              <option v-for="m in project.members" :key="m.id" :value="m.id">
                {{ m.displayName }}
              </option>
            </select>
          </SettingsField>
          <SettingsField
            label="模块负责人"
            :help="
              project.modules.length
                ? '每个实施模块一位负责顾问。'
                : '在“基本信息”中选择实施模块后可以指定。'
            "
          >
            <div class="lead-grid">
              <label v-for="(_, module) in leads" :key="module" class="lead">
                <BaseTag tone="blue">{{ module }}</BaseTag>
                <select
                  v-model="leads[module]"
                  class="s-select"
                  :aria-label="module + ' 模块负责人'"
                  :disabled="!editable"
                >
                  <option :value="null">未指定</option>
                  <option v-for="m in project.members" :key="m.id" :value="m.id">
                    {{ m.displayName }}
                  </option>
                </select>
              </label>
            </div>
          </SettingsField>
        </SettingsCard>

        <SettingsCard
          title="客户方联系人"
          description="客户方人员不是平台用户，以通讯录方式登记；电话与邮箱只对有“查看客户联系人”权限的成员显示。"
          flush
        >
          <template #headerActions>
            <BaseButton v-if="editable" size="sm" @click="openContact()">新增联系人</BaseButton>
          </template>
          <div v-if="project.contacts.length" class="s-list">
            <button
              v-for="c in project.contacts"
              :key="c.id"
              type="button"
              class="s-list-row"
              :disabled="!editable"
              @click="openContact(c)"
            >
              <BaseAvatar :name="c.name" :size="32" />
              <span class="s-list-main">
                <strong>{{ c.name }}</strong>
                <small>{{ [c.title, c.department].filter(Boolean).join(' · ') || '—' }}</small>
              </span>
              <span class="s-list-side">
                <BaseTag v-for="m in c.modules" :key="m" variant="outline">{{ m }}</BaseTag>
                <BaseTag :tone="roleTone[c.contactRole as keyof typeof roleTone]">{{
                  CONTACT_ROLES[c.contactRole as keyof typeof CONTACT_ROLES]
                }}</BaseTag>
                <span v-if="c.hidden">联系方式已隐藏</span>
                <span v-else>{{ [c.phone, c.email].filter(Boolean).join(' · ') }}</span>
              </span>
            </button>
          </div>
          <p v-else class="empty-note">还没有登记客户方联系人。</p>
        </SettingsCard>
      </template>
    </ProjectGate>

    <BaseDialog
      :open="!!editing"
      :title="editing?.id ? '编辑联系人' : '新增联系人'"
      wide
      @update:open="(v) => !v && (editing = null)"
    >
      <form v-if="editing" class="dialog-form" @submit.prevent="saveContact">
        <div class="s-grid-2">
          <label
            >姓名<input v-model="editing.name" class="s-input" maxlength="60" required
          /></label>
          <label
            >角色<select v-model="editing.contactRole" class="s-select">
              <option v-for="(label, key) in CONTACT_ROLES" :key="key" :value="key">
                {{ label }}
              </option>
            </select></label
          >
          <label>职务<input v-model="editing.title" class="s-input" maxlength="60" /></label>
          <label>部门<input v-model="editing.department" class="s-input" maxlength="60" /></label>
          <label>电话<input v-model="editing.phone" class="s-input" maxlength="40" /></label>
          <label
            >邮箱<input v-model="editing.email" class="s-input" type="email" maxlength="254"
          /></label>
        </div>
        <div class="dialog-field">
          <span>负责模块</span>
          <ChoiceChips v-model="editing.modules" :options="moduleOptions" label="负责模块" />
        </div>
        <label>备注<textarea v-model="editing.notes" class="s-textarea" maxlength="500" /></label>
        <p v-if="contactSave.error.value" class="s-error" role="alert">
          {{ contactSave.error.value }}
        </p>
      </form>
      <template #footer>
        <BaseButton
          v-if="editing?.id"
          variant="danger"
          class="dialog-left"
          @click="removeContact(editing as Contact)"
          >删除</BaseButton
        >
        <BaseButton @click="editing = null">取消</BaseButton>
        <BaseButton
          variant="primary"
          :loading="contactSave.busy.value"
          :disabled="!editing?.name"
          @click="saveContact"
          >保存</BaseButton
        >
      </template>
    </BaseDialog>
  </SettingsPage>
</template>
<style scoped>
.lead-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-2);
}
.lead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.lead :deep(.base-tag) {
  min-width: 48px;
  justify-content: center;
}
.empty-note {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-muted);
}
.dialog-form {
  display: grid;
  gap: var(--space-3);
}
.dialog-form label,
.dialog-field {
  display: grid;
  gap: var(--space-1);
  font-size: var(--font-12);
  color: var(--text-muted);
}
.dialog-left {
  margin-right: auto;
}
</style>
