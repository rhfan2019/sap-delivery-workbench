<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
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
import BaseButton from '../../components/base/BaseButton.vue';
import BaseIconButton from '../../components/base/BaseIconButton.vue';
import BaseMenu from '../../components/base/BaseMenu.vue';
import BaseMenuItem from '../../components/base/BaseMenuItem.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { kindIdentity, moduleHue } from '../../components/base/identity';
import { api } from '../../services/session';
import FieldEditor from './FieldEditor.vue';
import FieldValue from './FieldValue.vue';
import ItemExtras from './ItemExtras.vue';
import ItemOutputs from '../agent-workbench/ItemOutputs.vue';
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
import { DEV_AGENT_KINDS } from '@sap-delivery-workbench/contracts/delivery/fields';

// Right-side drawer in the model-registry style: one scrolling page grouped by section.
const props = defineProps<{
  item: Item | null;
  fields: FieldDef[];
  ctx: ListContext;
  base: string;
  projectId: string;
  readOnly: boolean;
  createTag: (name: string) => Promise<Tag>;
  // Who may open each assistant (agent.*:run on this item) and read its outputs (:view).
  agents?: Record<'design' | 'development', { run: boolean; view: boolean }>;
  // A section to scroll to when the drawer opens (a link from an assistant page).
  section?: string;
}>();
const emit = defineEmits<{
  close: [];
  saved: [item: Item];
  delete: [item: Item];
  agent: [label: string];
}>();
const router = useRouter();
const body = ref<HTMLElement>();
const creating = computed(() => !props.item);
const editing = ref(creating.value);
const busy = ref(false);
const error = ref('');
const draft = ref<Item>(cloneItem(props.item ?? emptyItem()));
const original = ref<Item>(cloneItem(draft.value));
// The panel stays mounted while the person steps through items (no flicker): another item
// resets it to reading from the top; a refresh of the same item only updates what is shown.
watch(
  () => props.item,
  (next, previous) => {
    const switched = next?.id !== previous?.id;
    if (editing.value && !switched) return;
    if (switched && !creating.value) {
      editing.value = false;
      error.value = '';
      active.value = 'basic';
      if (body.value) body.value.scrollTop = 0;
    }
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
// Section tabs follow the scroll position; a click scrolls to the section.
const active = ref('basic');
function jump(key: string) {
  active.value = key;
  body.value
    ?.querySelector('#section-' + key)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function spy() {
  const top = (body.value?.getBoundingClientRect().top ?? 0) + 48;
  let current = 'basic';
  for (const el of body.value?.querySelectorAll<HTMLElement>('[data-section]') ?? [])
    if (el.getBoundingClientRect().top <= top) current = el.dataset.section!;
  active.value = current;
}

// Identity (DESIGN.md 2.2.1). Each phase's status rides on its section tab, unless it has not
// started; the assignee and dates are the section's own fields, so the panel spends no height
// repeating them.
const kind = computed(() => (props.item ? kindIdentity[props.item.kind] : undefined));
const phaseStatus = (key: string) => {
  if (!props.item || !PHASES.some((p) => p.key === key)) return undefined;
  const status = props.item.phases[key as keyof Item['phases']]?.status;
  return status === 'not_started' ? undefined : status;
};

// Outputs of the assistants the reader may view; the development one only for kinds it supports.
const outputStages = computed(() =>
  (['design', 'development'] as const).filter(
    (stage) =>
      props.agents?.[stage].view &&
      (stage === 'design' || DEV_AGENT_KINDS.includes(props.item?.kind ?? '')),
  ),
);
const showOutputs = computed(() => outputStages.value.length > 0);
const noRun = {
  design: '你没有使用设计助手的权限，可在下方“成果”中查看功能说明书',
  development: '你没有使用开发助手的权限，可在下方“成果”中查看开发方案与代码',
};
// The assistants open on another page: show the click at once, and fetch that page's code
// while the panel is open so the switch does not wait for it.
const going = ref<'' | 'design' | 'development'>('');
const agentPath = (stage: 'design' | 'development') =>
  `/projects/${props.projectId}/development-items/${props.item!.id}/${stage}`;
async function goAgent(stage: 'design' | 'development') {
  if (going.value) return;
  going.value = stage;
  try {
    await router.push(agentPath(stage));
  } finally {
    going.value = '';
  }
}
function prefetchAgents() {
  for (const stage of ['design', 'development'] as const)
    for (const record of router.resolve(`/projects/p/development-items/i/${stage}`).matched) {
      const load = record.components?.default;
      if (typeof load === 'function') void (load as () => Promise<unknown>)().catch(() => {});
    }
}
let trigger: HTMLElement | null = null;
onMounted(() => {
  trigger = document.activeElement as HTMLElement;
  prefetchAgents();
  if (props.section) void nextTick(() => jump(props.section!));
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
      <header class="drawer-head">
        <div class="drawer-ident">
          <span
            v-if="kind"
            class="kind-tile"
            :style="{ background: `var(--${kind.hue}-fill-1)`, color: `var(--${kind.hue}-icon-1)` }"
            :title="OPTIONS.kind[item!.kind] ?? item!.kind"
            aria-hidden="true"
            ><component :is="kind.icon"
          /></span>
          <template v-if="item">
            <BaseTag variant="outline">{{ item.code }}</BaseTag>
            <BaseTag v-if="item.module" :tone="moduleHue(item.module)">{{ item.module }}</BaseTag>
            <span class="drawer-kind">{{ OPTIONS.kind[item.kind] ?? item.kind }}</span>
          </template>
          <h2 id="item-drawer-title" :title="title">{{ title }}</h2>
        </div>
        <div class="drawer-tools">
          <template v-if="item">
            <span
              class="blocked-hint"
              :title="agents?.design.run === false ? noRun.design : undefined"
            >
              <BaseButton
                size="sm"
                :loading="going === 'design'"
                :disabled="!!going || agents?.design.run === false"
                @click="goAgent('design')"
                ><template #icon><Sparkles class="agent-icon" /></template>设计</BaseButton
              >
            </span>
            <span
              v-if="DEV_AGENT_KINDS.includes(item.kind)"
              class="blocked-hint"
              :title="agents?.development.run === false ? noRun.development : undefined"
            >
              <BaseButton
                size="sm"
                :loading="going === 'development'"
                :disabled="!!going || agents?.development.run === false"
                @click="goAgent('development')"
                ><template #icon><Code2 /></template>开发</BaseButton
              >
            </span>
            <BaseButton v-else size="sm" @click="emit('agent', '开发')"
              ><template #icon><Code2 /></template>开发</BaseButton
            >
            <BaseMenu align="end">
              <template #trigger>
                <BaseIconButton label="更多 Agent" size="sm"><MoreHorizontal /></BaseIconButton>
              </template>
              <BaseMenuItem @select="emit('agent', '顾问测试')"
                ><template #icon><ClipboardCheck /></template>顾问测试</BaseMenuItem
              >
              <BaseMenuItem @select="emit('agent', 'IT/用户测试')"
                ><template #icon><UserCheck /></template>IT/用户测试</BaseMenuItem
              >
            </BaseMenu>
          </template>
          <BaseIconButton label="关闭开发项" size="sm" :disabled="busy" @click="emit('close')"
            ><X
          /></BaseIconButton>
        </div>
      </header>
      <nav class="drawer-anchors" aria-label="跳转到分组">
        <button
          v-for="s in sections"
          :key="s.key"
          type="button"
          :aria-current="active === s.key ? 'true' : undefined"
          @click="jump(s.key)"
        >
          {{ s.label
          }}<span v-if="phaseStatus(s.key)" class="status-pill" :data-status="phaseStatus(s.key)">{{
            OPTIONS.status[phaseStatus(s.key)!]
          }}</span>
        </button>
        <button
          v-if="item && showOutputs"
          type="button"
          :aria-current="active === 'outputs' ? 'true' : undefined"
          @click="jump('outputs')"
        >
          成果
        </button>
        <button
          v-if="item"
          type="button"
          :aria-current="active === 'extras' ? 'true' : undefined"
          @click="jump('extras')"
        >
          附件与活动
        </button>
      </nav>
      <div ref="body" class="drawer-body" @scroll.passive="spy">
        <p v-if="error" class="error-note" role="alert">{{ error }}</p>
        <section
          v-for="s in sections"
          :id="'section-' + s.key"
          :key="s.key"
          :data-section="s.key"
          class="drawer-section"
        >
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
        <section
          v-if="item && showOutputs"
          id="section-outputs"
          data-section="outputs"
          class="drawer-section"
        >
          <header class="section-title">
            <h3>成果</h3>
          </header>
          <template v-for="stage in outputStages" :key="stage">
            <ItemOutputs
              :project-id="projectId"
              :item-id="item.id"
              :stage="stage"
              :can-run="!!agents?.[stage].run"
            />
          </template>
        </section>
        <div v-if="item" id="section-extras" data-section="extras">
          <ItemExtras :path="base + '/' + item.id" :read-only="readOnly" :fields="fields" />
        </div>
      </div>
      <footer>
        <BaseButton
          v-if="item && !readOnly"
          variant="ghost"
          size="sm"
          class="drawer-delete"
          :disabled="busy"
          @click="emit('delete', item)"
          ><template #icon><Trash2 /></template>删除</BaseButton
        >
        <span class="footer-note">{{ editing ? (dirty ? '有未保存的修改' : '') : '' }}</span>
        <template v-if="editing">
          <BaseButton :disabled="busy" @click="cancelEdit">取消</BaseButton
          ><BaseButton variant="primary" type="submit" :loading="busy">{{
            creating ? '创建开发项' : '保存'
          }}</BaseButton>
        </template>
        <template v-else>
          <BaseButton @click="emit('close')">关闭</BaseButton>
          <BaseButton v-if="!readOnly" variant="primary" @click="startEdit"
            ><template #icon><PenLine /></template>编辑</BaseButton
          >
        </template>
      </footer>
    </form>
  </section>
</template>
