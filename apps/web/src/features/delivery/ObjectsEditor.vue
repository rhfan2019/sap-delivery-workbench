<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue';
import type { SapObject } from './model';

// Development objects as an editable table keyed like TADIR (PGMID / OBJECT / OBJ_NAME).
const props = defineProps<{ modelValue: SapObject[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: SapObject[]] }>();
function update(index: number, key: keyof SapObject, value: string) {
  emit(
    'update:modelValue',
    props.modelValue.map((o, i) => (i === index ? { ...o, [key]: value.toUpperCase() } : o)),
  );
}
const add = () =>
  emit('update:modelValue', [
    ...props.modelValue,
    { pgmid: 'R3TR', objectType: '', objectName: '' },
  ]);
const remove = (index: number) =>
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
</script>

<template>
  <div class="objects-editor">
    <table v-if="modelValue.length">
      <thead>
        <tr>
          <th>对象标识</th>
          <th>对象类型</th>
          <th>对象名称</th>
          <th><span class="sr-only">操作</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(o, index) in modelValue" :key="index">
          <td>
            <input
              :value="o.pgmid"
              maxlength="4"
              aria-label="对象标识"
              placeholder="R3TR"
              :disabled="disabled"
              @input="update(index, 'pgmid', ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>
            <input
              :value="o.objectType"
              maxlength="4"
              aria-label="对象类型"
              placeholder="PROG"
              :disabled="disabled"
              @input="update(index, 'objectType', ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>
            <input
              :value="o.objectName"
              maxlength="120"
              aria-label="对象名称"
              placeholder="ZMM_PR_APPROVE"
              :disabled="disabled"
              @input="update(index, 'objectName', ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>
            <button
              type="button"
              class="icon-button"
              :aria-label="'删除对象 ' + (o.objectName || index + 1)"
              :disabled="disabled"
              @click="remove(index)"
            >
              <Trash2 :size="15" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <button type="button" class="text-button" :disabled="disabled" @click="add">
      <Plus :size="14" />添加开发对象
    </button>
  </div>
</template>
