<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ChevronLeft,
  ChevronRight,
  Contact as ContactIcon,
  Plus,
  Search,
  Trash2,
} from '@lucide/vue';
import {
  CONTACT_ROLES,
  KEY_ROLES,
  SAP_MODULES,
} from '@sap-delivery-workbench/contracts/projects/options';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { toast } from '../../components/base/toast';
import { askConfirmation } from '../../services/confirmation';
import { api } from '../../services/session';
import SettingsPage from '../settings/SettingsPage.vue';
import SettingsCard from '../settings/SettingsCard.vue';
import SettingsField from '../settings/SettingsField.vue';
import SettingsRowMenu from '../settings/SettingsRowMenu.vue';
import { useDrawerLeave } from '../settings/useDrawerLeave';
import { useSave } from '../settings/useLoad';
import ContactDrawer from './ContactDrawer.vue';
import ProjectGate from './ProjectGate.vue';
import { useProject, type Contact, type ProjectDetail } from './useProject';
import '../settings/settings.css';

// 项目 → 团队与干系人 (docs/specs/project-access-admin.md 1.4): our key roles and module leads as
// a settings card, the customer's contacts as a settings list with its drawer (DESIGN.md 6.2).
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

const moduleOptions = computed(() =>
  (project.value?.modules.length ? project.value.modules : SAP_MODULES).map((m) => ({
    value: m,
    label: m,
  })),
);
const query = ref('');
const role = ref('');
const page = ref(1);
const contacts = computed(() => project.value?.contacts ?? []);
const filtered = computed(() =>
  contacts.value.filter(
    (c) =>
      (!role.value || c.contactRole === role.value) &&
      (c.name + c.title + c.department + c.modules.join('') + c.phone + c.email)
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([query, role], () => (page.value = 1));
watch(pages, (n) => (page.value = Math.min(n, page.value)));

// The drawer: one contact at a time; another row or “新增联系人” asks before dropping changes.
const open = ref(false);
const editing = ref<Contact | null>(null);
const drawer = ref<InstanceType<typeof ContactDrawer> | null>(null);
async function canLeave() {
  if (drawer.value?.busy) return false;
  return !drawer.value?.dirty || (await askConfirmation('放弃尚未保存的联系人修改？'));
}
async function openContact(c: Contact | null) {
  if (!editable.value) return;
  if (open.value && c && editing.value?.id === c.id) return;
  if (open.value && !(await canLeave())) return;
  editing.value = c;
  open.value = true;
}
async function close() {
  if (await canLeave()) {
    open.value = false;
    editing.value = null;
  }
}
useDrawerLeave(canLeave, () => !!drawer.value?.dirty);
function saved(result: ProjectDetail) {
  replace(result);
  open.value = false;
  editing.value = null;
  toast('联系人已保存。', 'green');
}
const removal = useSave();
async function removeContact(c: Contact) {
  if (!(await askConfirmation(`删除联系人“${c.name}”？`))) return;
  const result = await removal.run(() =>
    api<ProjectDetail>(
      `/projects/${project.value!.id}/contacts/${c.id}`,
      { rowVersion: c.rowVersion },
      'DELETE',
    ),
  );
  if (result) {
    replace(result);
    if (editing.value?.id === c.id) {
      open.value = false;
      editing.value = null;
    }
  }
}
const rowMenu = (c: Contact) => [
  {
    label: '删除',
    icon: Trash2,
    danger: true,
    disabled: removal.busy.value,
    run: () => removeContact(c),
  },
];
const roleTone = {
  customer_pm: 'blue',
  it_lead: 'purple',
  business_owner: 'green',
  key_user: 'yellow',
  other: 'neutral',
} as const;
</script>
<template>
  <SettingsPage
    title="团队与干系人"
    description="我方关键岗位、模块负责人，以及客户方联系人。"
    wide
    :drawer="open"
  >
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

        <section class="s-list-section" aria-labelledby="contacts-title">
          <header class="s-list-head">
            <h2 id="contacts-title">客户方联系人</h2>
            <p>
              客户方人员不是平台用户，以通讯录方式登记；电话与邮箱只对有“查看客户联系人”权限的成员显示。
            </p>
          </header>
          <p v-if="removal.error.value" class="s-error" role="alert">{{ removal.error.value }}</p>
          <div class="s-table-toolbar">
            <label class="s-table-search"
              ><Search :size="17" /><input
                v-model="query"
                aria-label="搜索联系人"
                placeholder="搜索姓名、职务、部门或模块" /></label
            ><select v-model="role" aria-label="筛选联系人角色">
              <option value="">全部角色</option>
              <option v-for="(label, key) in CONTACT_ROLES" :key="key" :value="key">
                {{ label }}
              </option>
            </select>
            <div v-if="editable" class="s-table-actions">
              <button class="primary-button" @click="openContact(null)">
                <Plus :size="17" />新增联系人
              </button>
            </div>
          </div>
          <div class="s-table-surface">
            <div v-if="!rows.length" class="s-table-empty">
              <ContactIcon :size="32" />
              <h2>{{ query || role ? '没有匹配的联系人' : '还没有登记客户方联系人' }}</h2>
              <p>
                {{
                  query || role
                    ? '调整搜索或筛选条件后再试。'
                    : '登记客户方项目经理、IT 负责人与关键用户后显示在这里。'
                }}
              </p>
            </div>
            <table v-else class="s-table">
              <thead>
                <tr>
                  <th>联系人</th>
                  <th>角色</th>
                  <th class="hide-narrow">负责模块</th>
                  <th>联系方式</th>
                  <th v-if="editable" class="actions-col">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="c in rows"
                  :key="c.id"
                  :class="{ clickable: editable, selected: open && editing?.id === c.id }"
                  @click="openContact(c)"
                >
                  <td>
                    <div class="s-table-person">
                      <BaseAvatar :name="c.name" :size="32" />
                      <div>
                        <button
                          class="s-table-name"
                          :disabled="!editable"
                          @click.stop="openContact(c)"
                        >
                          {{ c.name }}
                        </button>
                        <small>{{
                          [c.title, c.department].filter(Boolean).join(' · ') || '—'
                        }}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <BaseTag :tone="roleTone[c.contactRole as keyof typeof roleTone]">{{
                      CONTACT_ROLES[c.contactRole as keyof typeof CONTACT_ROLES]
                    }}</BaseTag>
                  </td>
                  <td class="hide-narrow">
                    <div v-if="c.modules.length" class="s-table-tags">
                      <BaseTag v-for="m in c.modules" :key="m" variant="outline">{{ m }}</BaseTag>
                    </div>
                    <span v-else>—</span>
                  </td>
                  <td>
                    <span v-if="c.hidden" class="s-state untested">联系方式已隐藏</span>
                    <template v-else>
                      <span>{{ c.phone || '—' }}</span
                      ><small v-if="c.email">{{ c.email }}</small>
                    </template>
                  </td>
                  <td v-if="editable">
                    <div class="s-row-actions" @click.stop>
                      <button class="text-button" @click="openContact(c)">编辑</button>
                      <SettingsRowMenu :label="c.name + '的更多操作'" :items="rowMenu(c)" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <footer class="s-table-footer">
              <span>共 {{ filtered.length }} 位联系人</span>
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

    <ContactDrawer
      v-if="project && open"
      ref="drawer"
      :key="editing?.id ?? 'new'"
      :project-id="project.id"
      :contact="editing"
      :modules="moduleOptions"
      @saved="saved"
      @close="close"
    />
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
</style>
