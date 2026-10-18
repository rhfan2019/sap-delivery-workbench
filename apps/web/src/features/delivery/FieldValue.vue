<script setup lang="ts">
import { computed } from 'vue';
import {
  displayText,
  fieldValue,
  overdue,
  type FieldDef,
  type Item,
  type ListContext,
  type SapObject,
} from './model';
import { safeHtml } from './richText';
import BaseAvatar from '../../components/base/BaseAvatar.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import { kindIdentity, moduleHue, priorityIdentity } from '../../components/base/identity';

// Read-only rendering of one field: compact in table cells, full in the drawer.
const props = defineProps<{ item: Item; field: FieldDef; ctx: ListContext; compact?: boolean }>();
const value = computed(() => fieldValue(props.item, props.field.key));
const text = computed(() => displayText(props.item, props.field, props.ctx));
const late = computed(
  () =>
    props.field.phase &&
    props.field.name === 'status' &&
    overdue(props.item.phases[props.field.phase]),
);
// Identity colours (DESIGN.md 2.2.1): people, modules, kinds and priorities.
const member = computed(() => props.field.type === 'member' || props.field.customType === 'member');
const mark = computed(() =>
  props.field.key === 'kind'
    ? kindIdentity[String(value.value)]
    : props.field.key === 'priority'
      ? priorityIdentity[String(value.value)]
      : undefined,
);
const tags = computed(() =>
  ((value.value as string[]) ?? [])
    .map((id) => props.ctx.tags.find((t) => t.id === id))
    .filter(Boolean),
);
</script>

<template>
  <span v-if="field.type === 'select' && field.key.endsWith('.status')" class="status-cell"
    ><span class="status-pill" :data-status="value">{{ text }}</span
    ><span v-if="late" class="late-mark" title="计划完成日期已过，状态未更新">逾期</span></span
  >
  <span v-else-if="member" class="person-cell" :title="text || '未分配'"
    ><BaseAvatar :name="text" :size="20" /><span :class="text ? 'cell-text' : 'empty-value'">{{
      text || '未分配'
    }}</span></span
  >
  <BaseTag v-else-if="field.key === 'module' && text" :tone="moduleHue(text)">{{ text }}</BaseTag>
  <span v-else-if="mark && text" class="mark-cell"
    ><component :is="mark.icon" :style="{ color: `var(--${mark.hue}-icon-1)` }" /><span>{{
      text
    }}</span></span
  >
  <span v-else-if="field.type === 'percent'" class="progress-cell" :aria-label="text"
    ><span class="progress-track"><span :style="{ width: (value ?? 0) + '%' }" /></span
    ><span>{{ value ?? 0 }}%</span></span
  >
  <span v-else-if="field.type === 'tags'" class="tag-list"
    ><span v-for="t in tags" :key="t!.id" class="tag-chip" :data-color="t!.color">{{
      t!.name
    }}</span
    ><span v-if="!tags.length" class="empty-value">—</span></span
  >
  <div
    v-else-if="field.type === 'rich' && !compact && text"
    class="rich-read"
    v-html="safeHtml(String(value))"
  />
  <ul
    v-else-if="field.type === 'objects' && !compact && (value as SapObject[])?.length"
    class="object-list"
  >
    <li v-for="o in value as SapObject[]" :key="o.pgmid + o.objectType + o.objectName">
      <code>{{ o.pgmid }}</code
      ><code>{{ o.objectType }}</code
      ><span>{{ o.objectName }}</span>
    </li>
  </ul>
  <a
    v-else-if="field.customType === 'url' && text"
    :href="text"
    target="_blank"
    rel="noopener noreferrer"
    class="text-link"
    @click.stop
    >{{ text }}</a
  >
  <span
    v-else
    :class="{
      'empty-value': !text,
      'is-high': field.key === 'priority' && value === 'high',
      'cell-text': compact,
    }"
    :title="compact && text.length > 12 ? text : undefined"
    >{{ text || (field.type === 'member' ? '未分配' : '—') }}</span
  >
</template>
