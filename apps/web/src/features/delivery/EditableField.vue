<script setup lang="ts">
import { display, type Field, type Item, type Member } from './model';
import FieldInput from './FieldInput.vue';
import { safeRequirement } from './richText';
defineProps<{
  item: Item;
  field: Field;
  members: Member[];
  editing: boolean;
  value: string;
  readOnly: boolean;
  busy: boolean;
  compact?: boolean;
}>();
defineEmits<{ start: []; save: []; cancel: []; 'update:value': [value: string] }>();
</script>
<template>
  <div class="editable-field" :class="{ 'is-editing': editing }">
    <div
      v-if="editing"
      class="inline-editor"
      @click.stop
      @dblclick.stop
      @keydown.esc.stop="$emit('cancel')"
      @keydown.enter.stop="!['long', 'rich'].includes(field.type ?? '') && $emit('save')"
    >
      <FieldInput
        :field="field"
        :disabled="busy"
        :members="members"
        :model-value="value"
        @update:model-value="$emit('update:value', $event)"
      />
      <div class="inline-actions">
        <button :disabled="busy" @click="$emit('save')">保存</button
        ><button :disabled="busy" @click="$emit('cancel')">取消</button>
      </div>
    </div>
    <div
      v-else
      class="field-display"
      :class="{
        'is-high-priority': field.key === 'priority' && item.priority === 'high',
        'is-missing': !item[field.key],
        'is-name': field.key === 'name',
        'is-date': field.type === 'date',
      }"
      :title="compact ? display(item, field, members) : undefined"
      :tabindex="readOnly ? -1 : 0"
      @dblclick.stop="!readOnly && $emit('start')"
      @keydown.enter.stop="!readOnly && $emit('start')"
      @keydown.f2.prevent.stop="!readOnly && $emit('start')"
    >
      <div
        v-if="field.type === 'rich' && !compact"
        class="requirement-read"
        v-html="safeRequirement(item.summary || '—', item.summaryFormat)"
      />
      <span v-else :class="{ 'requirement-preview': field.type === 'rich' }">{{
        !item[field.key]
          ? field.type === 'member'
            ? '未分配'
            : '未设置'
          : display(item, field, members)
      }}</span
      ><button
        v-if="!readOnly"
        class="edit-pencil"
        :aria-label="'编辑' + field.label + ' ' + item.code"
        @click.stop="$emit('start')"
      >
        ✎
      </button>
    </div>
  </div>
</template>
