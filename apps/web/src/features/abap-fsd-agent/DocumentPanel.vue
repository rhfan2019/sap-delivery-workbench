<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../../services/session';
import DocumentView from '../agent-workbench/DocumentView.vue';
import type { useAgentSession } from '../agent-workbench/useAgentSession';
import type {
  AgentArtifact,
  AgentComment,
} from '@sap-delivery-workbench/contracts/abap-fsd-agent/types';

type SessionDocument = AgentArtifact & { changes?: unknown[] };

const props = defineProps<{
  base: string;
  session: ReturnType<typeof useAgentSession>;
  canEdit: boolean;
  version: number | null; // null follows the latest version
}>();
const emit = defineEmits<{ version: [value: number | null] }>();
const run = props.session;
const shown = ref<SessionDocument | null>(null);
const loading = ref(false),
  error = ref(''),
  anchor = ref(''),
  body = ref(''),
  saving = ref(false);
const asDocument = (doc: any): SessionDocument => ({
  ...doc,
  id: 'v' + doc.version,
  revision: doc.version,
});
const latest = computed(() =>
  run.detail.value?.document ? asDocument(run.detail.value.document) : null,
);
const documents = computed<{ version: number; labels: string[] }[]>(() => run.detail.value?.documents ?? []);
const draftMarkdown = computed(() => run.drafts.value.document ?? '');
const comments = computed(() => run.comments.value as AgentComment[]);
const live = computed(() => run.busy.value && !!draftMarkdown.value);
const openComments = computed(() => comments.value.filter((c) => c.status === 'open'));

async function show() {
  error.value = '';
  if (props.version === null || props.version === latest.value?.revision) {
    shown.value = latest.value;
    return;
  }
  loading.value = true;
  try {
    shown.value = asDocument(
      await api<any>(`${props.base}/sessions/${run.sessionId.value}/documents/${props.version}`),
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(() => [props.version, latest.value?.revision], show, { immediate: true });

const viewed = computed(() =>
  live.value
    ? {
        id: 'draft',
        revision: (latest.value?.revision ?? 0) + 1,
        markdown: draftMarkdown.value,
      }
    : shown.value,
);
const isFinal = computed(() => shown.value?.labels?.includes('定稿') ?? false);

async function toggleFinal() {
  if (!shown.value || saving.value) return;
  saving.value = true;
  try {
    const labels = isFinal.value
      ? (shown.value.labels ?? []).filter((l) => l !== '定稿')
      : [...(shown.value.labels ?? []), '定稿'];
    await api(
      `${props.base}/sessions/${run.sessionId.value}/documents/${shown.value.revision}/labels`,
      { labels },
      'POST',
    );
    shown.value = { ...shown.value, labels };
    await run.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function addComment() {
  if (!shown.value || !anchor.value || !body.value.trim() || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await api(
      `${props.base}/sessions/${run.sessionId.value}/comments`,
      { anchorText: anchor.value, anchorVersion: shown.value.revision, body: body.value.trim() },
      'POST',
    );
    anchor.value = '';
    body.value = '';
    await run.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function setStatus(id: string, status: 'open' | 'resolved') {
  try {
    await api(`${props.base}/sessions/${run.sessionId.value}/comments/${id}`, { status }, 'PATCH');
    await run.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function handleComments() {
  try {
    await run.send(`请逐条处理 ${openComments.value.length} 条未解决的批注。`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <section class="work-document document-panel">
    <p v-if="!latest && !live" class="work-empty">还没有文档。在对话中描述需求，助手会编写 FSD。</p>
    <template v-else>
      <div class="work-actions">
        <label
          >查看版本<select
            :value="version ?? ''"
            :disabled="live"
            @change="
              emit(
                'version',
                ($event.target as HTMLSelectElement).value
                  ? Number(($event.target as HTMLSelectElement).value)
                  : null,
              )
            "
          >
            <option value="">最新版本{{ latest ? ' · 第 ' + latest.revision + ' 版' : '' }}</option>
            <option v-for="d in documents" :key="d.version" :value="d.version">
              第 {{ d.version }} 版{{ d.labels.length ? ' · ' + d.labels.join('、') : '' }}
            </option>
          </select></label
        >
        <button
          v-if="shown && !live"
          :disabled="!canEdit || saving"
          :aria-pressed="isFinal"
          @click="toggleFinal"
        >
          {{ isFinal ? '取消定稿' : '标为定稿' }}
        </button>
        <a
          v-if="shown && !live"
          :href="`/api${base}/sessions/${run.sessionId.value}/export?version=${shown.revision}`"
          >导出 Markdown</a
        >
      </div>
      <p v-if="live" role="status" class="work-inline-note">
        助手正在编写，本轮结束后保存为新版本。
      </p>
      <p v-if="loading" role="status">正在读取版本…</p>
      <p v-if="error" role="alert" class="work-error">{{ error }}</p>
      <div
        v-if="shown?.comparison && !live && shown.comparison.actual?.length"
        class="document-changes"
      >
        <p>本版改动章节：{{ shown.comparison.actual.map((c) => c.heading).join('、') }}</p>
        <p v-if="shown.comparison.undeclared.length" role="alert">
          未声明的修改：{{
            shown.comparison.undeclared.join('、')
          }}（助手改了但没有说明原因，请重点核对）
        </p>
        <p v-if="shown.comparison.unapplied.length">
          声明了但未改动：{{ shown.comparison.unapplied.join('、') }}
        </p>
      </div>
      <form v-if="anchor && canEdit && !live" class="comment-form" @submit.prevent="addComment">
        <blockquote>{{ anchor.slice(0, 300) }}</blockquote>
        <textarea v-model="body" rows="3" aria-label="批注内容" placeholder="写下修改意见…" />
        <div class="work-actions">
          <button class="work-primary" :disabled="saving || !body.trim()">添加批注</button
          ><button type="button" @click="anchor = ''">取消</button>
        </div>
      </form>
      <DocumentView
        v-if="viewed"
        class="document-reader"
        :artifact="viewed"
        :closable="false"
        @select="anchor = $event"
      />
      <section class="document-comments" aria-label="批注">
        <div class="work-section-heading">
          <h3>
            批注 <small>{{ openComments.length }} 条未解决</small>
          </h3>
          <button
            v-if="openComments.length"
            class="work-primary"
            :disabled="!canEdit || run.busy.value"
            @click="handleComments"
          >
            让助手处理批注
          </button>
        </div>
        <p v-if="!run.comments.value.length" class="work-muted">
          在上方文档中选中文字即可添加批注。
        </p>
        <article
          v-for="c in run.comments.value"
          :key="c.id"
          class="comment-item"
          :class="{ resolved: c.status === 'resolved' }"
        >
          <blockquote>{{ c.anchorText.slice(0, 200) }}</blockquote>
          <p>
            <strong>{{ c.authorName }}</strong> · 第 {{ c.anchorVersion }} 版：{{ c.body }}
          </p>
          <p v-for="(r, i) in c.replies" :key="i" class="comment-reply">助手：{{ r.body }}</p>
          <button
            :disabled="!canEdit"
            @click="setStatus(c.id, c.status === 'open' ? 'resolved' : 'open')"
          >
            {{ c.status === 'open' ? '标记已解决' : '重新打开' }}
          </button>
        </article>
      </section>
    </template>
  </section>
</template>
<style scoped>
.document-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.document-reader {
  min-height: 420px;
  max-height: 70vh;
  border: 1px solid #e8edf2;
  border-radius: 8px;
}
.document-changes {
  font-size: 13px;
  color: #475569;
}
.document-changes [role='alert'] {
  color: #b45309;
}
.comment-form,
.comment-item {
  border: 1px solid #e8edf2;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
.comment-form textarea {
  width: 100%;
}
blockquote {
  margin: 0 0 6px;
  padding-left: 8px;
  border-left: 3px solid #cbd5e1;
  color: #64748b;
}
.comment-item.resolved {
  opacity: 0.6;
}
.comment-reply {
  color: #0f766e;
}
</style>
