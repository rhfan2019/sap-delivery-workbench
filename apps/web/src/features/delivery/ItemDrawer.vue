<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  X,
  PenLine,
  Trash2,
  Sparkles,
  Code2,
  MoreHorizontal,
  ClipboardCheck,
  UserCheck,
} from '@lucide/vue';
import { api } from '../../services/session';
import FieldEditor from './FieldEditor.vue';
import FieldValue from './FieldValue.vue';
import ItemExtras from './ItemExtras.vue';
import {
  GROUPS,
  PHASES,
  OPTIONS,
  changedKeys,
  cloneItem,
  emptyItem,
  fieldValue,
  setFieldValue,
  type Changes,
  type FieldDef,
  type Item,
  type ListContext,
  type Tag,
} from './model';

// Right-side drawer in the model-registry style: one scrolling page grouped by section.
const props = defineProps<{
  item: Item | null;
  fields: FieldDef[];
  ctx: ListContext;
  base: string;
  projectId: string;
  readOnly: boolean;
  createTag: (name: string) => Promise<Tag>;
}>();
const emit = defineEmits<{
  close: [];
  saved: [item: Item];
  delete: [item: Item];
  agent: [label: string];
}>();
const more = ref(false);
const body = ref<HTMLElement>();
const creating = computed(() => !props.item);
const editing = ref(creating.value);
const busy = ref(false);
const error = ref('');
const draft = ref<Item>(cloneItem(props.item ?? emptyItem()));
const original = ref<Item>(cloneItem(draft.value));
watch(
  () => props.item,
  (next) => {
    if (editing.value) return;
    draft.value = cloneItem(next ?? emptyItem());
    original.value = cloneItem(draft.value);
  },
);
const dirty = computed(
  () => editing.value && changedKeys(original.value, draft.value, props.fields).length > 0,
);
const sections = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    fields: props.fields.filter((f) => f.group === g.key && !(creating.value && f.key === 'code')),
  })).filter((g) => g.fields.length),
);
const wide = (f: FieldDef) =>
  ['rich', 'objects', 'tags'].includes(f.type) || f.customType === 'long_text';
const title = computed(() => (creating.value ? '新建开发项' : props.item!.name));

function startEdit() {
  draft.value = cloneItem(props.item!);
  original.value = cloneItem(draft.value);
  error.value = '';
  editing.value = true;
}
function cancelEdit() {
  if (creating.value) return emit('close');
  draft.value = cloneItem(props.item!);
  error.value = '';
  editing.value = false;
}
async function save() {
  if (busy.value) return;
  const keys = changedKeys(original.value, draft.value, props.fields);
  if (creating.value)
    for (const k of ['name', 'module', 'kind']) if (!keys.includes(k)) keys.push(k);
  if (!keys.length) {
    editing.value = creating.value;
    return;
  }
  const changes: Changes = Object.fromEntries(
    keys.map((k) => [k, fieldValue(draft.value, k) ?? null]),
  );
  busy.value = true;
  error.value = '';
  try {
    const saved = creating.value
      ? await api<Item>(props.base, changes)
      : await api<Item>(
          props.base + '/' + props.item!.id,
          { rowVersion: props.item!.rowVersion, changes },
          'PATCH',
        );
    editing.value = false;
    draft.value = cloneItem(saved);
    original.value = cloneItem(saved);
    emit('saved', saved);
  } catch (e) {
    error.value = (e as Error).message;
    await nextTick();
    body.value?.querySelector('.error-note')?.scrollIntoView({ block: 'nearest' });
  } finally {
    busy.value = false;
  }
}
function jump(key: string) {
  body.value
    ?.querySelector('#section-' + key)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
let trigger: HTMLElement | null = null;
onMounted(() => {
  trigger = document.activeElement as HTMLElement;
  if (creating.value)
    void nextTick(() => body.value?.querySelector<HTMLElement>('select,input')?.focus());
});
onUnmounted(() => {
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
});
defineExpose({ dirty, busy });
</script>

<template>
  <section
    class="item-drawer"
    role="region"
    aria-labelledby="item-drawer-title"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <form @submit.prevent="save">
      <header>
        <div class="drawer-heading">
          <small v-if="item"
            >{{ item.code }} · {{ item.module }} · {{ OPTIONS.kind[item.kind] ?? item.kind }}</small
          >
          <h2 id="item-drawer-title">{{ title }}</h2>
          <div v-if="item" class="phase-strip" aria-label="阶段状态">
            <span v-for="p in PHASES" :key="p.key" class="phase-chip"
              >{{ p.label
              }}<span class="status-pill" :data-status="item.phases[p.key].status">{{
                OPTIONS.status[item.phases[p.key].status]
              }}</span></span
            >
          </div>
        </div>
        <div class="drawer-tools">
          <template v-if="item">
            <RouterLink
              class="secondary-button compact"
              :to="`/projects/${projectId}/development-items/${item.id}/design`"
              ><Sparkles :size="15" />设计</RouterLink
            >
            <RouterLink
              v-if="['report', 'function'].includes(item.kind)"
              class="secondary-button compact"
              :to="`/projects/${projectId}/development-items/${item.id}/development`"
              ><Code2 :size="15" />开发</RouterLink
            >
            <button
              v-else
              type="button"
              class="secondary-button compact"
              @click="emit('agent', '开发')"
            >
              <Code2 :size="15" />开发
            </button>
            <div class="menu-anchor">
              <button
                type="button"
                class="icon-button"
                aria-label="更多 Agent"
                :aria-expanded="more"
                @click="more = !more"
                @blur="more = false"
              >
                <MoreHorizontal :size="18" />
              </button>
              <div v-if="more" class="menu-panel align-right" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  @mousedown.prevent="((more = false), emit('agent', '顾问测试'))"
                >
                  <ClipboardCheck :size="15" />顾问测试
                </button>
                <button
                  type="button"
                  role="menuitem"
                  @mousedown.prevent="((more = false), emit('agent', 'IT/用户测试'))"
                >
                  <UserCheck :size="15" />IT/用户测试
                </button>
              </div>
            </div>
          </template>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭开发项抽屉"
            :disabled="busy"
            @click="emit('close')"
          >
            <X :size="20" />
          </button>
        </div>
      </header>
      <nav class="drawer-anchors" aria-label="跳转到分组">
        <button v-for="s in sections" :key="s.key" type="button" @click="jump(s.key)">
          {{ s.label }}
        </button>
        <button v-if="item" type="button" @click="jump('extras')">附件与活动</button>
      </nav>
      <div ref="body" class="drawer-body">
        <p v-if="error" class="error-note" role="alert">{{ error }}</p>
        <section v-for="s in sections" :id="'section-' + s.key" :key="s.key" class="drawer-section">
          <header class="section-title">
            <h3>{{ s.label }}</h3>
          </header>
          <div class="field-grid">
            <div v-for="f in s.fields" :key="f.key" class="field-row" :class="{ wide: wide(f) }">
              <label :for="editing ? 'field-' + f.key : undefined"
                >{{ f.label }}<b v-if="editing && f.required">*</b></label
              >
              <div
                v-if="editing && f.type !== 'readonly'"
                :id="'field-' + f.key"
                class="field-input"
              >
                <FieldEditor
                  :field="f"
                  :model-value="fieldValue(draft, f.key)"
                  :ctx="ctx"
                  :disabled="busy"
                  :create-tag="createTag"
                  @update:model-value="setFieldValue(draft, f.key, $event)"
                />
              </div>
              <div v-else class="field-read">
                <FieldValue :item="item ?? draft" :field="f" :ctx="ctx" />
              </div>
            </div>
          </div>
        </section>
        <div v-if="item" id="section-extras">
          <ItemExtras :path="base + '/' + item.id" :read-only="readOnly" :fields="fields" />
        </div>
      </div>
      <footer>
        <button
          v-if="item && !readOnly"
          type="button"
          class="danger-text"
          :disabled="busy"
          @click="emit('delete', item)"
        >
          <Trash2 :size="15" />删除
        </button>
        <span class="footer-note">{{ editing ? (dirty ? '有未保存的修改' : '') : '' }}</span>
        <template v-if="editing">
          <button type="button" class="secondary-button" :disabled="busy" @click="cancelEdit">
            取消</button
          ><button class="primary-button" :disabled="busy">
            {{ busy ? '保存中…' : creating ? '创建开发项' : '保存' }}
          </button>
        </template>
        <template v-else>
          <button type="button" class="secondary-button" @click="emit('close')">关闭</button>
          <button v-if="!readOnly" type="button" class="primary-button" @click="startEdit">
            <PenLine :size="15" />编辑
          </button>
        </template>
      </footer>
    </form>
  </section>
</template>
