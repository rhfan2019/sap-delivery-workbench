<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../../services/session';
import DocumentView from '../agent-workbench/DocumentView.vue';
import SelectionComment from '../agent-workbench/SelectionComment.vue';
import type { useAgentSession } from '../agent-workbench/useAgentSession';
import CodeView from './CodeView.vue';
import type {
  DevComment,
  DevDiff,
  DevTarget,
  DevVersion,
  DevVersionSummary,
} from '@sap-delivery-workbench/contracts/abap-dev-agent/types';

// What the development agent produced: the plan and the code of one version, the
// differences to an earlier version, what it was built on, and the comments.
const props = defineProps<{
  base: string;
  session: ReturnType<typeof useAgentSession>;
  canEdit: boolean;
  version: number | null; // null follows the latest version
}>();
const emit = defineEmits<{ version: [value: number | null] }>();
const run = props.session;

const SOURCE: Record<string, string> = {
  assistant: '助手生成',
  upload: '开发顾问上传',
  sap: 'SAP 同步',
};
const VIEWS: { id: string; label: string }[] = [
  { id: 'code', label: '代码' },
  { id: 'plan', label: '开发方案' },
];
const tab = ref('code');
const shown = ref<DevVersion | null>(null);
const loading = ref(false),
  error = ref(''),
  saving = ref(false);
const selection = ref<InstanceType<typeof SelectionComment> | null>(null);

const latest = computed<DevVersion | null>(() => run.detail.value?.version ?? null);
const versions = computed<DevVersionSummary[]>(() => run.detail.value?.versions ?? []);
const comments = computed(() => run.comments.value as DevComment[]);
const openComments = computed(() => comments.value.filter((c) => c.status === 'open'));
const live = computed(() => run.busy.value && !!(run.drafts.value.plan || run.drafts.value.code));
const viewedPlan = computed(() =>
  live.value && run.drafts.value.plan !== undefined ? run.drafts.value.plan : shown.value?.plan,
);
const viewedCode = computed(() =>
  live.value && run.drafts.value.code !== undefined ? run.drafts.value.code : shown.value?.code,
);
const isFinal = computed(() => shown.value?.labels?.includes('定稿') ?? false);
const sessionUrl = computed(() => `${props.base}/sessions/${run.sessionId.value}`);

async function show() {
  error.value = '';
  if (props.version === null || props.version === latest.value?.version) {
    shown.value = latest.value;
    return;
  }
  loading.value = true;
  try {
    shown.value = await api<DevVersion>(`${sessionUrl.value}/versions/${props.version}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(() => [props.version, latest.value?.version], show, { immediate: true });

// Differences of the shown version against an earlier one (the previous by default).
const diffTarget = ref<DevTarget>('code'),
  diffFrom = ref<number | ''>(''),
  diff = ref<DevDiff | null>(null);
watch(
  () => shown.value?.version,
  (v) => {
    diffFrom.value = v && v > 1 ? v - 1 : '';
    diff.value = null;
  },
  { immediate: true },
);
async function loadDiff() {
  if (!shown.value) return;
  try {
    const from = diffFrom.value ? `&from=${diffFrom.value}` : '';
    diff.value = await api<DevDiff>(
      `${sessionUrl.value}/diff?target=${diffTarget.value}&to=${shown.value.version}${from}`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch([tab, diffTarget, diffFrom, () => shown.value?.version], () => {
  if (tab.value === 'diff') void loadDiff();
});

async function toggleFinal() {
  if (!shown.value || saving.value) return;
  saving.value = true;
  try {
    const labels = isFinal.value
      ? shown.value.labels.filter((l) => l !== '定稿')
      : [...shown.value.labels, '定稿'];
    await api(`${sessionUrl.value}/versions/${shown.value.version}/labels`, { labels }, 'POST');
    shown.value = { ...shown.value, labels };
    await run.refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

// Errors stay in the comment box, which remains open for another try.
async function addComment(anchorText: string, body: string, context: unknown) {
  if (!shown.value) return;
  const at = context as { target: DevTarget; line: number | null };
  await api(
    `${sessionUrl.value}/comments`,
    {
      target: at.target,
      anchorText,
      anchorVersion: shown.value.version,
      anchorLine: at.line,
      body,
    },
    'POST',
  );
  await run.refresh();
}

async function setStatus(id: string, status: 'open' | 'resolved') {
  try {
    await api(`${sessionUrl.value}/comments/${id}`, { status }, 'PATCH');
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

function warnings(v: DevVersion) {
  const c = v.comparison ?? {};
  return [...(c.plan?.undeclared ?? []), ...(c.code?.undeclared ? ['代码'] : [])];
}
const label = (v: { version: number; source: string; labels: string[] }) =>
  `第 ${v.version} 版 · ${SOURCE[v.source] ?? v.source}${v.labels.length ? ' · ' + v.labels.join('、') : ''}`;
</script>
<template>
  <section class="work-document dev-panel">
    <p v-if="!latest && !live" class="work-empty">
      还没有开发方案和代码。在对话中描述需求或上传 FSD，助手会写出开发方案和代码。
    </p>
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
            <option value="">最新版本{{ latest ? ' · ' + label(latest) : '' }}</option>
            <option v-for="v in versions" :key="v.version" :value="v.version">
              {{ label(v) }}
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
          v-if="shown?.code && !live"
          :href="`/api${sessionUrl}/export?target=code&version=${shown.version}`"
          >导出代码</a
        >
        <a
          v-if="shown?.plan && !live"
          :href="`/api${sessionUrl}/export?target=plan&version=${shown.version}`"
          >导出开发方案</a
        >
      </div>
      <p v-if="live" role="status" class="work-inline-note">
        助手正在编写，本轮结束后保存为新版本。
      </p>
      <p v-if="shown?.source !== 'assistant' && shown && !live" class="work-inline-note">
        本版来源：{{ SOURCE[shown.source]
        }}{{ shown.sourceRef ? '（' + shown.sourceRef + '）' : '' }}
      </p>
      <p v-if="loading" role="status">正在读取版本…</p>
      <p v-if="error" role="alert" class="work-error">{{ error }}</p>
      <p v-if="shown && !live && warnings(shown).length" role="alert" class="dev-warning">
        未声明的修改：{{ warnings(shown).join('、') }}（助手改了但没有说明原因，请重点核对）
      </p>
      <!-- Code and plan are the two views; comparing versions and the basis are tools on them. -->
      <nav class="dev-tabs" aria-label="成果内容">
        <button v-for="t in VIEWS" :key="t.id" :aria-pressed="tab === t.id" @click="tab = t.id">
          {{ t.label }}
        </button>
        <span class="dev-tools">
          <button
            v-if="shown && !live"
            :aria-pressed="tab === 'diff'"
            @click="tab = tab === 'diff' ? 'code' : 'diff'"
          >
            与上一版比较
          </button>
          <button
            v-if="shown && !live"
            :aria-pressed="tab === 'basis'"
            @click="tab = tab === 'basis' ? 'code' : 'basis'"
          >
            查看依据
          </button>
        </span>
      </nav>
      <div class="dev-content">
        <SelectionComment ref="selection" :disabled="!canEdit || live || !shown" :save="addComment">
          <template v-if="tab === 'code'">
            <p v-if="!viewedCode" class="work-muted">这一版还没有代码。</p>
            <CodeView
              v-else
              :code="viewedCode"
              :title="`ABAP · ${viewedCode.split('\n').length} 行`"
              @select="(text, line) => selection?.offer(text, { target: 'code', line })"
            />
          </template>
          <template v-if="tab === 'plan'">
            <p v-if="!viewedPlan" class="work-muted">这一版还没有开发方案。</p>
            <DocumentView
              v-else
              class="dev-reader"
              :artifact="{ id: 'plan', revision: shown?.version ?? 0, markdown: viewedPlan }"
              :closable="false"
              @select="selection?.offer($event, { target: 'plan', line: null })"
            />
          </template>
        </SelectionComment>
        <section v-if="tab === 'diff' && shown" class="dev-diff" aria-label="版本差异">
          <div class="work-actions">
            <label
              >内容<select v-model="diffTarget">
                <option value="code">代码</option>
                <option value="plan">开发方案</option>
              </select></label
            >
            <label
              >对比<select v-model="diffFrom">
                <option value="">空白</option>
                <option
                  v-for="v in versions.filter((x) => x.version < shown!.version)"
                  :key="v.version"
                  :value="v.version"
                >
                  {{ label(v) }}
                </option>
              </select></label
            >
          </div>
          <p v-if="diff && !diff.added && !diff.removed" class="work-muted">两个版本相同。</p>
          <p v-else-if="diff" class="work-muted">
            新增 {{ diff.added }} 行，删除 {{ diff.removed }} 行。
          </p>
          <div v-for="(h, i) in diff?.hunks ?? []" :key="i" class="dev-hunk">
            <p>新版第 {{ h.newStart }} 行附近</p>
            <pre><span v-for="(l, k) in h.lines" :key="k" :data-change="l[0]">{{ l }}
</span></pre>
          </div>
        </section>
        <section v-if="tab === 'basis' && shown" class="dev-basis" aria-label="版本依据">
          <p class="work-muted">第 {{ shown.version }} 版依据的资料：</p>
          <ul>
            <li v-for="b in shown.basis" :key="b.key">{{ b.label }}</li>
          </ul>
        </section>
      </div>
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
        <p v-if="!comments.length" class="work-muted">
          在代码或开发方案中选中文字，点旁边的“批注”即可添加。
        </p>
        <article
          v-for="c in comments"
          :key="c.id"
          class="comment-item"
          :class="{ resolved: c.status === 'resolved', stale: c.status === 'stale' }"
        >
          <blockquote>
            {{
              c.target === 'code'
                ? `代码${c.anchorLine ? '第 ' + c.anchorLine + ' 行' : ''}：`
                : '开发方案：'
            }}{{ c.anchorText.slice(0, 200) }}
          </blockquote>
          <p>
            <strong>{{ c.authorName }}</strong> · 第 {{ c.anchorVersion }} 版：{{ c.body }}
          </p>
          <p v-if="c.status === 'stale'" class="dev-warning">
            原文在新版本中已不存在，请确认是否已处理，或关闭后重新批注。
          </p>
          <p v-for="(r, i) in c.replies" :key="i" class="comment-reply">助手：{{ r.body }}</p>
          <button
            :disabled="!canEdit"
            @click="setStatus(c.id, c.status === 'resolved' ? 'open' : 'resolved')"
          >
            {{
              c.status === 'resolved' ? '重新打开' : c.status === 'stale' ? '关闭' : '标记已解决'
            }}
          </button>
        </article>
      </section>
    </template>
  </section>
</template>
<style scoped>
/* The panel fills the side panel; only the content scrolls (one scroll bar). */
.dev-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dev-panel > :not(.dev-content) {
  flex-shrink: 0;
}
.dev-content {
  flex: 1;
  min-height: 240px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.document-comments {
  max-height: 30%;
  overflow: auto;
  padding-bottom: 12px;
}
.dev-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e8edf2;
}
.dev-tabs button {
  padding: 6px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
}
.dev-tabs button[aria-pressed='true'] {
  border-bottom-color: currentColor;
  font-weight: 600;
}
.dev-tools {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.dev-tools button {
  font-size: 13px;
}
.dev-reader {
  flex: 1;
  min-height: 0;
  border: 1px solid #e8edf2;
  border-radius: 8px;
}
.dev-warning {
  color: #b45309;
  font-size: 13px;
}
.dev-hunk p {
  margin: 8px 0 4px;
  font-size: 12px;
  color: #64748b;
}
.dev-hunk pre {
  margin: 0;
  padding: 8px;
  overflow-x: auto;
  border: 1px solid #e8edf2;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}
.dev-hunk span[data-change='+'] {
  background: #ecfdf5;
  color: #047857;
}
.dev-hunk span[data-change='-'] {
  background: #fef2f2;
  color: #b91c1c;
}
.dev-basis ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
.comment-item {
  border: 1px solid #e8edf2;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
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
