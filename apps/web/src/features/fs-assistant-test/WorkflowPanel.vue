<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '../../services/session';
import type {
  AgentArtifact,
  FsdPhase,
  FsdWorkflow,
  FsdWorkflowCommand,
} from '@sap-delivery-workbench/contracts/agent-runtime/types';
import { workflowActions, workflowReviewKey, workflowArtifactToSync } from './workflowActions.mjs';
import ChatMarkdown from './ChatMarkdown.vue';
const props = defineProps<{
  base: string;
  conversationId: string;
  busy: boolean;
  readonly: boolean;
  revision?: string;
}>();
const emit = defineEmits<{
  busy: [value: boolean];
  artifact: [artifact: AgentArtifact];
  open: [artifact: AgentArtifact];
  revise: [];
  generate: [];
}>();
const state = ref<FsdWorkflow | null>(null);
const reviewedKey = ref('');
const renderedKey = ref('');
const renderFailedKey = ref('');
const readable = computed(() => {
  const a = state.value?.activeArtifact;
  return (
    !!a &&
    a.id === state.value?.activeRevisionId &&
    a.contentHash === state.value?.activeContentHash &&
    !!a.markdown?.trim() &&
    !/^\s*(?:```json\s*)?[\[{]/i.test(a.markdown)
  );
});
function rendered(content: string) {
  if (
    readable.value &&
    renderFailedKey.value !== workflowReviewKey(state.value) &&
    content === state.value?.activeArtifact?.markdown
  )
    renderedKey.value = workflowReviewKey(state.value);
}
onErrorCaptured(() => {
  renderFailedKey.value = workflowReviewKey(state.value);
  renderedKey.value = '';
  reviewedKey.value = '';
  error.value = '阅读视图加载失败，请刷新后重新审阅。';
  return false;
});
const reviewReady = computed(
  () =>
    readable.value &&
    !!reviewedKey.value &&
    reviewedKey.value === workflowReviewKey(state.value) &&
    renderedKey.value === reviewedKey.value,
);
const issues = computed(() => {
  const list = state.value?.activeArtifact?.spec?.issues;
  return Array.isArray(list) ? list.filter((i) => !['resolved', 'closed'].includes(i.status)) : [];
});
function openCurrent() {
  if (
    !state.value?.activeArtifact ||
    !readable.value ||
    renderedKey.value !== workflowReviewKey(state.value)
  )
    return;
  reviewedKey.value = workflowReviewKey(state.value);
  emit('open', state.value.activeArtifact);
}
const pending = ref(false),
  error = ref(''),
  rollbackId = ref('');
const labels: Record<FsdPhase, string> = {
  analysis: '需求分析',
  draft_review: '初稿审阅',
  refining: '细化完善',
  final_review: '终稿审阅',
  completed: '已完成',
};
const actions = computed(() =>
  workflowActions(state.value, pending.value || props.busy, props.readonly),
);
const chosen = computed(() => state.value?.revisions.find((r) => r.id === rollbackId.value));
let epoch = 0;
let syncedRevision = '';
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (props.base.endsWith('/work/design/fsd/v1/chat') && state.value?.activeRunId)
    refreshTimer = setTimeout(refresh, 1000);
}
onBeforeUnmount(() => {
  epoch++;
  clearTimeout(refreshTimer);
});
async function refresh() {
  clearTimeout(refreshTimer);
  const id = props.conversationId,
    current = ++epoch;
  if (!id) {
    state.value = null;
    error.value = '';
    pending.value = false;
    emit('busy', false);
    return;
  }
  pending.value = true;
  emit('busy', true);
  try {
    const result = await api<FsdWorkflow>(`${props.base}/conversations/${id}/workflow`);
    if (current === epoch) {
      state.value = result;
      const artifact = workflowArtifactToSync(result, props.revision);
      if (artifact) {
        syncedRevision = artifact.id;
        emit('artifact', artifact);
      }
      error.value = '';
    }
  } catch (cause) {
    if (current === epoch) {
      if (!props.base.endsWith('/work/design/fsd/v1/chat')) state.value = null;
      error.value = cause instanceof Error ? cause.message : '阶段状态加载失败';
    }
  } finally {
    if (current === epoch) {
      pending.value = false;
      emit('busy', false);
      scheduleRefresh();
    }
  }
}
watch(
  () => workflowReviewKey(state.value),
  () => {
    reviewedKey.value = '';
    renderedKey.value = '';
    renderFailedKey.value = '';
  },
);
watch(
  () => [props.conversationId, props.busy, props.revision],
  (values, previous) => {
    if (
      previous &&
      values[0] === previous[0] &&
      values[1] === previous[1] &&
      values[2] === syncedRevision
    )
      return;
    if (!props.busy) void refresh();
  },
  { immediate: true },
);
watch(
  () => props.conversationId,
  () => {
    state.value = null;
    reviewedKey.value = '';
    rollbackId.value = '';
  },
);
async function command(command: FsdWorkflowCommand) {
  const allowed = {
    approve_draft: actions.value.approveDraft && reviewReady.value,
    approve_final: actions.value.approveFinal && reviewReady.value,
    revise: actions.value.revise,
    rollback: actions.value.rollback,
  };
  if (!state.value || !allowed[command] || (command === 'rollback' && !chosen.value)) return;
  const current = ++epoch;
  const body = {
    command,
    expectedVersion: state.value.version,
    requestId: crypto.randomUUID(),
    revisionId: command === 'rollback' ? chosen.value!.id : state.value.activeRevisionId,
    contentHash: state.value.activeContentHash,
  };
  pending.value = true;
  emit('busy', true);
  error.value = '';
  try {
    const result = await api<FsdWorkflow>(
      `${props.base}/conversations/${props.conversationId}/workflow`,
      body,
      'POST',
    );
    if (current !== epoch) return;
    state.value = result;
    if (result.activeArtifact) {
      syncedRevision = result.activeArtifact.id;
      emit('artifact', result.activeArtifact);
    }
    if (command === 'revise') emit('revise');
    rollbackId.value = '';
  } catch (cause) {
    if (current !== epoch) return;
    const message = cause instanceof Error ? cause.message : '阶段操作失败';
    if (cause instanceof ApiError && cause.status === 409) {
      await refresh();
      error.value = message + '；请按最新状态重新审阅后操作。';
    } else error.value = message;
  } finally {
    if (current === epoch) {
      pending.value = false;
      emit('busy', false);
      scheduleRefresh();
    }
  }
}
</script>
<template>
  <section class="border-b px-4 py-3 text-sm" aria-label="FSD 阶段控制" :aria-busy="pending">
    <div class="flex flex-wrap items-center gap-2">
      <strong
        >阶段：{{ state ? labels[state.phase] : conversationId ? '正在同步' : '需求分析' }}</strong
      >
      <span v-if="state?.activeRevision" class="text-muted-foreground"
        >当前 v{{ state.activeRevision }}</span
      >
      <Button
        variant="ghost"
        size="sm"
        :disabled="pending || busy || !conversationId"
        @click="refresh"
        >刷新状态</Button
      >
    </div>
    <p v-if="error" class="assistant-notice" role="alert">{{ error }}</p>
    <div v-if="state?.activeArtifact" class="mt-2">
      <Button
        variant="outline"
        size="sm"
        :disabled="pending || busy || !readable || renderedKey !== workflowReviewKey(state)"
        @click="openCurrent"
        >审阅当前 v{{ state.activeRevision }}</Button
      >
      <span class="ml-2 text-muted-foreground"
        >未关闭问题 {{ issues.length }} 项；确认前请审阅当前版本。</span
      >
      <ul v-if="issues.length" class="mt-2 list-disc pl-5">
        <li v-for="(issue, index) in issues" :key="index">
          {{ issue.id }} {{ issue.description || issue.title || issue.question }}
        </li>
      </ul>
      <div
        v-if="readable"
        class="mt-2 max-h-64 overflow-auto rounded border p-3"
        :aria-label="'待确认版本 v' + state.activeRevision"
      >
        <p class="mb-2 font-medium">
          {{ state.phase === 'final_review' || state.phase === 'completed' ? '正式版' : '初稿' }} ·
          审批对象：v{{ state.activeRevision }} · {{ state.activeContentHash?.slice(0, 12) }}
        </p>
        <ChatMarkdown
          :key="workflowReviewKey(state)"
          :content="state.activeArtifact.markdown"
          @rendered="rendered"
        />
        <details class="mt-3 text-xs text-muted-foreground">
          <summary>技术详情（已保存 JSON）</summary>
          <pre class="whitespace-pre-wrap break-all">{{
            JSON.stringify(state.activeArtifact.spec, null, 2)
          }}</pre>
        </details>
      </div>
      <p v-else role="alert">当前版本的阅读内容缺失或版本不一致，不能确认。请刷新后重试。</p>
    </div>
    <p v-if="state?.activeRunId" class="text-muted-foreground" role="status">
      当前会话正在生成，结束后刷新状态再操作。
    </p>
    <p v-if="state?.phase === 'refining'" class="text-muted-foreground">
      初稿已确认。补充细化要求后，点击「生成终稿」；审批不会自动启动模型。
    </p>
    <p v-if="state?.phase === 'completed'" class="text-muted-foreground">
      终稿已确认。需要调整时，请先选择「提出修改」。
    </p>
    <div v-if="state" class="mt-2 flex flex-wrap items-center gap-2">
      <Button
        v-if="state.phase === 'draft_review'"
        size="sm"
        :disabled="!actions.approveDraft || !reviewReady"
        @click="command('approve_draft')"
        >确认初稿 v{{ state.activeRevision }}</Button
      >
      <Button
        v-if="state.phase === 'final_review'"
        size="sm"
        :disabled="!actions.approveFinal || !reviewReady"
        @click="command('approve_final')"
        >确认终稿 v{{ state.activeRevision }}</Button
      >
      <Button
        v-if="state.phase === 'refining'"
        size="sm"
        :disabled="pending || busy || readonly || !!state.activeRunId"
        @click="emit('generate')"
        >生成终稿</Button
      >
      <Button
        v-if="['draft_review', 'final_review', 'completed'].includes(state.phase)"
        variant="outline"
        size="sm"
        :disabled="!actions.revise"
        @click="command('revise')"
        >提出修改</Button
      >
      <label v-if="state.revisions.length" class="flex items-center gap-2"
        >回退版本
        <select
          v-model="rollbackId"
          class="rounded border bg-background p-2"
          :disabled="!actions.rollback"
        >
          <option value="">请选择已保存版本</option>
          <option v-for="r in state.revisions" :key="r.id" :value="r.id">
            v{{ r.revision }} · {{ r.kind }} · {{ r.contentHash.slice(0, 8) }}
          </option>
        </select>
      </label>
      <Button
        v-if="state.revisions.length"
        variant="outline"
        size="sm"
        :disabled="!actions.rollback || !chosen"
        @click="command('rollback')"
        >恢复所选版本</Button
      >
    </div>
    <p v-if="chosen" class="mt-2 text-muted-foreground">
      将恢复 v{{ chosen.revision }} 的内容并保存为新版本，保留全部历史；原审批将失效，需要重新审阅。
    </p>
  </section>
</template>
