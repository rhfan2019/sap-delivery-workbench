<script setup lang="ts">
import { computed, ref } from 'vue';
import { CONTACT_ROLES } from '@sap-delivery-workbench/contracts/projects/options';
import { api } from '../../services/session';
import ChoiceChips from '../settings/ChoiceChips.vue';
import SettingsDrawer from '../settings/SettingsDrawer.vue';
import { useSave } from '../settings/useLoad';
import type { Contact, ProjectDetail } from './useProject';

// A customer contact of 团队与干系人 in the list's drawer (docs/specs/project-access-admin.md 1.4;
// DESIGN.md 5 “抽屉”). Contacts are an address book, not platform users. A contact opens to read
// unless its 编辑 was clicked (development-discipline.md 4.1).
const props = defineProps<{
  projectId: string;
  contact: Contact | null;
  editable: boolean;
  edit?: boolean;
  modules: { value: string; label: string }[];
}>();
const emit = defineEmits<{ saved: [project: ProjectDetail]; close: [] }>();
type ContactDraft = Omit<Contact, 'id' | 'rowVersion'> & { id?: string; rowVersion?: string };
const form = ref<ContactDraft>(
  props.contact
    ? { ...props.contact, modules: [...props.contact.modules] }
    : {
        name: '',
        title: '',
        department: '',
        contactRole: 'key_user',
        modules: [],
        phone: '',
        email: '',
        notes: '',
      },
);
const initial = JSON.stringify(form.value);
const dirty = computed(() => JSON.stringify(form.value) !== initial);
const reading = ref(!!props.contact && !props.edit);
function startEdit() {
  if (props.editable) reading.value = false;
}
function cancel() {
  if (!props.contact) return emit('close');
  form.value = JSON.parse(initial);
  save.error.value = '';
  reading.value = true;
}
const save = useSave();
async function submit() {
  if (save.busy.value || !form.value.name) return;
  const c = form.value;
  const base = `/projects/${props.projectId}/contacts`;
  const result = await save.run(() =>
    c.id ? api<ProjectDetail>(`${base}/${c.id}`, c, 'PATCH') : api<ProjectDetail>(base, c),
  );
  if (result) emit('saved', result);
}
defineExpose({ dirty, busy: save.busy, startEdit });
</script>
<template>
  <SettingsDrawer
    :title="contact?.name ?? '新增联系人'"
    :description="
      contact
        ? [CONTACT_ROLES[contact.contactRole as keyof typeof CONTACT_ROLES], contact.title]
            .filter(Boolean)
            .join(' · ')
        : '客户方人员以通讯录方式登记，不是平台用户。'
    "
    close-label="关闭联系人抽屉"
    note="电话与邮箱只对有权限的成员显示"
    :busy="save.busy.value"
    :reading="reading"
    :editable="editable"
    @close="emit('close')"
    @submit="submit"
    @edit="startEdit"
  >
    <p v-if="save.error.value" class="error-note" role="alert">{{ save.error.value }}</p>
    <fieldset class="s-fields" :class="{ reading }" :disabled="reading">
      <section>
        <h3>基本信息</h3>
        <label class="s-field"
          ><span>姓名 <b>*</b></span
          ><input v-model="form.name" maxlength="60" required autofocus :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>角色</span
          ><select v-model="form.contactRole" :disabled="save.busy.value">
            <option v-for="(label, key) in CONTACT_ROLES" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
        <label class="s-field"
          ><span>职务</span
          ><input
            v-model="form.title"
            maxlength="60"
            placeholder="如 财务经理"
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>部门</span
          ><input
            v-model="form.department"
            maxlength="60"
            placeholder="如 财务部"
            :disabled="save.busy.value"
        /></label>
      </section>
      <section>
        <h3>联系方式</h3>
        <label class="s-field"
          ><span>电话</span
          ><input
            v-model="form.phone"
            maxlength="40"
            placeholder="手机或座机"
            :disabled="save.busy.value"
        /></label>
        <label class="s-field"
          ><span>邮箱</span
          ><input
            v-model="form.email"
            type="email"
            maxlength="254"
            placeholder="name@example.com"
            :disabled="save.busy.value"
        /></label>
      </section>
      <section>
        <h3>负责与备注</h3>
        <div class="s-field top">
          <span>负责模块</span>
          <ChoiceChips v-model="form.modules" :options="modules" label="负责模块" />
        </div>
        <label class="s-field top"
          ><span>备注</span
          ><textarea
            v-model="form.notes"
            class="s-textarea"
            maxlength="500"
            placeholder="如 只在上午联系"
            :disabled="save.busy.value"
          />
        </label>
      </section>
    </fieldset>
    <template #actions>
      <button type="button" class="secondary-button" :disabled="save.busy.value" @click="cancel">
        取消</button
      ><button class="primary-button" :disabled="save.busy.value || !form.name">
        {{ save.busy.value ? '正在处理…' : '保存' }}
      </button>
    </template>
  </SettingsDrawer>
</template>
