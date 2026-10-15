<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, LoaderCircle, Circle, AlertCircle } from '@lucide/vue';
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanDescription,
  PlanContent,
  PlanTrigger,
} from '@/components/ai-elements/plan';
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai-elements/task';
import { stepPresentation } from './presentation.mjs';
import type { AgentStep } from '@sap-delivery-workbench/contracts/agent-core/types';
const props = defineProps<{ steps: AgentStep[]; reason?: string }>();
const completed = computed(() => props.steps.filter((s) => s.status === 'succeeded').length);
const current = computed(() =>
  props.steps.find((s) => ['running', 'waiting_user', 'failed'].includes(s.status)),
);
const open = ref(true);
watch(
  () => props.steps.map((s) => s.status).join(','),
  () => {
    if (
      props.steps.length &&
      props.steps.every((s) => ['succeeded', 'skipped', 'cancelled'].includes(s.status))
    )
      open.value = false;
    else if (current.value) open.value = true;
  },
  { immediate: true },
);
</script>
<template>
  <Plan
    v-if="steps.length"
    v-model:open="open"
    :is-streaming="!!steps.find((s) => s.status === 'running')"
    class="gap-0 py-0"
    aria-label="执行步骤"
  >
    <PlanHeader class="px-3 py-2"
      ><div class="space-y-1">
        <PlanTitle>执行进度 · {{ completed }} / {{ steps.length }}</PlanTitle
        ><PlanDescription role="status">{{
          current ? current.label + ' · ' + stepPresentation(current.status).label : '本轮处理记录'
        }}</PlanDescription>
      </div>
      <PlanTrigger aria-label="展开或收起执行步骤"
    /></PlanHeader>
    <PlanContent class="px-3 pb-2">
      <Task
        v-for="s in steps"
        :key="s.stepId + ':' + s.status"
        :default-open="['running', 'failed', 'waiting_user'].includes(s.status)"
      >
        <div class="border-t py-1">
          <TaskTrigger :title="s.label"
            ><button type="button" class="flex w-full items-center gap-2 text-left text-sm">
              <LoaderCircle v-if="s.status === 'running'" class="size-4 animate-spin" /><Check
                v-else-if="s.status === 'succeeded'"
                class="size-4 text-emerald-700"
              /><AlertCircle
                v-else-if="['failed', 'waiting_user'].includes(s.status)"
                class="size-4 text-amber-700"
              /><Circle v-else class="size-4 text-muted-foreground" /><span class="flex-1">{{
                s.label
              }}</span
              ><span class="text-xs text-muted-foreground">{{
                stepPresentation(s.status).label
              }}</span>
            </button></TaskTrigger
          >
          <TaskContent
            ><TaskItem class="pt-2 text-sm"
              >{{ s.summary || '暂无补充说明'
              }}<span v-if="s.attempt > 1"> · 第 {{ s.attempt }} 次尝试</span></TaskItem
            ></TaskContent
          >
        </div>
      </Task>
      <p v-if="reason" class="mt-3 text-xs text-muted-foreground">类型依据：{{ reason }}</p>
    </PlanContent>
  </Plan>
</template>
