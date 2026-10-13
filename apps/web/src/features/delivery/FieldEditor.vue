<script setup lang="ts">
import { computed } from 'vue';
import type { FieldDef, ListContext, SapObject, Tag } from './model';
import RichEditor from './RichEditor.vue';
import TagPicker from './TagPicker.vue';
import ObjectsEditor from './ObjectsEditor.vue';

// One form control for any catalog field; shared by the drawer, batch edit and inline cells.
const props = defineProps<{
  field: FieldDef;
  modelValue: unknown;
  ctx: ListContext;
  disabled?: boolean;
  createTag?: (name: string) => Promise<Tag>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const type = computed(() =>
  props.field.type === 'custom' ? 'custom-' + props.field.customType : props.field.type,
);
const builtInOptions = computed(() =>
  Object.entries((props.field.options ?? {}) as Record<string, string>),
);
const customOptions = computed(
  () => (props.field.options ?? []) as { id: string; label: string }[],
);
const people = computed(() =>
  props.ctx.members.filter((m) => m.active || m.id === props.modelValue),
);
const text = (event: Event) => (event.target as HTMLInputElement).value;
function number(event: Event) {
  const raw = text(event);
  emit('update:modelValue', raw === '' ? null : Number(raw));
}
function toggleOption(id: string, on: boolean) {
  const current = Array.isArray(props.modelValue) ? (props.modelValue as string[]) : [];
  emit('update:modelValue', on ? [...current, id] : current.filter((v) => v !== id));
}
</script>

<template>
  <RichEditor
    v-if="type === 'rich'"
    :model-value="String(modelValue ?? '')"
    :disabled="disabled"
    :label="field.label"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <select
    v-else-if="type === 'select'"
    :aria-label="field.label"
    :disabled="disabled"
    :value="modelValue ?? ''"
    @change="emit('update:modelValue', text($event))"
  >
    <option v-if="!field.required && !field.key.endsWith('.status')" value="" disabled>
      请选择
    </option>
    <option v-for="[key, label] in builtInOptions" :key="key" :value="key">{{ label }}</option>
  </select>
  <select
    v-else-if="type === 'member' || type === 'custom-member'"
    :aria-label="field.label"
    :disabled="disabled"
    :value="modelValue ?? ''"
    @change="emit('update:modelValue', text($event) || null)"
  >
    <option value="">未分配</option>
    <option v-for="m in people" :key="m.id" :value="m.id" :disabled="!m.active">
      {{ m.displayName }}{{ m.active ? '' : '（停用）' }}
    </option>
  </select>
  <input
    v-else-if="type === 'date' || type === 'custom-date'"
    type="date"
    :aria-label="field.label"
    :disabled="disabled"
    :value="modelValue ?? ''"
    @input="emit('update:modelValue', text($event) || null)"
  />
  <span v-else-if="type === 'percent'" class="unit-input">
    <input
      type="number"
      min="0"
      max="100"
      step="5"
      :aria-label="field.label"
      :disabled="disabled"
      :value="modelValue ?? 0"
      @input="number"
    /><span>%</span>
  </span>
  <span v-else-if="type === 'effort'" class="unit-input">
    <input
      type="number"
      min="0"
      step="0.5"
      :aria-label="field.label"
      :disabled="disabled"
      :value="modelValue ?? ''"
      @input="number"
    /><span>人天</span>
  </span>
  <input
    v-else-if="type === 'custom-number'"
    type="number"
    :aria-label="field.label"
    :disabled="disabled"
    :value="modelValue ?? ''"
    @input="number"
  />
  <TagPicker
    v-else-if="type === 'tags'"
    :model-value="(modelValue as string[]) ?? []"
    :tags="ctx.tags"
    :disabled="disabled"
    :create-tag="createTag"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <ObjectsEditor
    v-else-if="type === 'objects'"
    :model-value="(modelValue as SapObject[]) ?? []"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <textarea
    v-else-if="type === 'custom-long_text'"
    rows="4"
    :aria-label="field.label"
    :disabled="disabled"
    :value="String(modelValue ?? '')"
    @input="emit('update:modelValue', text($event))"
  />
  <select
    v-else-if="type === 'custom-select'"
    :aria-label="field.label"
    :disabled="disabled"
    :value="modelValue ?? ''"
    @change="emit('update:modelValue', text($event) || null)"
  >
    <option value="">未选择</option>
    <option v-for="o in customOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
  </select>
  <span
    v-else-if="type === 'custom-multi_select'"
    class="option-checks"
    role="group"
    :aria-label="field.label"
  >
    <label v-for="o in customOptions" :key="o.id"
      ><input
        type="checkbox"
        :disabled="disabled"
        :checked="Array.isArray(modelValue) && (modelValue as string[]).includes(o.id)"
        @change="toggleOption(o.id, ($event.target as HTMLInputElement).checked)"
      />{{ o.label }}</label
    >
  </span>
  <label v-else-if="type === 'custom-checkbox'" class="check-input"
    ><input
      type="checkbox"
      :disabled="disabled"
      :checked="modelValue === true"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />是</label
  >
  <input
    v-else
    :type="type === 'custom-url' ? 'url' : 'text'"
    :aria-label="field.label"
    :maxlength="field.max ?? 500"
    :disabled="disabled"
    :value="modelValue ?? ''"
    @input="emit('update:modelValue', text($event))"
  />
</template>
