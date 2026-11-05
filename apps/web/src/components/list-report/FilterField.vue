<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref } from 'vue';
import { CalendarDays, ChevronDown, X } from '@lucide/vue';
import BaseInput from '../base/BaseInput.vue';
import BasePopover from '../base/BasePopover.vue';
import FilterPanel from './FilterPanel.vue';
import type { ListField } from './types';
import type { ListReportApi } from './useListReport';

// One field on the filter bar: its label, what it is set to, and the panel to change that.
const props = defineProps<{ report: ListReportApi<T>; field: ListField<T> }>();
const open = ref(false);
const tokens = computed(() => props.report.tokens(props.field.key));
const shown = computed(() => tokens.value.slice(0, 2));
const summary = computed(() => tokens.value.map((t) => t.text).join('、') || '全部');
const textValue = computed({
  get: () => String(props.report.conditions.value[props.field.key]?.[0]?.low ?? ''),
  set: (value: string) =>
    props.report.setRanges(props.field.key, value ? [{ sign: 'I', option: 'CP', low: value }] : []),
});
</script>

<template>
  <div class="lr-field" :class="{ set: tokens.length }">
    <span class="lr-field-label">{{ field.label }}</span>
    <BaseInput
      v-if="field.type === 'text'"
      v-model="textValue"
      placeholder="包含文字"
      :label="field.label + '包含文字'"
    />
    <div v-else class="lr-input" :class="{ open }">
      <BasePopover v-model:open="open">
        <template #trigger>
          <button
            type="button"
            class="lr-trigger"
            :aria-label="field.label + '：' + summary"
            :title="summary"
          >
            <span v-if="!tokens.length" class="lr-placeholder">全部</span>
            <span
              v-for="(t, index) in shown"
              :key="index"
              class="lr-token"
              :class="{ exclude: t.exclude }"
              >{{ t.text }}</span
            >
            <span v-if="tokens.length > shown.length" class="lr-more"
              >+{{ tokens.length - shown.length }}</span
            >
            <CalendarDays v-if="field.type === 'date'" class="lr-icon" />
            <ChevronDown v-else class="lr-icon" />
          </button>
        </template>
        <FilterPanel :report="report" :field="field" />
      </BasePopover>
      <button
        v-if="tokens.length"
        type="button"
        class="lr-clear"
        :aria-label="'清除' + field.label"
        @click="report.setRanges(field.key, [])"
      >
        <X />
      </button>
    </div>
  </div>
</template>
