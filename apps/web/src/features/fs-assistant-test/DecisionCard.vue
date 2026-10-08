<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanDescription,
  PlanContent,
} from '@/components/ai-elements/plan';
import { Button } from '@/components/ui/button';
import type { AgentDecision } from '@sap-delivery-workbench/contracts/agent-runtime/types';
import { identity } from '../../services/session';
const props = defineProps<{ decision: AgentDecision; busy: boolean }>();
const emit = defineEmits<{ answer: [values: Record<string, string>] }>();
const key = 'fs-decision:' + identity.value?.user?.id + ':' + props.decision.id;
const values = ref<Record<string, string>>({}),
  notes = ref<Record<string, string>>({});
try {
  const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
  values.value = saved.values ?? {};
  notes.value = saved.notes ?? {};
} catch {}
watch(
  [values, notes],
  () => {
    error.value = '';
    try {
      localStorage.setItem(key, JSON.stringify({ values: values.value, notes: notes.value }));
    } catch {}
  },
  { deep: true },
);
const error = ref('');
const canRecommend = computed(() =>
  props.decision.questions.every((q) => q.options.filter((o) => o.recommended).length === 1),
);
function recommend() {
  for (const q of props.decision.questions)
    values.value[q.id] = q.options.find((o) => o.recommended)!.value;
}
function submit() {
  const answer: Record<string, string> = {};
  for (const q of props.decision.questions) {
    const v = values.value[q.id];
    if (!v || (v === 'custom' && !notes.value[q.id]?.trim())) {
      error.value = '请为每个问题选择选项或填写说明。';
      return;
    }
    answer[q.id] = v === 'custom' ? 'text:' + notes.value[q.id].trim() : v;
  }
  error.value = '';
  emit('answer', answer);
}
</script>
<template>
  <Plan :default-open="true" class="elements-question decision-card" aria-label="需要确认"
    ><PlanHeader
      ><div>
        <PlanTitle>需要你确认后继续</PlanTitle
        ><PlanDescription>{{ decision.message }}</PlanDescription>
      </div></PlanHeader
    ><PlanContent
      ><form @submit.prevent="submit">
        <fieldset v-for="q in decision.questions" :key="q.id" :disabled="busy">
          <legend>{{ q.title }}</legend>
          <label v-for="o in q.options" :key="o.value"
            ><input
              v-model="values[q.id]"
              type="radio"
              :name="decision.id + q.id"
              :value="o.value"
            /><span
              ><strong>{{ o.label }}{{ o.recommended ? '（推荐）' : '' }}</strong
              ><small>{{ o.description }}</small></span
            ></label
          ><label v-if="q.allowText"
            ><input
              v-model="values[q.id]"
              type="radio"
              :name="decision.id + q.id"
              value="custom"
            /><span>补充其他口径</span></label
          ><label v-if="q.allowText"
            ><input
              v-model="values[q.id]"
              type="radio"
              :name="decision.id + q.id"
              value="text:暂不确定"
            /><span>暂不确定，列为待确认</span></label
          ><textarea
            v-if="values[q.id] === 'custom'"
            v-model="notes[q.id]"
            maxlength="990"
            :aria-label="q.title + '：补充说明'"
          />
        </fieldset>
        <p v-if="error" role="alert">{{ error }}</p>
        <Button
          v-if="canRecommend"
          :disabled="busy"
          type="button"
          variant="outline"
          class="mr-2"
          @click="recommend"
          >选择全部推荐</Button
        >
        <Button :disabled="busy" type="submit">{{ busy ? '正在提交…' : '确认并继续' }}</Button
        ><small>选择不会自动提交。确认后复用原需求、附件和系统目标。</small>
      </form></PlanContent
    ></Plan
  >
</template>
<style scoped>
.decision-card {
  margin-block: 8px;
  width: 100%;
  min-width: 0;
}
fieldset {
  border: 0;
  padding: 12px 0;
  margin: 0;
}
legend {
  font-size: 14px;
  font-weight: 600;
}
label {
  display: flex;
  gap: 12px;
  padding: 12px;
  align-items: flex-start;
  border-radius: 8px;
  cursor: pointer;
  margin: 4px 0;
  width: 100%;
  min-width: 0;
}
label:has(input:checked) {
  background: var(--hover);
}
.decision-card input[type='radio'] {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  padding: 0;
  margin-top: 4px;
  accent-color: var(--primary);
}
label > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
  margin-top: 4px;
}
textarea {
  width: 100%;
  min-height: 80px;
  border: 1px solid var(--border);
  padding: 12px;
  border-radius: 8px;
  font: inherit;
}
</style>
