<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api, identity } from '../../services/session';
import { askConfirmation } from '../../services/confirmation';
import AgentWorkbench from '../fs-assistant-test/AgentWorkbench.vue';
import GemFsdV2 from './GemFsdV2.vue';
import ChatMarkdown from '../fs-assistant-test/ChatMarkdown.vue';
import StructuredEditor from './StructuredEditor.vue';
import fsdSchema from '@sap-delivery-workbench/contracts/agent-runtime/fsd/v1/r.schema.json';
import type {
  AgentArtifact,
  AgentSelection,
} from '@sap-delivery-workbench/contracts/agent-runtime/types';
import {
  ArrowLeft,
  MoreHorizontal,
  Plus,
  X,
  PanelRight,
  FileText,
  FolderOpen,
  MessageSquare,
  Info,
  Maximize2,
} from '@lucide/vue';
import { useMediaQuery } from '@vueuse/core';
import './workspace.css';
const props = defineProps<{ projectId: string; itemId: string; stage: string }>();
const useV2 = ref(false);
const stage = props.stage === 'development' ? 'development' : 'design';
const base = `/projects/${props.projectId}/development-items/${props.itemId}/work/${stage}`;
const state = ref<any>(null),
  draft = ref<any>(null),
  historical = ref<any>(null),
  versionLoading = ref(false);
const error = ref(''),
  notice = ref(''),
  busy = ref(false),
  agentBusy = ref(false),
  loading = ref(true);
const pane = ref(''),
  preview = ref(true),
  versionId = ref(''),
  basisId = ref('');
const sessions = ref<any[]>([]),
  sessionId = ref(''),
  agentKey = ref(0);
const sessionKey = `item-work-session:${identity.value?.organization.id}:${identity.value?.user.id}:${props.projectId}:${props.itemId}:${stage}`;
watch(sessionId, (id) => {
  try {
    localStorage.setItem(sessionKey, id);
  } catch {}
});
const initialSession = computed(() => sessions.value.find((s) => s.id === sessionId.value));
const dirty = computed(
  () =>
    !!draft.value &&
    (JSON.stringify(draft.value) !== JSON.stringify(state.value?.head?.document) ||
      basisId.value !== (state.value?.head?.designVersionId ?? '')),
);
const writable = computed(
  () => !!state.value?.canEdit && !historical.value && !busy.value && !versionLoading.value,
);
const selection = computed<AgentSelection>(() => ({
  projectId: props.projectId,
  itemId: props.itemId,
  itemRowVersion: state.value?.item.rowVersion,
  workspaceStage: stage,
}));
const controller = new AbortController();
let epoch = 0;
function adopt(s: any) {
  state.value = s;
  draft.value = structuredClone(s.head?.document ?? null);
  basisId.value = s.head?.designVersionId ?? '';
  historical.value = null;
  versionId.value = '';
}
async function refreshSessions() {
  if (controller.signal.aborted) return;
  const r = await api<any>(base + '/sessions', undefined, undefined, { signal: controller.signal });
  if (!controller.signal.aborted) sessions.value = r.items;
}
async function load() {
  const token = ++epoch;
  loading.value = true;
  error.value = '';
  try {
    let s = await api<any>(base, undefined, undefined, { signal: controller.signal });
    if (s.canEdit && !s.head) s = await api<any>(base, {}, 'POST', { signal: controller.signal });
    if (controller.signal.aborted || token !== epoch) return;
    adopt(s);
    await refreshSessions();
    if (controller.signal.aborted || token !== epoch) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(sessionKey);
    } catch {}
    sessionId.value =
      remembered === '' || sessions.value.some((s) => s.id === remembered)
        ? (remembered ?? '')
        : (sessions.value[0]?.id ?? '');
    agentKey.value++;
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    if (token === epoch) loading.value = false;
  }
}
async function reload() {
  if (!dirty.value || (await askConfirmation('放弃尚未保存的修改并读取最新工作稿？'))) await load();
}
async function resetAssistant() {
  if (busy.value || !state.value?.canEdit) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await api<{ cleanupPending: number }>(base + '/agent/reset', {}, 'POST');
    for (const part of ['design', 'development']) {
      const suffix = `${identity.value?.organization.id}:${identity.value?.user.id}:${props.projectId}:${props.itemId}:${part}`;
      localStorage.removeItem('item-work-session:' + suffix);
      localStorage.removeItem('fs-assistant-run:' + suffix);
    }
    localStorage.setItem(
      'item-work-reset:' + props.projectId + ':' + props.itemId,
      String(Date.now()),
    );
    sessionId.value = '';
    sessions.value = [];
    candidate.value = null;
    pane.value = '';
    agentBusy.value = false;
    agentKey.value++;
    await load();
    notice.value = '已重置：设计与开发的全部对话、附件、工作稿及成果已清空。';
    if (result.cleanupPending)
      notice.value +=
        '有 ' +
        result.cleanupPending +
        ' 个存储文件清理失败，已记录服务端日志，原内容已不可通过平台访问。';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function receiveReset(e: StorageEvent) {
  if (e.key === 'item-work-reset:' + props.projectId + ':' + props.itemId) {
    agentKey.value++;
    candidate.value = null;
    sessionId.value = '';
    void load();
  }
}
onMounted(() => window.addEventListener('storage', receiveReset));
onBeforeUnmount(() => window.removeEventListener('storage', receiveReset));
async function save(document = draft.value) {
  if (!writable.value || agentBusy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const s = await api<any>(
      base,
      {
        baseVersionId: state.value.head.id,
        document,
        ...(stage === 'development' ? { designVersionId: basisId.value || null } : {}),
      },
      'PATCH',
    );
    if (!controller.signal.aborted) {
      adopt(s);
      notice.value = '工作稿已保存为新版本';
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function chooseVersion() {
  const token = ++epoch;
  if (!versionId.value) {
    historical.value = null;
    versionLoading.value = false;
    return;
  }
  versionLoading.value = true;
  error.value = '';
  try {
    const r = await api<any>(base + '/versions/' + versionId.value);
    if (!controller.signal.aborted && token === epoch) historical.value = r;
  } catch (e) {
    if (token === epoch) {
      versionId.value = '';
      historical.value = null;
      error.value = (e as Error).message;
    }
  } finally {
    if (token === epoch) versionLoading.value = false;
  }
}
async function restoreVersion() {
  if (
    !historical.value ||
    !(await askConfirmation('将此历史内容保存为新的当前版本？历史版本将保留。'))
  )
    return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const s = await api<any>(base + '/restore', {
      versionId: historical.value.id,
      baseVersionId: state.value.head.id,
    });
    if (!controller.signal.aborted) {
      adopt(s);
      notice.value = '工作稿已保存为新版本，原设计依据同步恢复';
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function adoptArtifact(a: AgentArtifact) {
  if (dirty.value || busy.value || !state.value.canEdit) return;
  if (!(await askConfirmation('将这份 AI 候选采用为新的当前工作稿？原版本保留。'))) return;
  busy.value = true;
  error.value = '';
  try {
    const s = await api<any>(base + '/adopt', {
      artifactId: a.id,
      baseVersionId: state.value.head.id,
    });
    if (!controller.signal.aborted) {
      adopt(s);
      pane.value = 'document';
      candidate.value = null;
      preview.value = true;
      notice.value = 'AI 候选已采用，可继续人工编辑';
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function sessionChanged(id: string) {
  if (!id || controller.signal.aborted) return;
  try {
    await refreshSessions();
    if (!controller.signal.aborted) {
      sessionId.value = id;
      if (pane.value === 'files') await refreshFiles();
    }
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  }
}
async function safeLeave() {
  if (busy.value || agentBusy.value) return false;
  return !dirty.value || (await askConfirmation('工作稿尚未保存，确认离开并放弃本地修改？'));
}
onBeforeRouteLeave(safeLeave);
onBeforeRouteUpdate(safeLeave);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
  void load();
});
onBeforeUnmount(() => {
  epoch++;
  controller.abort();
  window.removeEventListener('beforeunload', beforeUnload);
});

const compact = useMediaQuery('(max-width: 800px)');
const panelWidth = ref(400),
  shell = ref<HTMLElement | null>(null);
const candidate = ref<AgentArtifact | null>(null),
  showNew = ref(false),
  carrySummary = ref(false);
const files = ref<any>({ inputs: [], outputs: [] }),
  filePreview = ref<any>(null),
  filesLoading = ref(false);
let filesEpoch = 0;
const panels = [
  { id: 'info', label: '开发项', icon: Info },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'document', label: '成果', icon: FileText },
  { id: 'sessions', label: '对话', icon: MessageSquare },
];
const currentTitle = computed(
  () =>
    `${state.value?.item.name || '开发项'} · ${stage === 'development' ? '开发助手' : '设计助手'}`,
);
function openPanel(id: string) {
  if (pane.value !== id) panelWidth.value = id === 'document' ? 620 : 400;
  pane.value = id;
  if (id === 'files') void refreshFiles();
}
function openCandidate(a: AgentArtifact) {
  candidate.value = a;
  pane.value = 'document';
  panelWidth.value = 620;
}
async function refreshFiles() {
  const token = ++filesEpoch;
  filePreview.value = null;
  files.value = { inputs: [], outputs: [] };
  if (!sessionId.value) return;
  filesLoading.value = true;
  try {
    const r = await api<any>(base + '/sessions/' + sessionId.value + '/files');
    if (token === filesEpoch && !controller.signal.aborted) files.value = r;
  } catch (e) {
    if (token === filesEpoch) error.value = (e as Error).message;
  } finally {
    if (token === filesEpoch) filesLoading.value = false;
  }
}
async function inspectFile(id: string) {
  const token = filesEpoch;
  try {
    const r = await api<any>(base + '/sessions/' + sessionId.value + '/files/' + id);
    if (token === filesEpoch && !controller.signal.aborted) filePreview.value = r;
  } catch (e) {
    if (token === filesEpoch) error.value = (e as Error).message;
  }
}
async function inspectOutput(id: string) {
  const token = filesEpoch;
  try {
    const r = await api<AgentArtifact>(base + '/agent/artifacts/' + id);
    if (token === filesEpoch && !controller.signal.aborted) openCandidate(r);
  } catch (e) {
    if (token === filesEpoch) error.value = (e as Error).message;
  }
}
async function selectSession(id: string) {
  if (agentBusy.value || busy.value) return;
  sessionId.value = id;
  candidate.value = null;
  agentKey.value++;
  showNew.value = false;
  await refreshFiles();
  if (compact.value) pane.value = '';
}
async function createSession() {
  if (agentBusy.value || busy.value || dirty.value) return;
  busy.value = true;
  error.value = '';
  try {
    const r = await api<any>(base + '/agent/conversations', {
      selection: selection.value,
      ...(carrySummary.value && sessionId.value ? { handoffFrom: sessionId.value } : {}),
    });
    await refreshSessions();
    sessionId.value = r.conversationId;
    agentKey.value++;
    candidate.value = null;
    showNew.value = false;
    carrySummary.value = false;
    await refreshFiles();
    if (compact.value) pane.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function resizePanel(event: PointerEvent) {
  const control = event.currentTarget as HTMLElement;
  control.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    const bounds = shell.value?.getBoundingClientRect();
    if (bounds)
      panelWidth.value = Math.max(320, Math.min(bounds.width - 360, bounds.right - e.clientX));
  };
  const stop = () => {
    control.removeEventListener('pointermove', move);
    control.removeEventListener('pointerup', stop);
    control.removeEventListener('pointercancel', stop);
  };
  control.addEventListener('pointermove', move);
  control.addEventListener('pointerup', stop);
  control.addEventListener('pointercancel', stop);
}
watch(
  sessionId,
  () => {
    filesEpoch++;
    files.value = { inputs: [], outputs: [] };
    filePreview.value = null;
    filesLoading.value = false;
  },
  { flush: 'sync' },
);
</script>
<template>
  <main class="item-workspace" :aria-busy="loading || busy">
    <header class="item-work-header">
      <RouterLink to="/workspace/development-items" class="work-back" aria-label="返回开发清单"
        ><ArrowLeft :size="18" /><span>开发清单</span></RouterLink
      >
      <h1>{{ state?.item.code }} · {{ state?.item.name || '开发项' }}</h1>
      <span class="stage-label">{{ stage === 'design' ? '设计' : '开发' }}</span>
      <div class="work-header-actions">
        <button
          v-if="stage === 'design'"
          :disabled="busy || agentBusy || dirty"
          @click="useV2 = !useV2"
        >
          {{ useV2 ? '返回旧版' : 'Gem FSD v2（试用）' }}
        </button>
        <button
          class="work-icon"
          aria-label="打开资料面板"
          :aria-expanded="!!pane"
          @click="pane ? (pane = '') : openPanel('info')"
        >
          <PanelRight :size="19" />
        </button>
        <details class="work-more">
          <summary aria-label="更多操作"><MoreHorizontal :size="20" /></summary>
          <div><button :disabled="busy || agentBusy" @click="reload">重新加载最新内容</button></div>
        </details>
      </div>
    </header>
    <p v-if="error" role="alert" class="work-error">
      {{ error }}<button :disabled="busy || agentBusy" @click="reload">读取最新内容</button>
    </p>
    <p v-if="notice" role="status" class="work-notice">{{ notice }}</p>
    <p v-if="loading" role="status" class="work-loading">正在读取开发项…</p>
    <div v-else-if="state?.head" ref="shell" class="work-body" :class="{ 'panel-open': !!pane }">
      <section class="work-chat" v-show="!compact || !pane" aria-label="对话工作区">
        <div v-if="!useV2" class="work-chat-heading">
          <div>
            <span class="work-eyebrow">{{ state.project.name }}</span>
            <h2 :title="currentTitle">{{ currentTitle }}</h2>
          </div>
          <button
            :disabled="busy || !state.canEdit"
            @click="resetAssistant"
            title="清空本开发项设计与开发两阶段的全部对话、附件、工作稿和成果，不可撤销"
          >
            重置对话（清空两阶段成果）
          </button>
          <button
            :disabled="busy || agentBusy || !state.canEdit"
            @click="
              pane = 'sessions';
              showNew = true;
            "
          >
            <Plus :size="16" />新对话
          </button>
        </div>
        <p v-if="dirty" class="work-inline-note">
          成果有未保存修改。<button
            @click="
              pane = 'document';
              candidate = null;
              preview = false;
            "
          >
            前往保存
          </button>
        </p>
        <p v-if="stage === 'development' && !state.designBasis" class="work-inline-note">
          选择设计依据后开始开发。<button @click="pane = 'info'">选择依据</button>
        </p>
        <p v-if="!state.canEdit" class="work-inline-note">
          当前为只读，仅阶段负责人或项目管理员可以修改。
        </p>
        <GemFsdV2
          v-if="useV2"
          :base="base + '/gem-fsd-v2'"
          :editable="state.canEdit"
          @busy="agentBusy = $event"
        />
        <AgentWorkbench
          v-else
          :key="agentKey"
          embedded
          :base="base + '/agent'"
          :model-path="base + '/models'"
          :selection="selection"
          :stage="stage"
          :storage-scope="projectId + ':' + itemId + ':' + stage"
          :initial-run-id="initialSession?.runId"
          :initial-conversation-id="initialSession?.id"
          :editable="state.canEdit"
          :blocked="dirty || busy || (stage === 'development' && !state.designBasis)"
          @busy="agentBusy = $event"
          @conversation="sessionChanged"
          @open-artifact="openCandidate"
          @files-changed="sessionChanged($event).then(refreshFiles)"
        />
      </section>
      <div
        v-if="pane && !compact"
        class="work-divider"
        role="separator"
        tabindex="0"
        aria-label="调整右侧面板宽度"
        aria-orientation="vertical"
        :aria-valuenow="panelWidth"
        :aria-valuemin="320"
        :aria-valuemax="900"
        @pointerdown="resizePanel"
        @keydown.left.prevent="panelWidth = Math.min(900, panelWidth + 40)"
        @keydown.right.prevent="panelWidth = Math.max(320, panelWidth - 40)"
      >
        <span />
      </div>
      <aside
        v-if="pane"
        class="work-panel"
        :style="{ width: compact ? '100%' : panelWidth + 'px' }"
        aria-label="资料与成果面板"
      >
        <header class="work-panel-header">
          <nav aria-label="资料分类">
            <button
              v-for="p in panels"
              :key="p.id"
              :aria-pressed="pane === p.id"
              @click="openPanel(p.id)"
            >
              <component :is="p.icon" :size="16" /><span>{{ p.label }}</span>
            </button>
          </nav>
          <button
            class="work-icon expand-panel"
            aria-label="展开文档宽度"
            @click="panelWidth = panelWidth > 500 ? 400 : 680"
          >
            <Maximize2 :size="16" /></button
          ><button class="work-icon" aria-label="关闭右侧面板" @click="pane = ''">
            <X :size="18" />
          </button>
        </header>
        <div class="work-panel-scroll">
          <section v-if="pane === 'info'" class="work-info">
            <span class="work-eyebrow">{{ state.item.module }} · {{ state.item.kind }}</span>
            <h2>{{ state.item.name }}</h2>
            <h3>需求摘要</h3>
            <p>{{ state.item.summary?.replace(/<[^>]*>/g, '') || '尚未填写需求摘要' }}</p>
            <h3>验收要求</h3>
            <p>{{ state.item.acceptance || '尚未填写验收要求' }}</p>
            <section v-if="stage === 'development'" class="design-basis">
              <strong
                >设计依据：{{
                  state.designBasis ? `v${state.designBasis.revision}` : '尚未选择'
                }}</strong
              >
              <p v-if="state.designChanged" role="status">
                设计已有更新，当前开发仍引用原版本。查看新设计后，可显式切换依据。
              </p>
              <p v-if="!state.designHead">尚无设计成果，请联系设计负责人。</p>
              <label v-else
                >引用版本<select v-model="basisId" :disabled="!writable || agentBusy">
                  <option value="">尚未选择</option>
                  <option
                    v-if="state.designBasis && state.designBasis.id !== state.designHead.id"
                    :value="state.designBasis.id"
                  >
                    当前依据 v{{ state.designBasis.revision }}
                  </option>
                  <option :value="state.designHead.id">
                    最新设计 v{{ state.designHead.revision }}
                  </option>
                </select></label
              >
              <details v-if="state.designBasis">
                <summary>查看当前依据</summary>
                <ChatMarkdown :content="state.designBasis.markdown" />
              </details>
              <details v-if="state.designChanged">
                <summary>查看新设计以比较差异</summary>
                <ChatMarkdown :content="state.designHead.markdown" />
              </details>
            </section>

            <button
              v-if="stage === 'development' && dirty"
              class="work-primary"
              :disabled="!writable || agentBusy"
              @click="save()"
            >
              保存设计依据
            </button>
          </section>
          <section v-if="pane === 'files'" class="work-files">
            <h2>本次对话的文件</h2>
            <p class="work-muted">已就绪的输入文件会用于本次对话；新对话不自动继承。</p>
            <p v-if="filesLoading" role="status">正在读取文件…</p>
            <h3>
              输入文件 <small>{{ files.inputs.length }}</small>
            </h3>
            <p v-if="!files.inputs.length" class="work-empty">暂无文件，通过对话输入框添加。</p>
            <button
              class="work-file-row"
              v-for="f in files.inputs"
              :key="f.id"
              @click="inspectFile(f.id)"
            >
              <FileText :size="20" /><span
                ><strong>{{ f.name }}</strong
                ><small
                  >{{
                    f.state === 'ready'
                      ? '已就绪'
                      : f.state === 'preview_only'
                        ? '仅预览'
                        : '未就绪'
                  }}
                  · {{ Math.ceil(f.bytes / 1024) }} KB</small
                ></span
              >
            </button>
            <h3>
              输出文件 <small>{{ files.outputs.length }}</small>
            </h3>
            <p v-if="!files.outputs.length" class="work-empty">尚未生成成果。</p>
            <button
              class="work-file-row"
              v-for="f in files.outputs"
              :key="f.id"
              @click="inspectOutput(f.id)"
            >
              <FileText :size="20" /><span
                ><strong
                  >{{ stage === 'design' ? '功能说明书' : '开发内容' }} · 候选
                  {{ f.revision }}</strong
                ><small>Markdown · 点击阅读</small></span
              >
            </button>
            <section v-if="filePreview" class="file-extraction">
              <h3>{{ filePreview.name }}</h3>
              <p class="work-muted">提取内容预览，非原始文件。</p>
              <p v-for="w in filePreview.extraction.warnings" :key="w">{{ w }}</p>
              <pre>{{
                filePreview.extraction.text ||
                filePreview.extraction.regions?.map((r: any) => r.text).join('\n\n') ||
                '此文件没有可提取文字。'
              }}</pre>
            </section>
          </section>
          <template v-if="pane === 'document'">
            <section v-if="candidate" class="work-candidate">
              <div class="work-actions">
                <strong>AI 候选 {{ candidate.revision }}</strong
                ><button @click="candidate = null">当前成果</button
                ><button
                  class="work-primary"
                  :disabled="dirty || busy || agentBusy || !state.canEdit"
                  @click="adoptArtifact(candidate)"
                >
                  采用为当前成果
                </button>
              </div>
              <p class="work-muted">采用后保存为新版本，原版本保留。</p>
              <ChatMarkdown :content="candidate.markdown" />
            </section>
            <section v-if="!candidate" class="work-document">
              <div class="work-actions">
                <label
                  >查看版本<select
                    v-model="versionId"
                    :disabled="busy || dirty"
                    @change="chooseVersion"
                  >
                    <option value="">当前工作稿 v{{ state.head.revision }}</option>
                    <option v-for="v in state.versions" :key="v.id" :value="v.id">
                      历史 v{{ v.revision }}
                    </option>
                  </select></label
                ><button @click="preview = !preview">{{ preview ? '编辑' : '阅读' }}</button
                ><button :disabled="!writable || !dirty || agentBusy" @click="save()">
                  保存版本</button
                ><button
                  v-if="historical && state.canEdit"
                  :disabled="busy || agentBusy"
                  @click="restoreVersion"
                >
                  恢复此版本
                </button>
              </div>
              <p v-if="historical">
                正在查看历史 v{{ historical.revision }}（只读）。{{
                  stage === 'development'
                    ? '此历史的设计依据：' + (historical.designVersionId || '尚未选择') + '。'
                    : ''
                }}选择当前工作稿继续编辑。
              </p>
              <ChatMarkdown
                v-if="preview || historical"
                :content="(historical || state.head).markdown"
              />
              <template v-else-if="draft">
                <template v-if="stage === 'design'"
                  ><p>编辑完成后保存，助手将引用最新已保存内容。</p>
                  <StructuredEditor
                    v-if="draft.spec"
                    v-model="draft.spec"
                    :schema="fsdSchema"
                    :root-schema="fsdSchema"
                    :document="draft.spec"
                    :disabled="!writable || agentBusy"
                    label="结构化说明书" />
                  <p v-else>已有需求保留在工作备注中。你可以直接在对话中要求生成说明书。</p>
                  <label
                    >工作备注<textarea
                      aria-label="工作备注"
                      v-model="draft.notes"
                      :disabled="!writable || agentBusy"
                      rows="12"
                    /></label
                ></template>
                <template v-else
                  ><label
                    v-for="field in [
                      { key: 'title', name: '标题' },
                      { key: 'overview', name: '开发说明' },
                      { key: 'technicalDesign', name: '技术设计' },
                      { key: 'code', name: 'ABAP 程序' },
                      { key: 'tests', name: '测试方案' },
                      { key: 'notes', name: '工作备注' },
                    ]"
                    :key="field.key"
                    >{{ field.name
                    }}<textarea
                      :aria-label="field.name"
                      v-model="draft[field.key]"
                      :disabled="!writable || agentBusy"
                      :rows="field.key === 'code' ? 14 : 5"
                      :spellcheck="field.key !== 'code'"
                    /></label
                ></template>
              </template>
            </section>
          </template>
          <section v-if="pane === 'sessions'" class="work-sessions">
            <div class="work-section-heading">
              <h2>本开发项的{{ stage === 'design' ? '设计' : '开发' }}对话</h2>
              <button :disabled="busy || agentBusy || !state.canEdit" @click="showNew = !showNew">
                <Plus :size="16" />新建
              </button>
            </div>
            <p v-if="!sessions.length" class="work-empty">发送第一条消息后，对话会保存在这里。</p>
            <button
              v-for="s in sessions"
              :key="s.id"
              class="work-session-row"
              :class="{ selected: s.id === sessionId }"
              :disabled="agentBusy || busy"
              @click="selectSession(s.id)"
            >
              <strong>{{ s.title?.slice(0, 50) || '新对话' }}</strong
              ><small
                >{{ new Date(s.created_at).toLocaleString('zh-CN') }}
                {{ s.id === sessionId ? ' · 当前' : '' }}</small
              >
            </button>
            <div v-if="initialSession?.context?.summary" class="work-muted">
              本对话承接了此前的用户要求摘录。
              <details>
                <summary>查看承接内容</summary>
                <pre>{{ initialSession.context.summary }}</pre>
              </details>
            </div>
            <form v-if="showNew" class="work-new-session" @submit.prevent="createSession">
              <h3>新对话承接内容</h3>
              <p>开发项信息 · 当前已保存成果 v{{ state.head.revision }}</p>
              <label
                ><input
                  type="checkbox"
                  v-model="carrySummary"
                  :disabled="!sessionId"
                />承接上次对话的用户要求摘录</label
              >
              <p class="work-muted">
                不带入历史全文或附件。摘录来自最近的用户要求和已确认回答，不是完整总结。
              </p>
              <p v-if="dirty" role="status">请先保存成果，再创建新对话。</p>
              <button class="work-primary" :disabled="busy || agentBusy || dirty || !state.canEdit">
                创建对话
              </button>
            </form>
          </section>
        </div>
      </aside>
    </div>
    <p v-else-if="!loading">尚无当前成果，阶段负责人可以启用工作区。</p>
  </main>
</template>
