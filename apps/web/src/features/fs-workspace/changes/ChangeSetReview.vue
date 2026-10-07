<script setup lang="ts">
import type { ChangeSet, FsDocument } from '../api';
const props = defineProps<{ change: ChangeSet; busy: boolean; document: FsDocument | null }>();
defineEmits<{ accept: []; reject: [] }>();
const names: Record<string, string> = {
  block: '文档段落',
  section: '章节',
  rule: '业务规则',
  requirement: '需求',
  decision: '业务决策',
  test: '测试用例',
  issue: '待解决问题',
};
const actions: Record<string, string> = {
  add: '新增',
  update: '修改',
  replace: '修改',
  remove: '删除',
};
function before(id: string) {
  return props.document?.sections
    .flatMap((section) => section.blocks)
    .find((block) => block.id === id)?.text;
}
function summary(value: unknown): string {
  if (!value || typeof value !== 'object') return '删除此内容';
  const fields = value as Record<string, unknown>;
  return (
    ['title', 'text', 'statement', 'description', 'expected']
      .map((key) => fields[key])
      .filter((value): value is string => typeof value === 'string')
      .join('\n') || '结构化内容发生变化，请检查关联影响。'
  );
}
</script>
<template>
  <section class="fs-change-review" aria-label="待接受的修改">
    <h2>审阅修改候选</h2>
    <p>接受后才会创建新修订；如果基础版本已变化，系统会阻止覆盖。</p>
    <ol>
      <li v-for="operation in change.operations" :key="operation.target_id">
        <strong
          >{{ names[operation.entity_type] ?? '内容' }} ·
          {{ actions[operation.op] ?? '修改' }}</strong
        >
        <p>{{ operation.reason }}</p>
        <div v-if="before(operation.target_id) !== undefined">
          <h3>修改前</h3>
          <p>{{ before(operation.target_id) }}</p>
        </div>
        <h3>修改后</h3>
        <p>{{ summary(operation.value) }}</p>
      </li>
    </ol>
    <h3>关联影响</h3>
    <ul>
      <li v-for="impact in change.impacts" :key="impact.entity_id">
        {{ impact.reason }}
      </li>
    </ul>
    <button class="primary" :disabled="busy" @click="$emit('accept')">接受全部关联修改</button
    ><button :disabled="busy" @click="$emit('reject')">拒绝候选</button>
  </section>
</template>
