<script setup lang="ts">
import type { Field, Member } from './model';
import RequirementEditor from './RequirementEditor.vue';
defineProps<{ field: Field; members: Member[]; modelValue: string; disabled?: boolean }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <RequirementEditor
    v-if="field.type === 'rich'"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <select
    v-else-if="field.options || field.type === 'member'"
    :disabled="disabled"
    :aria-label="field.label"
    :value="modelValue"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-if="field.type === 'member'" value="">未分配</option>
    <template v-if="field.type === 'member'"
      ><option
        v-for="m in members.filter((m) => m.active || m.id === modelValue)"
        :key="m.id"
        :value="m.id"
        :disabled="!m.active"
      >
        {{ m.displayName }}{{ m.active ? '' : '（停用）' }}
      </option></template
    >
    <template v-else
      ><option v-for="(label, key) in field.options" :key="key" :value="key">
        {{ label }}
      </option></template
    >
  </select>
  <textarea
    v-else-if="field.type === 'long'"
    :disabled="disabled"
    :aria-label="field.label"
    :value="modelValue"
    rows="5"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
  <input
    v-else
    :disabled="disabled"
    :aria-label="field.label"
    :type="field.type === 'date' ? 'date' : 'text'"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
