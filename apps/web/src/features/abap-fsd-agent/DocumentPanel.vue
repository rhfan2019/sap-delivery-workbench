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

function addComment(anchorText: string, body: string) {
  if (shown.value) run.quote(`功能说明书第 ${shown.value.revision} 版`, anchorText, body);
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
      <p v-if="live" role="status" class="work-inline-note">
        助手正在编写，本轮结束后保存为新版本。
      </p>
      <p v-if="loading" role="status" class="work-inline-note">正在读取版本…</p>
      <p v-if="error" role="alert" class="work-error">{{ error }}</p>
      <p v-if="!live && shown?.comparison?.undeclared.length" role="alert" class="document-alert">
        未声明的修改：{{
          shown.comparison.undeclared.join('、')
        }}（助手改了但没有说明原因，请重点核对）
      </p>
      <SelectionComment ref="selection" :disabled="!canEdit || live || !shown" :save="addComment">
        <DocumentView
          v-if="viewed"
          class="document-reader"
          :artifact="viewed"
          :closable="false"
          embedded
          @select="selection?.offer($event)"
        >
          <!-- One toolbar row: version, what changed, final, export (the outline toggle is first). -->
          <template #actions>
            <select
              class="document-version"
              aria-label="查看版本"
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
              <option value="">最新 · 第 {{ latest?.revision ?? 1 }} 版</option>
              <option v-for="d in documents" :key="d.version" :value="d.version">
                第 {{ d.version }} 版{{ d.labels.length ? ' · ' + d.labels.join('、') : '' }}
              </option>
            </select>
            <details
              v-if="shown?.comparison && !live && shown.comparison.actual?.length"
              class="document-changes"
            >
              <summary>改动 {{ shown.comparison.actual.length }} 章</summary>
              <div class="document-changes-list">
                <p>{{ shown.comparison.actual.map((c) => c.heading).join('、') }}</p>
                <p v-if="shown.comparison.unapplied.length">
                  声明了但未改动：{{ shown.comparison.unapplied.join('、') }}
                </p>
              </div>
            </details>
            <button
              v-if="shown && !live"
              class="document-final"
              :disabled="!canEdit || saving"
              :aria-pressed="isFinal"
              @click="toggleFinal"
            >
              {{ isFinal ? '取消定稿' : '标为定稿' }}
            </button>
            <a
              v-if="shown && !live"
              :href="`/api${base}/sessions/${run.sessionId.value}/export?version=${shown.revision}`"
              >导出</a
            >
          </template>
        </DocumentView>
      </SelectionComment>
      <section v-if="comments.length" class="document-comments" aria-label="批注">
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
  gap: var(--space-2);
}
.document-version {
  min-height: 28px;
  max-width: 180px;
  padding: 0 var(--space-2);
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  font-size: var(--font-size-xs);
}
.document-final {
  margin-left: auto;
  min-height: 28px;
  padding: 0 var(--space-2);
  font-size: var(--font-size-xs);
}
.document-changes {
  position: relative;
  color: var(--muted);
}
.document-changes summary {
  cursor: pointer;
  white-space: nowrap;
}
.document-changes-list {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 5;
  width: min(360px, 70vw);
  max-height: 240px;
  overflow: auto;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-popover);
  font-size: var(--font-size-xs);
}
.document-alert {
  color: var(--warning-text);
  font-size: var(--font-size-xs);
}
.document-panel > :not(.document-reader) {
  flex-shrink: 0;
}
.document-reader {
  flex: 1;
  min-height: 240px;
}
.document-comments {
  max-height: 30%;
  overflow: auto;
  padding-bottom: var(--space-3);
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
