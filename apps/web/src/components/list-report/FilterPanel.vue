<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref, watch } from 'vue';
import {
  DATE_PRESETS,
  type ConditionRange,
} from '@sap-delivery-workbench/contracts/list-report/conditions';
import BaseDateInput from '../base/BaseDateInput.vue';
import BaseInput from '../base/BaseInput.vue';
import type { ListField } from './types';
import type { ListReportApi } from './useListReport';

// Editing one field's condition: the same panel opens from the filter bar and the column menu.
const props = defineProps<{ report: ListReportApi<T>; field: ListField<T> }>();
const ranges = computed(() => props.report.conditions.value[props.field.key] ?? []);
const set = (next: ConditionRange[]) => props.report.setRanges(props.field.key, next);

// --- choices --------------------------------------------------------------------------------
const query = ref('');
const sign = ref<'I' | 'E'>(ranges.value[0]?.sign ?? 'I');
watch(ranges, (list) => {
  if (list[0]) sign.value = list[0].sign;
});
const counts = computed(() => props.report.optionCounts(props.field.key));
const options = computed(() => {
  const q = query.value.trim().toLowerCase();
  return (props.field.options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q));
});
const chosen = (value: string) => ranges.value.some((r) => r.option === 'EQ' && r.low === value);
const emptyChosen = computed(() => ranges.value.some((r) => r.option === 'EMPTY'));
function toggle(value: string, on: boolean) {
  const others = ranges.value.filter((r) => !(r.option === 'EQ' && r.low === value));
  set(on ? [...others, { sign: sign.value, option: 'EQ', low: value }] : others);
}
function toggleEmpty(on: boolean) {
  const others = ranges.value.filter((r) => r.option !== 'EMPTY');
  set(on ? [...others, { sign: sign.value, option: 'EMPTY' }] : others);
}
function setSign(next: 'I' | 'E') {
  sign.value = next;
  set(ranges.value.map((r) => ({ ...r, sign: next })));
}
const chooseAll = () =>
  set(options.value.map((o) => ({ sign: sign.value, option: 'EQ' as const, low: o.value })));

// --- dates ----------------------------------------------------------------------------------
const presets = Object.entries(DATE_PRESETS);
const preset = computed(() => ranges.value.find((r) => r.option === 'PRESET')?.low ?? '');
const between = computed(() => ranges.value.find((r) => r.option === 'BT'));
const setBetween = (low: unknown, high: unknown) =>
  set(
    low || high
      ? [{ sign: 'I', option: 'BT', low: String(low ?? ''), high: String(high ?? '') }]
      : [],
  );

// --- text and numbers -----------------------------------------------------------------------
const textValue = computed({
  get: () => String(ranges.value.find((r) => r.option === 'CP')?.low ?? ''),
  set: (value: string) => set(value ? [{ sign: 'I', option: 'CP', low: value }] : []),
});
</script>

<template>
  <div class="lr-panel">
    <template v-if="field.type === 'select'">
      <div class="lr-segment" role="group" :aria-label="field.label + '的匹配方式'">
        <button type="button" :class="{ on: sign === 'I' }" @click="setSign('I')">包含</button>
        <button type="button" :class="{ on: sign === 'E' }" @click="setSign('E')">排除</button>
      </div>
      <BaseInput
        v-if="(field.options?.length ?? 0) > 6"
        v-model="query"
        placeholder="筛选选项"
        :label="'筛选' + field.label + '的选项'"
      />
      <div class="lr-options">
        <label
          v-for="o in options"
          :key="o.value"
          class="lr-option"
          :class="{ on: chosen(o.value) }"
          ><input
            type="checkbox"
            :checked="chosen(o.value)"
            @change="toggle(o.value, ($event.target as HTMLInputElement).checked)"
          /><span>{{ o.label }}</span
          ><em>{{ counts.get(o.value) ?? 0 }}</em></label
        >
        <label v-if="field.emptyLabel" class="lr-option" :class="{ on: emptyChosen }"
          ><input
            type="checkbox"
            :checked="emptyChosen"
            @change="toggleEmpty(($event.target as HTMLInputElement).checked)"
          /><span>{{ field.emptyLabel }}</span
          ><em>{{ counts.get('') ?? 0 }}</em></label
        >
        <p v-if="!options.length && !field.emptyLabel" class="lr-none">没有匹配的选项</p>
      </div>
      <footer class="lr-panel-foot">
        <span>已选 {{ ranges.length }} 项</span>
        <button type="button" @click="chooseAll">全选</button>
        <button type="button" :disabled="!ranges.length" @click="set([])">清除</button>
      </footer>
    </template>

    <template v-else-if="field.type === 'date'">
      <div class="lr-chips" role="group" :aria-label="field.label + '的常用范围'">
        <button
          v-for="[key, label] in presets"
          :key="key"
          type="button"
          :class="{ on: preset === key }"
          :aria-pressed="preset === key"
          @click="set(preset === key ? [] : [{ sign: 'I', option: 'PRESET', low: key }])"
        >
          {{ label }}
        </button>
      </div>
      <div class="lr-pair">
        <div>
          <span class="lr-pair-label">从</span>
          <BaseDateInput
            :model-value="String(between?.low ?? '')"
            :label="field.label + ' 从'"
            @update:model-value="setBetween($event, between?.high)"
          />
        </div>
        <div>
          <span class="lr-pair-label">到</span>
          <BaseDateInput
            :model-value="String(between?.high ?? '')"
            :label="field.label + ' 到'"
            @update:model-value="setBetween(between?.low, $event)"
          />
        </div>
      </div>
      <label class="lr-option"
        ><input
          type="checkbox"
          :checked="emptyChosen"
          @change="
            set(($event.target as HTMLInputElement).checked ? [{ sign: 'I', option: 'EMPTY' }] : [])
          "
        /><span>只看未填写</span><em>{{ counts.get('') ?? 0 }}</em></label
      >
      <p class="lr-note">选择常用范围后按当天计算，保存到视图里也一直有效。</p>
    </template>

    <div v-else-if="field.type === 'number'" class="lr-pair">
      <div>
        <span class="lr-pair-label">最小</span>
        <BaseInput
          :model-value="String(between?.low ?? '')"
          type="number"
          :label="field.label + ' 最小值'"
          @update:model-value="setBetween($event, between?.high)"
        />
      </div>
      <div>
        <span class="lr-pair-label">最大</span>
        <BaseInput
          :model-value="String(between?.high ?? '')"
          type="number"
          :label="field.label + ' 最大值'"
          @update:model-value="setBetween(between?.low, $event)"
        />
      </div>
    </div>

    <BaseInput
      v-else
      v-model="textValue"
      placeholder="包含文字"
      :label="field.label + '包含文字'"
    />
  </div>
</template>
