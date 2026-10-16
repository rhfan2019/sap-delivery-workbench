<script setup lang="ts">
import { ref } from 'vue';
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanDescription,
  PlanContent,
} from '@/components/ai-elements/plan';
import { Button } from '@/components/ui/button';
import TestSystemLogin from './TestSystemLogin.vue';
import type { TestDataRequest } from './session-model.mjs';

// Contract 3.4: the user reviews a test data request and decides; approving needs their own
// QAS user of this login.
defineProps<{ request: TestDataRequest; base: string; busy: boolean }>();
const emit = defineEmits<{ decide: [decision: 'approve' | 'reject', note: string] }>();
const ready = ref(false),
  note = ref('');
</script>
<template>
  <Plan :default-open="true" class="elements-question decision-card" aria-label="建单申请"
    ><PlanHeader
      ><div>
        <PlanTitle>申请在 QAS 建立测试数据</PlanTitle
        ><PlanDescription
          >{{ request.dataId }} · {{ request.object }} · 目标 {{ request.target.systemCode }} client
          {{ request.target.client }}</PlanDescription
        >
      </div></PlanHeader
    ><PlanContent class="space-y-3 text-sm">
      <p>{{ request.purpose }}</p>
      <div>
        <strong>关键数据</strong>
        <p class="whitespace-pre-wrap text-muted-foreground">{{ request.keyData }}</p>
      </div>
      <p><strong>调用</strong>：{{ request.functions.join('、') }}</p>
      <details>
        <summary class="cursor-pointer">查看将要执行的代码</summary>
        <pre class="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs">{{
          request.body
        }}</pre>
      </details>
      <p class="text-xs text-muted-foreground">
        同意后，程序用您本人的 QAS 用户在 $TMP 建立临时类、执行上面的代码并删除临时类。
      </p>
      <TestSystemLogin :base="base" @status="ready = $event.ready" />
      <textarea
        v-model="note"
        rows="2"
        maxlength="2000"
        placeholder="拒绝时可以说明原因（可选）"
        class="w-full rounded border px-2 py-1"
      />
      <div class="flex gap-2">
        <Button size="sm" :disabled="busy || !ready" @click="emit('decide', 'approve', note)"
          >同意并执行</Button
        ><Button
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="emit('decide', 'reject', note)"
          >拒绝</Button
        >
      </div>
    </PlanContent></Plan
  >
</template>
