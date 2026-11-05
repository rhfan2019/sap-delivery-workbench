<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref, watch } from 'vue';
import { ArrowDown, ArrowUp } from '@lucide/vue';
import BaseButton from '../base/BaseButton.vue';
import BaseDialog from '../base/BaseDialog.vue';
import BaseIconButton from '../base/BaseIconButton.vue';
import BaseInput from '../base/BaseInput.vue';
import BaseTabs from '../base/BaseTabs.vue';
import type { ListReportApi } from './useListReport';

// 适配筛选 (Fiori's Adapt Filters): which fields the bar shows, and in what order.
const props = defineProps<{ report: ListReportApi<T> }>();
const open = defineModel<boolean>('open', { default: false });
const draft = ref<string[]>([]);
const query = ref('');
const tab = ref('all');
watch(open, (value) => {
  if (value) {
    draft.value = [...props.report.filterFields.value];
    query.value = '';
    tab.value = 'all';
  }
});
const hasValue = (key: string) => !!props.report.conditions.value[key]?.length;
const tabs = computed(() => [
  { id: 'all', label: '全部', count: props.report.fields.value.length },
  { id: 'shown', label: '已显示', count: draft.value.length },
  {
    id: 'set',
    label: '有值',
    count: props.report.fields.value.filter((f) => hasValue(f.key)).length,
  },
]);
const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = props.report.fields.value.filter(
    (f) =>
      (!q || f.label.toLowerCase().includes(q)) &&
      (tab.value !== 'shown' || draft.value.includes(f.key)) &&
      (tab.value !== 'set' || hasValue(f.key)),
  );
  return [...new Set(list.map((f) => f.group))].map((name) => ({
    name,
    fields: list.filter((f) => f.group === name),
  }));
});
function toggle(key: string, on: boolean) {
  draft.value = on ? [...draft.value, key] : draft.value.filter((k) => k !== key);
}
function move(key: string, direction: number) {
  const list = [...draft.value];
  const index = list.indexOf(key);
  const other = index + direction;
  if (index < 0 || other < 0 || other >= list.length) return;
  [list[index], list[other]] = [list[other], list[index]];
  draft.value = list;
}
function confirm() {
  // A field taken off the bar takes its condition with it: nothing narrows the list out of sight.
  for (const key of props.report.filterFields.value)
    if (!draft.value.includes(key)) props.report.setRanges(key, []);
  props.report.filterFields.value = draft.value;
  open.value = false;
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    wide
    title="适配筛选"
    description="勾选要放在筛选栏上的字段，用箭头调整顺序；取消勾选会一并清除它的条件。"
  >
    <div class="lr-adapt-tools">
      <BaseInput v-model="query" placeholder="搜索字段" label="搜索字段" />
      <BaseTabs v-model="tab" label="字段范围" :tabs="tabs" />
    </div>
    <div class="lr-adapt-list">
      <section v-for="group in groups" :key="group.name">
        <h3>{{ group.name }}</h3>
        <div v-for="field in group.fields" :key="field.key" class="lr-adapt-row">
          <label
            ><input
              type="checkbox"
              :aria-label="'显示筛选字段 ' + field.label"
              :checked="draft.includes(field.key)"
              @change="toggle(field.key, ($event.target as HTMLInputElement).checked)"
            />{{ field.label }}</label
          >
          <span class="lr-adapt-value">{{
            report
              .tokens(field.key)
              .map((t) => t.text)
              .join('、')
          }}</span>
          <span v-if="draft.includes(field.key)" class="lr-adapt-moves">
            <BaseIconButton
              size="sm"
              :tooltip="false"
              :label="'上移 ' + field.label"
              @click="move(field.key, -1)"
              ><ArrowUp
            /></BaseIconButton>
            <BaseIconButton
              size="sm"
              :tooltip="false"
              :label="'下移 ' + field.label"
              @click="move(field.key, 1)"
              ><ArrowDown
            /></BaseIconButton>
          </span>
        </div>
      </section>
      <p v-if="!groups.length" class="lr-none">没有匹配的字段</p>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="draft = report.defaultFields()">恢复默认</BaseButton>
      <BaseButton @click="open = false">取消</BaseButton>
      <BaseButton variant="primary" @click="confirm">确定</BaseButton>
    </template>
  </BaseDialog>
</template>
