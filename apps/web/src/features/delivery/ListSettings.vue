<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { X, Plus, Archive, ArchiveRestore, Trash2 } from '@lucide/vue';
import { api } from '../../services/session';
import { askConfirmation } from '../../services/confirmation';
import { CUSTOM_TYPES, TAG_COLORS } from '@sap-delivery-workbench/contracts/delivery/fields';
import { GROUPS, type CustomFieldDefinition, type Tag } from './model';

// Project vocabulary of the list: custom columns (project admins) and tags.
const props = defineProps<{
  projectId: string;
  fields: CustomFieldDefinition[];
  tags: Tag[];
  canConfigure: boolean;
  readOnly: boolean;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const dialog = ref<HTMLDialogElement>();
const busy = ref(false);
const error = ref('');
const notice = ref('');
const fieldBase = computed(() => `/projects/${props.projectId}/development-fields`);
const tagBase = computed(() => `/projects/${props.projectId}/development-tags`);
const canEditFields = computed(() => props.canConfigure && !props.readOnly);
type Draft = {
  id?: string;
  label: string;
  fieldType: string;
  groupKey: string;
  required: boolean;
  options: { id?: string; label: string; color?: string }[];
  rowVersion?: string;
};
const draft = ref<Draft | null>(null);
const hasOptions = computed(() =>
  ['select', 'multi_select'].includes(draft.value?.fieldType ?? ''),
);
const groupLabel = (key: string) => GROUPS.find((g) => g.key === key)?.label ?? key;
function newField() {
  draft.value = { label: '', fieldType: 'text', groupKey: 'custom', required: false, options: [] };
  error.value = '';
}
function edit(f: CustomFieldDefinition) {
  draft.value = {
    id: f.id,
    label: f.label,
    fieldType: f.fieldType,
    groupKey: f.groupKey,
    required: f.required,
    options: f.options.map((o) => ({ ...o })),
    rowVersion: f.rowVersion,
  };
  error.value = '';
}
async function run(action: () => Promise<unknown>, done: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = done;
    emit('changed');
    return true;
  } catch (e) {
    error.value = (e as Error).message;
    return false;
  } finally {
    busy.value = false;
  }
}
async function saveField() {
  const d = draft.value!;
  const body = {
    label: d.label,
    groupKey: d.groupKey,
    required: d.required,
    ...(hasOptions.value ? { options: d.options.filter((o) => o.label.trim()) } : {}),
  };
  const ok = await run(
    () =>
      d.id
        ? api(fieldBase.value + '/' + d.id, { ...body, rowVersion: d.rowVersion }, 'PATCH')
        : api(fieldBase.value, { ...body, fieldType: d.fieldType }),
    d.id ? `已更新列“${d.label}”` : `已新增列“${d.label}”`,
  );
  if (ok) draft.value = null;
}
async function archive(f: CustomFieldDefinition, archived: boolean) {
  if (
    archived &&
    !(await askConfirmation(
      `归档列“${f.label}”？归档后列表和导出中不再显示，已填写的数据保留，可随时恢复。`,
    ))
  )
    return;
  await run(
    () => api(fieldBase.value + '/' + f.id, { rowVersion: f.rowVersion, archived }, 'PATCH'),
    archived ? `已归档“${f.label}”` : `已恢复“${f.label}”`,
  );
}
async function updateTag(t: Tag, patch: Partial<Tag>) {
  await run(() => api(tagBase.value + '/' + t.id, patch, 'PATCH'), '标签已更新');
}
async function removeTag(t: Tag) {
  if (
    !(await askConfirmation(
      `确定删除标签“${t.name}”吗？它会从 ${t.usage} 个开发项上移除，此操作不能撤销。`,
    ))
  )
    return;
  await run(() => api(tagBase.value + '/' + t.id, undefined, 'DELETE'), `已删除标签“${t.name}”`);
}
onMounted(() => dialog.value?.showModal());
</script>

<template>
  <dialog
    ref="dialog"
    class="settings-dialog"
    aria-labelledby="settings-title"
    @cancel.prevent="emit('close')"
  >
    <header>
      <div>
        <h2 id="settings-title">清单设置</h2>
        <p>维护本项目开发清单的自定义列和标签。</p>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭清单设置"
        :disabled="busy"
        @click="emit('close')"
      >
        <X :size="20" />
      </button>
    </header>
    <div class="settings-body">
      <p v-if="error" class="error-note" role="alert">{{ error }}</p>
      <p v-if="notice" class="success-note" role="status">{{ notice }}</p>
      <section class="drawer-section">
        <header class="section-title">
          <h3>自定义列</h3>
          <button
            v-if="canEditFields && !draft"
            type="button"
            class="text-button"
            @click="newField"
          >
            <Plus :size="14" />新增列
          </button>
        </header>
        <p v-if="!canConfigure" class="help-note">需要“维护清单设置”权限才能新增或修改自定义列。</p>
        <form v-if="draft" class="field-form" @submit.prevent="saveField">
          <label
            >列名称<input v-model="draft.label" maxlength="50" required :disabled="busy"
          /></label>
          <label
            >类型<select v-model="draft.fieldType" :disabled="busy || !!draft.id">
              <option v-for="(label, key) in CUSTOM_TYPES" :key="key" :value="key">
                {{ label }}
              </option>
            </select></label
          >
          <label
            >显示在<select v-model="draft.groupKey" :disabled="busy">
              <option v-for="g in GROUPS" :key="g.key" :value="g.key">{{ g.label }}</option>
            </select></label
          >
          <label class="check-input"
            ><input v-model="draft.required" type="checkbox" :disabled="busy" />必填</label
          >
          <div v-if="hasOptions" class="option-editor">
            <span>选项</span>
            <div v-for="(o, i) in draft.options" :key="o.id ?? 'new' + i" class="option-row">
              <input
                v-model="o.label"
                maxlength="50"
                :aria-label="'选项 ' + (i + 1)"
                :disabled="busy"
              />
              <button
                v-if="!o.id"
                type="button"
                class="icon-button"
                aria-label="删除此选项"
                @click="draft.options.splice(i, 1)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
            <button
              type="button"
              class="text-button"
              :disabled="busy"
              @click="draft.options.push({ label: '' })"
            >
              <Plus :size="14" />添加选项
            </button>
            <small v-if="draft.id">已有选项可以改名，不能删除（避免已填写的数据失效）。</small>
          </div>
          <div class="form-actions">
            <button type="button" class="secondary-button" :disabled="busy" @click="draft = null">
              取消</button
            ><button class="primary-button" :disabled="busy">
              {{ draft.id ? '保存' : '新增' }}
            </button>
          </div>
        </form>
        <ul class="settings-list">
          <li v-for="f in fields" :key="f.id" :class="{ archived: f.archivedAt }">
            <span class="settings-name"
              >{{ f.label
              }}<small
                >{{ CUSTOM_TYPES[f.fieldType] }} · {{ groupLabel(f.groupKey)
                }}{{ f.required ? ' · 必填' : '' }}{{ f.archivedAt ? ' · 已归档' : '' }}</small
              ></span
            >
            <span v-if="canEditFields" class="settings-actions">
              <button
                v-if="!f.archivedAt"
                type="button"
                class="text-button"
                :disabled="busy"
                @click="edit(f)"
              >
                编辑</button
              ><button
                type="button"
                class="icon-button"
                :aria-label="(f.archivedAt ? '恢复 ' : '归档 ') + f.label"
                :title="f.archivedAt ? '恢复' : '归档'"
                :disabled="busy"
                @click="archive(f, !f.archivedAt)"
              >
                <ArchiveRestore v-if="f.archivedAt" :size="15" /><Archive v-else :size="15" />
              </button>
            </span>
          </li>
          <li v-if="!fields.length" class="empty-value">还没有自定义列。</li>
        </ul>
      </section>
      <section class="drawer-section">
        <header class="section-title"><h3>标签</h3></header>
        <p class="help-note">在开发项上输入新标签名即可新建；这里可以改名、换颜色或删除。</p>
        <ul class="settings-list">
          <li v-for="t in tags" :key="t.id">
            <input
              class="tag-name-input"
              :value="t.name"
              maxlength="30"
              :aria-label="'标签名称 ' + t.name"
              :disabled="busy || readOnly"
              @change="updateTag(t, { name: ($event.target as HTMLInputElement).value })"
            />
            <span class="color-picks" role="radiogroup" :aria-label="t.name + ' 的颜色'">
              <button
                v-for="c in TAG_COLORS"
                :key="c"
                type="button"
                role="radio"
                class="color-dot"
                :data-color="c"
                :aria-checked="t.color === c"
                :aria-label="c"
                :disabled="busy || readOnly"
                @click="updateTag(t, { color: c })"
              ></button>
            </span>
            <small>{{ t.usage }} 项</small>
            <button
              type="button"
              class="icon-button"
              :aria-label="'删除标签 ' + t.name"
              :disabled="busy || readOnly"
              @click="removeTag(t)"
            >
              <Trash2 :size="15" />
            </button>
          </li>
          <li v-if="!tags.length" class="empty-value">还没有标签。</li>
        </ul>
      </section>
    </div>
  </dialog>
</template>
