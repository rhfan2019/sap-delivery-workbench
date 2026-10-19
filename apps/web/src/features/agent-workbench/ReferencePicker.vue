<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { Check, FileText, LoaderCircle, MessageSquare, NotebookText } from '@lucide/vue';
import { api } from '../../services/session';

// Item materials a message can reference instead of uploading them again
// (docs/specs/agent-workspace-start-and-composer.md 4.2). Opened from the “+” menu (with its own
// search box) or by typing @ in the composer (the text after @ is the search; the composer
// forwards arrow keys, Enter and Esc through `move`, `choose` and `close`).
export interface Reference {
  kind: 'business_function' | 'item_file' | 'session_file';
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}
const props = defineProps<{
  base: string;
  sessionId: string;
  selected: string[];
  // Set while opened by @: the search comes from the composer, not the panel's own box.
  query?: string | null;
  development?: boolean;
}>();
const emit = defineEmits<{ toggle: [reference: Reference]; close: [] }>();
const panel = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const own = ref('');
const groups = ref<{ key: string; heading: string; items: Reference[] }[]>([]);
const loading = ref(true);
const error = ref('');
const active = ref(0);
const keyOf = (r: Pick<Reference, 'kind' | 'id'>) => `${r.kind}:${r.id}`;
const typed = computed(() => props.query !== null && props.query !== undefined);
const term = computed(() => (typed.value ? props.query! : own.value).trim().toLowerCase());
const shown = computed(() =>
  groups.value
    .map((g) => ({
      ...g,
      items: term.value
        ? g.items.filter((i) => `${i.label} ${i.detail ?? ''}`.toLowerCase().includes(term.value))
        : g.items,
    }))
    .filter((g) => g.items.length),
);
const flat = computed(() => shown.value.flatMap((g) => g.items.filter((i) => !i.disabled)));
watch(term, () => (active.value = 0));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const query = props.sessionId ? `?session=${props.sessionId}` : '';
    groups.value = (
      await api<{ groups: typeof groups.value }>(`${props.base}/references${query}`)
    ).groups;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
void load();
// Opened from the “+” menu, which hands focus back to its trigger as it closes: focus the
// search box after that, and let Esc close the panel wherever focus is.
setTimeout(() => {
  if (!typed.value) search.value?.focus();
}, 60);
onClickOutside(panel, () => emit('close'));
useEventListener(document, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !panel.value?.contains(e.target as Node)) emit('close');
});

function pick(r: Reference) {
  if (r.disabled) return;
  emit('toggle', r);
}
function move(delta: number) {
  if (!flat.value.length) return;
  active.value = (active.value + delta + flat.value.length) % flat.value.length;
}
// Enter: picks the highlighted item; false when there is nothing to pick.
function choose() {
  const r = flat.value[active.value];
  if (!r) return false;
  pick(r);
  return true;
}
function keydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    move(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}
defineExpose({ move, choose });
const icon = (kind: Reference['kind']) =>
  kind === 'business_function' ? NotebookText : kind === 'item_file' ? FileText : MessageSquare;
</script>
<template>
  <div
    ref="panel"
    class="reference-picker"
    role="dialog"
    aria-label="引用开发项资料"
    @keydown="keydown"
  >
    <input
      v-if="!typed"
      ref="search"
      v-model="own"
      class="reference-search"
      placeholder="搜索开发项资料"
      aria-label="搜索开发项资料"
    />
    <p v-if="loading" class="reference-note" role="status">
      <LoaderCircle :size="14" class="animate-spin" />读取中…
    </p>
    <p v-else-if="error" class="reference-note" role="alert">{{ error }}</p>
    <p v-else-if="!shown.length" class="reference-note">
      {{ term ? '没有匹配的资料' : '这个开发项还没有可引用的资料' }}
    </p>
    <section v-for="g in shown" :key="g.key" class="reference-group">
      <h4>{{ g.heading }}</h4>
      <ul role="listbox" :aria-label="g.heading" aria-multiselectable="true">
        <li
          v-for="r in g.items"
          :key="keyOf(r)"
          role="option"
          :aria-selected="selected.includes(keyOf(r))"
          :aria-disabled="r.disabled || undefined"
        >
          <button
            type="button"
            class="reference-option"
            :class="{ active: flat[active] && keyOf(flat[active]) === keyOf(r) }"
            :disabled="r.disabled"
            @mousedown.prevent
            @click="pick(r)"
          >
            <component :is="icon(r.kind)" :size="14" class="reference-icon" />
            <span class="reference-text"
              ><strong>{{ r.label }}</strong
              ><small v-if="r.detail">{{ r.detail }}</small></span
            >
            <Check v-if="selected.includes(keyOf(r))" :size="14" class="reference-check" />
          </button>
        </li>
      </ul>
    </section>
    <p v-if="development" class="reference-foot">开发项附件与 FSD 各版本会自动提供给开发助手。</p>
  </div>
</template>
<style scoped>
.reference-picker {
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(360px, 100%);
  max-height: 360px;
  overflow-y: auto;
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--panel);
  box-shadow: var(--shadow-popover);
}
.reference-search {
  height: var(--control-input);
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-6);
  background: var(--panel);
  font-size: var(--font-12);
  color: var(--text);
}
.reference-group h4 {
  margin: 0 0 var(--space-1);
  padding: 0 var(--space-1);
  font-size: var(--font-11);
  font-weight: var(--weight-550);
  color: var(--text-subtle);
}
.reference-group ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.reference-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1-5) var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: none;
  text-align: left;
  cursor: pointer;
}
.reference-option:hover,
.reference-option.active {
  background: var(--hover);
}
.reference-option:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.reference-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}
.reference-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.reference-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-12);
  font-weight: var(--weight-475);
  color: var(--text);
}
.reference-text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-11);
  color: var(--text-muted);
}
.reference-check {
  flex-shrink: 0;
  color: var(--text);
}
.reference-note,
.reference-foot {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  margin: 0;
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-12);
  color: var(--text-muted);
}
.reference-foot {
  border-top: 1px solid var(--border);
  padding-top: var(--space-2);
}
</style>
