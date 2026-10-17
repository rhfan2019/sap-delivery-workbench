<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../../services/session';
import DocumentView from '../agent-workbench/DocumentView.vue';
import SelectionComment from '../agent-workbench/SelectionComment.vue';
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
  saving = ref(false);
const selection = ref<InstanceType<typeof SelectionComment> | null>(null);
const asDocument = (doc: any): SessionDocument => ({
  ...doc,
  id: 'v' + doc.version,
  revision: doc.version,
});
const latest = computed(() =>
  run.detail.value?.document ? asDocument(run.detail.value.document) : null,
);
const documents = computed<{ version: number; labels: string[] }[]>(
  () => run.detail.value?.documents ?? [],
);
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

// Errors stay in the comment box, which remains open for another try.
async function addComment(anchorText: string, body: string) {
  if (!shown.value) return;
  await api(
    `${props.base}/sessions/${run.sessionId.value}/comments`,
    { anchorText, anchorVersion: shown.value.revision, body },
    'POST',
  );
  await run.refresh();
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
        <details>
          <summary>本版改动 {{ shown.comparison.actual.length }} 个章节</summary>
          <p>{{ shown.comparison.actual.map((c) => c.heading).join('、') }}</p>
        </details>
        <p v-if="shown.comparison.undeclared.length" role="alert">
          未声明的修改：{{
            shown.comparison.undeclared.join('、')
          }}（助手改了但没有说明原因，请重点核对）
        </p>
        <p v-if="shown.comparison.unapplied.length">
          声明了但未改动：{{ shown.comparison.unapplied.join('、') }}
        </p>
      </div>
      <SelectionComment ref="selection" :disabled="!canEdit || live || !shown" :save="addComment">
        <DocumentView
          v-if="viewed"
          class="document-reader"
          :artifact="viewed"
          :closable="false"
          @select="selection?.offer($event)"
        />
      </SelectionComment>
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
          在文档中选中文字，点旁边的“批注”即可添加。
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
/* The panel fills the side panel; only the document scrolls (one scroll bar). */
.document-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2-5);
}
.document-panel > :not(.document-reader) {
  flex-shrink: 0;
}
.document-reader {
  flex: 1;
  min-height: 240px;
  border: 1px solid var(--active);
  border-radius: var(--radius-md);
}
.document-changes summary {
  cursor: pointer;
}
.document-comments {
  max-height: 30%;
  overflow: auto;
  padding-bottom: var(--space-3);
}
.document-changes {
  font-size: var(--font-size-sm);
  color: var(--muted);
}
.document-changes [role='alert'] {
  color: var(--warning-text);
}
.comment-item {
  border: 1px solid var(--active);
  border-radius: var(--radius-md);
  padding: var(--space-2-5) var(--space-3);
  font-size: var(--font-size-sm);
}
blockquote {
  margin: 0 0 var(--space-1-5);
  padding-left: var(--space-2);
  border-left: 3px solid var(--border-strong);
  color: var(--muted);
}
.comment-item.resolved {
  opacity: 0.6;
}
.comment-reply {
  color: var(--success-text);
}
</style>
