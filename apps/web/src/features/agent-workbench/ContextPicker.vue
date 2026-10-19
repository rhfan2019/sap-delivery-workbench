<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue';
import { Check, ChevronDown, LoaderCircle } from '@lucide/vue';
import BasePopover from '../../components/base/BasePopover.vue';

// One control for what the next message runs with: the SAP system and the model
// (docs/specs/agent-workspace-start-and-composer.md 4.3). Same trigger, same type size, a
// popover with a searchable list. `open` asks the owner to fetch the list again.
export interface ContextOption {
  id: string;
  label: string;
  detail?: string;
  badge?: string;
  warn?: boolean;
}
const props = defineProps<{
  label: string;
  icon: Component;
  value: string;
  groups: { heading: string; options: ContextOption[] }[];
  selectedId: string;
  disabled?: boolean;
  loading?: boolean;
  // A yellow dot on the trigger with the reason (e.g. the chosen system needs a login).
  warning?: string;
  empty?: string;
  // The value text gives way first in a narrow composer (only the icon stays).
  collapsible?: boolean;
}>();
const emit = defineEmits<{ select: [id: string]; open: [] }>();
defineSlots<{ action?(props: { option: ContextOption }): unknown; footer?(): unknown }>();
const open = ref(false);
const query = ref('');
const search = ref<HTMLInputElement | null>(null);
watch(open, async (value) => {
  if (!value) return;
  query.value = '';
  emit('open');
  await nextTick();
  search.value?.focus();
});
const count = computed(() => props.groups.reduce((n, g) => n + g.options.length, 0));
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.groups
    .map((g) => ({
      ...g,
      options: q
        ? g.options.filter((o) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q))
        : g.options,
    }))
    .filter((g) => g.options.length);
});
function pick(id: string) {
  emit('select', id);
  open.value = false;
}
</script>
<template>
  <BasePopover v-model:open="open" align="end" side="top">
    <template #trigger>
      <button
        type="button"
        class="context-trigger"
        :class="{ collapsible }"
        :aria-label="label + '：' + value"
        :title="warning || label + '：' + value"
        :disabled="disabled"
      >
        <component :is="icon" :size="14" aria-hidden="true" />
        <span class="context-value">{{ value }}</span>
        <span v-if="warning" class="context-warn" aria-hidden="true" />
        <ChevronDown :size="14" aria-hidden="true" />
      </button>
    </template>
    <div class="context-panel" :aria-label="label">
      <input
        v-if="count > 5"
        ref="search"
        v-model="query"
        class="context-search"
        :placeholder="'搜索' + label"
        :aria-label="'搜索' + label"
      />
      <p v-if="loading && !count" class="context-note" role="status">
        <LoaderCircle :size="14" class="animate-spin" />读取中…
      </p>
      <p v-else-if="!shown.length" class="context-note">{{ query ? '没有匹配项' : empty }}</p>
      <section v-for="g in shown" :key="g.heading" class="context-group">
        <h4>{{ g.heading }}</h4>
        <ul role="listbox" :aria-label="g.heading">
          <li
            v-for="o in g.options"
            :key="o.id"
            role="option"
            :aria-selected="o.id === selectedId"
            class="context-option"
          >
            <button type="button" class="context-pick" @click="pick(o.id)">
              <span class="context-text"
                ><strong>{{ o.label }}</strong
                ><small v-if="o.detail">{{ o.detail }}</small></span
              >
              <span v-if="o.badge" class="context-badge" :class="{ warn: o.warn }">{{
                o.badge
              }}</span>
              <Check v-if="o.id === selectedId" :size="14" class="context-check" />
            </button>
            <slot name="action" :option="o" />
          </li>
        </ul>
      </section>
      <slot name="footer" />
    </div>
  </BasePopover>
</template>
<style scoped>
.context-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 220px;
  height: var(--control-button);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: none;
  font-size: var(--font-12);
  line-height: var(--leading-16);
  color: var(--text-muted);
  cursor: pointer;
}
.context-trigger:hover:not(:disabled),
.context-trigger[data-state='open'] {
  background: var(--hover);
  color: var(--text);
}
.context-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.context-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-warn {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--yellow-solid-1);
}
.context-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 300px;
  max-height: 360px;
  overflow-y: auto;
}
.context-search {
  height: var(--control-input);
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-6);
  background: var(--panel);
  font-size: var(--font-12);
  color: var(--text);
}
.context-group h4 {
  margin: 0 0 var(--space-1);
  padding: 0 var(--space-1);
  font-size: var(--font-11);
  font-weight: var(--weight-550);
  color: var(--text-subtle);
}
.context-group ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.context-option {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.context-pick {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1-5) var(--space-2);
  border: 0;
  border-radius: var(--radius-6);
  background: none;
  text-align: left;
  cursor: pointer;
}
.context-pick:hover {
  background: var(--hover);
}
.context-option[aria-selected='true'] .context-pick {
  background: var(--selected);
}
.context-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.context-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-12);
  font-weight: var(--weight-475);
  color: var(--text);
}
.context-text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-11);
  color: var(--text-muted);
}
.context-badge {
  flex-shrink: 0;
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-4);
  background: var(--neutral-fill-1);
  font-size: var(--font-11);
  color: var(--text-muted);
}
.context-badge.warn {
  background: var(--yellow-fill-1);
  color: var(--yellow-text-1);
}
.context-check {
  flex-shrink: 0;
  color: var(--text);
}
.context-note {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  margin: 0;
  padding: var(--space-2);
  font-size: var(--font-12);
  color: var(--text-muted);
}
</style>
