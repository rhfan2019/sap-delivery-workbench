<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import FieldEditor from './FieldEditor.vue';
import TagPicker from './TagPicker.vue';
import { GROUPS, emptyItem, fieldValue, type FieldDef, type ListContext, type Tag } from './model';

// Batch edit: tick the fields to change and give each a new value; only ticked fields apply.
const props = defineProps<{
  count: number;
  fields: FieldDef[];
  ctx: ListContext;
  busy: boolean;
  error: string;
  createTag: (name: string) => Promise<Tag>;
}>();
const emit = defineEmits<{
  close: [];
  apply: [body: { changes: Record<string, unknown>; addTags: string[]; removeTags: string[] }];
}>();
const dialog = ref<HTMLDialogElement>();
const blank = emptyItem();
const editable = (f: FieldDef) =>
  !['readonly', 'objects', 'tags'].includes(f.type) && f.key !== 'name';
const groups = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    fields: props.fields.filter((f) => f.group === g.key && editable(f)),
  })).filter((g) => g.fields.length),
);
const picked = ref<Record<string, boolean>>({});
const values = ref<Record<string, unknown>>({});
const addTags = ref<string[]>([]);
const removeTags = ref<string[]>([]);
const tagsPicked = ref(false);
function toggle(field: FieldDef, on: boolean) {
  picked.value[field.key] = on;
  if (on && !(field.key in values.value))
    values.value[field.key] = fieldValue(blank, field.key) ?? null;
}
const count = computed(
  () => Object.values(picked.value).filter(Boolean).length + (tagsPicked.value ? 1 : 0),
);
function submit() {
  const changes = Object.fromEntries(
    Object.keys(picked.value)
      .filter((k) => picked.value[k])
      .map((k) => [k, values.value[k] ?? null]),
  );
  emit('apply', {
    changes,
    addTags: tagsPicked.value ? addTags.value : [],
    removeTags: tagsPicked.value ? removeTags.value : [],
  });
}
onMounted(() => dialog.value?.showModal());
</script>

<template>
  <dialog
    ref="dialog"
    class="batch-dialog"
    aria-labelledby="batch-title"
    @cancel.prevent="emit('close')"
  >
    <form @submit.prevent="submit">
      <header>
        <div>
          <h2 id="batch-title">批量修改</h2>
          <p>
            勾选要修改的字段并填写新值，将应用到选中的
            {{ props.count }} 个开发项；未勾选的字段保持不变。
          </p>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭批量修改"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="20" />
        </button>
      </header>
      <div class="batch-body">
        <p v-if="error" class="error-note" role="alert">{{ error }}</p>
        <section class="batch-group">
          <h3>标签</h3>
          <div class="batch-row" :class="{ active: tagsPicked }">
            <label class="batch-check"
              ><input v-model="tagsPicked" type="checkbox" :disabled="busy" />标签</label
            >
            <div class="batch-tags">
              <span>添加</span>
              <TagPicker
                v-model="addTags"
                :tags="ctx.tags"
                :disabled="busy || !tagsPicked"
                :create-tag="createTag"
              />
              <span>移除</span>
              <TagPicker v-model="removeTags" :tags="ctx.tags" :disabled="busy || !tagsPicked" />
            </div>
          </div>
        </section>
        <section v-for="g in groups" :key="g.key" class="batch-group">
          <h3>{{ g.label }}</h3>
          <div
            v-for="f in g.fields"
            :key="f.key"
            class="batch-row"
            :class="{ active: picked[f.key] }"
          >
            <label class="batch-check"
              ><input
                type="checkbox"
                :checked="!!picked[f.key]"
                :disabled="busy"
                @change="toggle(f, ($event.target as HTMLInputElement).checked)"
              />{{ f.label }}</label
            >
            <div class="batch-value">
              <FieldEditor
                v-if="picked[f.key]"
                :field="f"
                :model-value="values[f.key]"
                :ctx="ctx"
                :disabled="busy"
                @update:model-value="values[f.key] = $event"
              />
              <span v-else class="empty-value">不修改</span>
            </div>
          </div>
        </section>
      </div>
      <footer>
        <span>已勾选 {{ count }} 个字段</span>
        <button type="button" class="secondary-button" :disabled="busy" @click="emit('close')">
          取消</button
        ><button class="primary-button" :disabled="busy || !count">
          {{ busy ? '正在修改…' : `修改 ${props.count} 项` }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
