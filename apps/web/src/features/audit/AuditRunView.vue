<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../../components/AppIcon.vue';
import { ApiError } from '../../services/session';
import { askConfirmation } from '../../services/confirmation';
import { auditApi, type RunDetail } from './api';
import {
  formatDuration,
  formatTokens,
  gapLevel,
  statusLabel,
  statusTone,
  stopReasonLabel,
  toolLabel,
} from './audit.mjs';
import './audit.css';

const route = useRoute(),
  router = useRouter();
const data = ref<RunDetail | null>(null),
  loading = ref(false),
  error = ref(''),
  notice = ref(''),
  draft = ref(''),
  saving = ref(false),
  failuresOnly = ref(false),
  expanded = ref<Record<number, boolean>>({});
const id = computed(() => String(route.params.id));
async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await auditApi.run(id.value);
    expanded.value = {};
  } catch (e) {
    data.value = null;
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 401) await router.replace('/login');
  } finally {
    loading.value = false;
  }
}
watch(
  () => route.fullPath,
  () => {
    if (route.path.startsWith('/workspace/audit/runs/')) void load();
  },
  { immediate: true },
);
const calls = computed(() =>
  (data.value?.toolCalls ?? [])
    .map((c, index) => ({ ...c, index }))
    .filter((c) => !failuresOnly.value || c.status !== 'ok'),
);
const longGaps = computed(
  () => (data.value?.toolCalls ?? []).filter((c) => gapLevel(c.gap_ms) !== 'none').length,
);
const userInput = computed(() => data.value?.messages.find((m) => m.role === 'user'));
const replies = computed(() =>
  (data.value?.messages ?? []).filter((m) => m.role === 'assistant' && m.content.trim()),
);
const questions = computed(
  () => data.value?.messages.find((m) => m.payload?.questions)?.payload.questions ?? [],
);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
const clock = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
const args = (a: Record<string, unknown>) => {
  const text = JSON.stringify(a);
  return text.length > 160 ? text.slice(0, 160) + '…' : text;
};

async function addComment() {
  if (!draft.value.trim() || saving.value || !data.value) return;
  saving.value = true;
  try {
    data.value.comments = await auditApi.comment(id.value, draft.value.trim());
    draft.value = '';
    notice.value = '评论已保存';
    setTimeout(() => (notice.value = ''), 1500);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function removeComment(commentId: string) {
  if (!data.value || !(await askConfirmation('删除这条评论？'))) return;
  try {
    await auditApi.removeComment(commentId);
    data.value.comments = data.value.comments.filter((c) => c.id !== commentId);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notice.value = '已复制';
  } catch {
    notice.value = '复制失败，请手动选择文本复制。';
  }
  setTimeout(() => (notice.value = ''), 1500);
}
</script>
<template>
  <div class="admin-page audit-page">
    <RouterLink class="back-link" to="/workspace/audit"
      ><AppIcon name="back" :size="16" />返回审计日志</RouterLink
    >
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <p v-if="loading && !data" class="loading-state" role="status">正在读取运行详情…</p>
    <template v-if="data">
      <div class="page-heading">
        <div>
          <h1 class="mono audit-title">
            {{ data.run.id }}
            <button
              class="icon-button"
              title="复制编号"
              aria-label="复制编号"
              @click="copy(data.run.id)"
            >
              <AppIcon name="files" :size="15" />
            </button>
          </h1>
          <p class="muted">
            {{ data.run.project.code }} {{ data.run.project.name }} / {{ data.run.item.code }}
            {{ data.run.item.name }} · {{ data.run.user_name }} · {{ data.run.model ?? '—' }} ·
            {{ when(data.run.started_at) }}
          </p>
        </div>
        <div class="toolbar-actions">
          <RouterLink
            class="secondary-button"
            :to="'/workspace/audit/sessions/' + data.run.session_id"
            >会话逐轮趋势</RouterLink
          >
          <button class="secondary-button" :disabled="loading" @click="load">
            <AppIcon name="refresh" :size="16" />刷新
          </button>
        </div>
      </div>
      <p v-if="notice" class="success-note" role="status">{{ notice }}</p>

      <section
        class="surface audit-section audit-conclusion"
        :class="data.run.error_message ? 'danger' : statusTone(data.run.status)"
      >
        <h2>
          结论 ·
          <span class="audit-status" :class="statusTone(data.run.status)">{{
            statusLabel(data.run.status)
          }}</span>
          · {{ stopReasonLabel(data.run.stop_reason) }}
        </h2>
        <p v-if="data.run.error_message">
          <strong class="mono">{{ data.run.error_code }}</strong> {{ data.run.error_message }}
        </p>
        <dl class="audit-ids">
          <dt>耗时</dt>
          <dd>{{ formatDuration(data.run.duration_ms) }}</dd>
          <dt>模型调用 / 工具调用</dt>
          <dd>
            {{ data.run.model_calls }} / {{ data.run.tool_calls }}（失败
            {{ data.run.tool_failures }}）
          </dd>
          <dt>Token</dt>
          <dd>
            输入 {{ formatTokens(data.run.prompt_tokens) }} · 输出
            {{ formatTokens(data.run.completion_tokens) }}
          </dd>
          <dt>会话</dt>
          <dd class="mono">{{ data.run.session_id }}</dd>
        </dl>
      </section>

      <section class="surface audit-section">
        <h2>
          评论 <span class="count-badge">{{ data.comments.length }}</span>
        </h2>
        <p class="muted audit-note">
          写下你对这一轮的观察：问题问得好不好、查询是否发散、哪里写错了。分析审计日志时会一并读取。
        </p>
        <article v-for="c in data.comments" :key="c.id" class="audit-comment">
          <p>
            <strong>{{ c.author }}</strong>
            <span class="muted"> · {{ when(c.created_at) }}</span>
            <button v-if="c.mine" class="text-button" @click="removeComment(c.id)">删除</button>
          </p>
          <p class="audit-comment-body">{{ c.body }}</p>
        </article>
        <form class="audit-comment-form" @submit.prevent="addComment">
          <textarea v-model="draft" rows="3" aria-label="评论内容" placeholder="写下评论…" />
          <button class="primary-button" :disabled="saving || !draft.trim()">保存评论</button>
        </form>
      </section>

      <section class="surface audit-section">
        <h2>本轮对话</h2>
        <template v-if="userInput">
          <h3>用户输入</h3>
          <pre class="audit-excerpt">{{ userInput.content }}</pre>
        </template>
        <template v-if="replies.length">
          <h3>助手回复</h3>
          <pre v-for="m in replies" :key="m.seq" class="audit-excerpt">{{ m.content }}</pre>
        </template>
        <template v-if="questions.length">
          <h3>提出的问题（{{ questions.length }}）</h3>
          <ol>
            <li v-for="(q, i) in questions" :key="i">
              <strong>{{ q.question }}</strong>
              <span class="muted">（推荐：{{ q.recommended }}）</span>
              <p class="muted">{{ q.why_customer }}</p>
            </li>
          </ol>
        </template>
      </section>

      <section v-if="data.document" class="surface audit-section">
        <h2>产出文档 · 第 {{ data.document.version }} 版（{{ data.document.length }} 字符）</h2>
        <p v-if="data.document.comparison.actual?.length" class="muted">
          改动章节：{{ data.document.comparison.actual.map((c) => c.heading).join('、') }}
        </p>
        <p v-if="data.document.comparison.undeclared?.length" class="audit-danger">
          未声明修改：{{ data.document.comparison.undeclared.join('、') }}
        </p>
      </section>

      <section class="surface audit-section">
        <h2>
          工具调用 <span class="count-badge">{{ data.toolCalls.length }}</span>
          <span v-if="longGaps" class="audit-status warn">长思考间隔 {{ longGaps }}</span>
        </h2>
        <label class="audit-check"
          ><input v-model="failuresOnly" type="checkbox" />只看失败的调用</label
        >
        <ol class="audit-timeline">
          <li v-for="c in calls" :key="c.index" :class="'gap-' + gapLevel(c.gap_ms)">
            <span v-if="gapLevel(c.gap_ms) !== 'none'" class="audit-gap"
              >模型思考 {{ formatDuration(c.gap_ms) }}</span
            >
            <span class="date-cell">{{ clock(c.created_at) }}</span>
            <strong>{{ toolLabel(c.name) }}</strong>
            <span class="audit-status" :class="c.status === 'ok' ? 'ok' : 'danger'">{{
              c.status === 'ok' ? '成功' : c.status === 'denied' ? '拒绝' : '失败'
            }}</span>
            <span class="muted num">{{ formatDuration(c.duration_ms) }}</span>
            <span class="mono muted audit-data">{{ args(c.arguments) }}</span>
            <button class="text-button" @click="expanded[c.index] = !expanded[c.index]">
              {{ expanded[c.index] ? '收起' : '参数与结果' }}
            </button>
            <pre v-if="expanded[c.index]" class="audit-excerpt">{{
              JSON.stringify(c.arguments, null, 2) + '\n\n' + c.result
            }}</pre>
          </li>
        </ol>
        <p v-if="!calls.length" class="muted">没有{{ failuresOnly ? '失败的' : '' }}工具调用。</p>
      </section>
    </template>
  </div>
</template>
<style scoped>
.audit-comment {
  border-top: 1px solid var(--blue-fill-1);
  padding: var(--space-2) 0;
}
.audit-comment-body {
  white-space: pre-wrap;
}
.audit-comment-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}
.audit-comment-form textarea {
  width: 100%;
}
</style>
