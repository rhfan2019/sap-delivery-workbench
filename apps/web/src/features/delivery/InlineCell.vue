<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Pencil, LoaderCircle } from '@lucide/vue';
import FieldEditor from './FieldEditor.vue';
import FieldValue from './FieldValue.vue';
import {
  columnLabel,
  editableInline,
  fieldValue,
  type FieldDef,
  type Item,
  type ListContext,
} from './model';

// Table cell with quick editing for short fields: click to edit; choices save on change,
// typed values save on Enter or blur; Esc cancels; failures stay in the cell with the input.
const props = defineProps<{
  item: Item;
  field: FieldDef;
  ctx: ListContext;
  readOnly: boolean;
  save: (item: Item, key: string, value: unknown) => Promise<void>;
}>();
const editing = ref(false);
const saving = ref(false);
const error = ref('');
const draft = ref<unknown>(null);
const root = ref<HTMLElement>();
const canEdit = computed(() => !props.readOnly && editableInline(props.field));
const immediate = computed(
  () =>
    ['select', 'member'].includes(props.field.type) ||
    ['select', 'member', 'checkbox'].includes(props.field.customType ?? ''),
);
async function start() {
  if (!canEdit.value || editing.value) return;
  draft.value = fieldValue(props.item, props.field.key) ?? null;
  error.value = '';
  editing.value = true;
  await nextTick();
  root.value?.querySelector<HTMLElement>('input,select')?.focus();
}
function cancel() {
  if (saving.value) return;
  editing.value = false;
  error.value = '';
}
async function commit() {
  if (!editing.value || saving.value) return;
  const before = fieldValue(props.item, props.field.key) ?? null;
  if (JSON.stringify(before) === JSON.stringify(draft.value ?? null)) return cancel();
  saving.value = true;
  error.value = '';
  try {
    await props.save(props.item, props.field.key, draft.value);
    editing.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function changed(value: unknown) {
  draft.value = value;
  if (immediate.value) await commit();
}
function focusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node)) void commit();
}
</script>

<template>
  <div
    ref="root"
    class="inline-cell"
    :class="{ editable: canEdit, editing, saving, failed: !!error }"
    :tabindex="canEdit && !editing ? 0 : undefined"
    @click.stop="start"
    @keydown.enter.self.prevent="start"
    @keydown.f2.self.prevent="start"
  >
    <template v-if="editing">
      <span
        class="inline-control"
        @keydown.enter.prevent.stop="commit"
        @keydown.esc.prevent.stop="cancel"
        @focusout="focusOut"
      >
        <FieldEditor
          :field="field"
          :model-value="draft"
          :ctx="ctx"
          :disabled="saving"
          @update:model-value="changed"
        />
        <LoaderCircle v-if="saving" class="spin" :size="14" aria-label="保存中" />
      </span>
      <small v-if="error" class="cell-error" role="alert" :title="error">{{ error }}</small>
    </template>
    <template v-else>
      <FieldValue :item="item" :field="field" :ctx="ctx" compact />
      <button
        v-if="canEdit"
        type="button"
        class="cell-edit"
        :aria-label="`编辑 ${item.code} 的${columnLabel(field)}`"
        tabindex="-1"
        @click.stop="start"
      >
        <Pencil :size="12" />
      </button>
    </template>
  </div>
</template>
