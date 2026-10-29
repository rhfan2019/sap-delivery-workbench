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
import BaseAvatar from '../../components/base/BaseAvatar.vue';
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
  displayText,
  fieldValue,
  setFieldValue,
  type Changes,
  type FieldDef,
  type Item,
  type ListContext,
  type PhaseKey,
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
      opened.value = new Set();
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

// Each group is a card of label-over-value cells (DESIGN.md 4.1, 开发项详情面板): short
// properties in a grid, long ones in full rows. Reading leaves out what the head already shows
// and gathers the empty fields into one line; editing puts every field back in its place.
type Cell =
  { type: 'field'; field: FieldDef; span?: 2 } | { type: 'plan'; start: FieldDef; end: FieldDef };
interface Card {
  key: string;
  label: string;
  phase?: PhaseKey;
  assignee?: FieldDef;
  cells: Cell[];
  rows: FieldDef[];
  empty: string[];
  idle: boolean;
}
const IDENTITY = ['code', 'module', 'kind', 'name'];
// Editing leads with what is filled in first; reading leads a stage with its plan.
const LEADING: Record<string, number> = {
  name: 0,
  module: 1,
  kind: 2,
  assigneeId: 0,
  status: 1,
  progress: 2,
};
const READING: Record<string, number> = {
  plannedStart: 0,
  actualEnd: 1,
  effortDays: 2,
  progress: 3,
};
const shown = computed(() => (editing.value ? draft.value : (props.item ?? draft.value)));
const filled = (f: FieldDef) => displayText(shown.value, f, props.ctx) !== '';
const cards = computed<Card[]>(() =>
  sections.value.map((s) => {
    const phase = PHASES.find((p) => p.key === s.key)?.key;
    const named = (name: string) => s.fields.find((f) => f.phase && f.name === name);
    const start = named('plannedStart');
    const end = named('plannedEnd');
    const card: Card = {
      key: s.key,
      label: s.label,
      phase,
      cells: [],
      rows: [],
      empty: [],
      idle: false,
    };
    const order = editing.value ? LEADING : READING;
    const lead = (f: FieldDef) => order[f.phase ? f.name! : f.key] ?? 9;
    const fields = [...s.fields]
      .filter((f) => editing.value || !IDENTITY.includes(f.key))
      .sort((a, b) => lead(a) - lead(b));
    let planned = false;
    for (const f of fields) {
      if (f.key === 'code') continue;
      if (f === start || f === end) {
        if (planned || !start || !end) continue;
        planned = true;
        if (editing.value || filled(start) || filled(end))
          card.cells.push({ type: 'plan', start, end });
        else card.empty.push('计划日期');
        continue;
      }
      if (!editing.value) {
        if (f.phase && f.name === 'assigneeId') {
          card.assignee = f;
          continue;
        }
        if (f.phase && f.name === 'status') continue;
        if (!filled(f)) {
          card.empty.push(f.label);
          continue;
        }
      }
      if (wide(f)) card.rows.push(f);
      else
        card.cells.push({
          type: 'field',
          field: f,
          span: f.key === 'name' || (f.phase && f.name === 'assigneeId') ? 2 : undefined,
        });
    }
    // A stage nobody has started or filled in shrinks to one line.
    card.idle =
      !editing.value &&
      !!phase &&
      shown.value.phases[phase]?.status === 'not_started' &&
      s.fields.every((f) => f.name === 'status' || f.name === 'progress' || !filled(f));
    return card;
  }),
);
const stageStatus = (key: string) =>
  props.item && PHASES.some((p) => p.key === key)
    ? props.item.phases[key as PhaseKey]?.status
    : undefined;
// Long text shows three lines until the reader opens it.
const opened = ref(new Set<string>());
const long = (f: FieldDef) =>
  f.type === 'rich' && displayText(shown.value, f, props.ctx).length > 120;
function toggleOpen(key: string) {
  const next = new Set(opened.value);
  if (!next.delete(key)) next.add(key);
  opened.value = next;
}
// Switching between reading and editing changes the cards' height: keep the group in view where
// it was.
function holdPlace() {
  const el = body.value?.querySelector<HTMLElement>('#section-' + active.value);
  const before = el?.getBoundingClientRect().top;
  return () =>
    void nextTick(() => {
      if (!el?.isConnected || before === undefined || !body.value) return;
      body.value.scrollTop += el.getBoundingClientRect().top - before;
    });
}

function startEdit() {
  const restore = holdPlace();
  draft.value = cloneItem(props.item!);
  original.value = cloneItem(draft.value);
  error.value = '';
  editing.value = true;
  restore();
}
function cancelEdit() {
  if (creating.value) return emit('close');
  const restore = holdPlace();
  draft.value = cloneItem(props.item!);
  error.value = '';
  editing.value = false;
  restore();
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
    const restore = holdPlace();
    editing.value = false;
    restore();
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
          v-for="c in cards"
          :id="'section-' + c.key"
          :key="c.key"
          :data-section="c.key"
          class="drawer-section"
        >
          <header class="section-title">
            <h3>{{ c.label }}</h3>
            <span
              v-if="c.phase && stageStatus(c.key)"
              class="status-pill"
              :data-status="stageStatus(c.key)"
              >{{ OPTIONS.status[stageStatus(c.key)!] }}</span
            >
          </header>
          <div v-if="c.idle" class="field-card idle">
            {{ readOnly ? '尚未开始' : '尚未开始，点“编辑”填写负责人和计划' }}
          </div>
          <div v-else class="field-card">
            <div v-if="c.assignee" class="card-owner">
              <BaseAvatar :name="displayText(shown, c.assignee, ctx) || '?'" :size="24" />
              <span :class="displayText(shown, c.assignee, ctx) ? 'owner-name' : 'empty-value'">{{
                displayText(shown, c.assignee, ctx) || '未分配'
              }}</span>
              <span class="owner-role">{{ c.assignee.label }}</span>
            </div>
            <div v-if="c.cells.length" class="field-grid">
              <div
                v-for="cell in c.cells"
                :key="cell.type === 'plan' ? 'plan' : cell.field.key"
                class="field-cell"
                :class="{ 'span-2': cell.type === 'plan' || cell.span === 2 }"
              >
                <template v-if="cell.type === 'plan'">
                  <span class="field-label">{{ editing ? '计划开始 → 计划完成' : '计划' }}</span>
                  <div v-if="editing" class="plan-inputs">
                    <FieldEditor
                      v-for="f in [cell.start, cell.end]"
                      :key="f.key"
                      :field="f"
                      :model-value="fieldValue(draft, f.key)"
                      :ctx="ctx"
                      :disabled="busy"
                      :create-tag="createTag"
                      @update:model-value="setFieldValue(draft, f.key, $event)"
                    />
                  </div>
                  <div v-else class="field-read">
                    {{ displayText(shown, cell.start, ctx) || '—' }} →
                    {{ displayText(shown, cell.end, ctx) || '—' }}
                  </div>
                </template>
                <template v-else>
                  <label class="field-label" :for="editing ? 'field-' + cell.field.key : undefined"
                    >{{ cell.field.label }}<b v-if="editing && cell.field.required">*</b></label
                  >
                  <div
                    v-if="editing && cell.field.type !== 'readonly'"
                    :id="'field-' + cell.field.key"
                    class="field-input"
                  >
                    <FieldEditor
                      :field="cell.field"
                      :model-value="fieldValue(draft, cell.field.key)"
                      :ctx="ctx"
                      :disabled="busy"
                      :create-tag="createTag"
                      @update:model-value="setFieldValue(draft, cell.field.key, $event)"
                    />
                  </div>
                  <div v-else class="field-read">
                    <FieldValue :item="shown" :field="cell.field" :ctx="ctx" />
                  </div>
                </template>
              </div>
            </div>
            <div v-for="f in c.rows" :key="f.key" class="field-cell full">
              <label class="field-label" :for="editing ? 'field-' + f.key : undefined"
                >{{ f.label }}<b v-if="editing && f.required">*</b></label
              >
              <div v-if="editing" :id="'field-' + f.key" class="field-input">
                <FieldEditor
                  :field="f"
                  :model-value="fieldValue(draft, f.key)"
                  :ctx="ctx"
                  :disabled="busy"
                  :create-tag="createTag"
                  @update:model-value="setFieldValue(draft, f.key, $event)"
                />
              </div>
              <template v-else>
                <div class="field-read" :class="{ clamped: long(f) && !opened.has(f.key) }">
                  <FieldValue :item="shown" :field="f" :ctx="ctx" />
                </div>
                <button v-if="long(f)" type="button" class="text-button" @click="toggleOpen(f.key)">
                  {{ opened.has(f.key) ? '收起' : '展开' }}
                </button>
              </template>
            </div>
            <p v-if="c.empty.length" class="card-empty">{{ c.empty.join('、') }}未填写</p>
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
          <div class="field-card">
            <template v-for="stage in outputStages" :key="stage">
              <ItemOutputs
                :project-id="projectId"
                :item-id="item.id"
                :stage="stage"
                :can-run="!!agents?.[stage].run"
              />
            </template>
          </div>
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
