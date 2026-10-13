<script setup lang="ts">
import { computed, ref } from 'vue';
import { X } from '@lucide/vue';
import type { Tag } from './model';

// Chips plus a type-ahead; typing a new name and pressing Enter creates the tag.
const props = defineProps<{
  modelValue: string[];
  tags: Tag[];
  disabled?: boolean;
  createTag?: (name: string) => Promise<Tag>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const query = ref('');
const open = ref(false);
const error = ref('');
const busy = ref(false);
const selected = computed(
  () => props.modelValue.map((id) => props.tags.find((t) => t.id === id)).filter(Boolean) as Tag[],
);
const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.tags
    .filter((t) => !props.modelValue.includes(t.id) && t.name.toLowerCase().includes(q))
    .slice(0, 8);
});
const exact = computed(() =>
  props.tags.find((t) => t.name.toLowerCase() === query.value.trim().toLowerCase()),
);
function add(tag: Tag) {
  if (!props.modelValue.includes(tag.id)) emit('update:modelValue', [...props.modelValue, tag.id]);
  query.value = '';
}
async function commit() {
  const name = query.value.trim();
  if (!name) return;
  if (exact.value) return add(exact.value);
  if (!props.createTag) return;
  busy.value = true;
  error.value = '';
  try {
    add(await props.createTag(name));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function backspace() {
  if (!query.value && props.modelValue.length)
    emit('update:modelValue', props.modelValue.slice(0, -1));
}
</script>

<template>
  <div class="tag-picker" :class="{ disabled }">
    <span v-for="t in selected" :key="t.id" class="tag-chip" :data-color="t.color"
      >{{ t.name
      }}<button
        type="button"
        :aria-label="'移除标签 ' + t.name"
        :disabled="disabled"
        @click="
          emit(
            'update:modelValue',
            modelValue.filter((id) => id !== t.id),
          )
        "
      >
        <X :size="12" /></button
    ></span>
    <input
      v-model="query"
      aria-label="添加标签"
      :placeholder="selected.length ? '' : '输入标签，回车添加'"
      maxlength="30"
      :disabled="disabled || busy"
      @focus="open = true"
      @blur="open = false"
      @keydown.enter.prevent="commit"
      @keydown.backspace="backspace"
    />
    <div v-if="open && (suggestions.length || (query.trim() && !exact))" class="tag-suggestions">
      <button v-for="t in suggestions" :key="t.id" type="button" @mousedown.prevent="add(t)">
        <span class="tag-chip" :data-color="t.color">{{ t.name }}</span>
      </button>
      <button v-if="query.trim() && !exact && createTag" type="button" @mousedown.prevent="commit">
        新建标签“{{ query.trim() }}”
      </button>
    </div>
    <small v-if="error" class="field-error" role="alert">{{ error }}</small>
  </div>
</template>
