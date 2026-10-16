<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api, identity } from '../../services/session';
import { askConfirmation } from '../../services/confirmation';
import AgentWorkbench from './AgentWorkbench.vue';
import { useAgentSession } from './useAgentSession';
import type { StageConfig } from './stage';
import type {
  AgentArtifactRef,
  AgentAttachment,
  AgentSession,
} from '@sap-delivery-workbench/contracts/agent-core/types';
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
import { OPTIONS, richText } from '@sap-delivery-workbench/contracts/delivery/fields';
import './workspace.css';

const props = defineProps<{ projectId: string; itemId: string; config: StageConfig }>();
const agentBase = `/projects/${props.projectId}/development-items/${props.itemId}/${props.config.agent}`;
const run = useAgentSession(agentBase, props.config.sapEnvironment);
const state = ref<{
  project: { name: string };
  item: {
    code: string;
    name: string;
    module: string;
    kind: string;
    businessFunction: string;
    changeType?: string;
    transactionCode?: string;
    objects?: { pgmid: string; objectType: string; objectName: string }[];
  };
  supported?: boolean;
  canEdit: boolean;
  model: string | null;
} | null>(null);
const sessions = ref<AgentSession[]>([]);
const error = ref(''),
  loading = ref(true),
  agentBusy = ref(false),
  pane = ref(''),
  version = ref<number | null>(null),
  filePreview = ref<AgentAttachment | null>(null);
const sessionKey = `${props.config.agent}-session:${identity.value?.organization.id}:${identity.value?.user.id}:${props.projectId}:${props.itemId}`;
const remember = (id: string) => {
  try {
    localStorage.setItem(sessionKey, id);
  } catch {}
};
const controller = new AbortController();

async function refreshSessions() {
  const r = await api<any>(agentBase + '/sessions', undefined, undefined, {
    signal: controller.signal,
  });
  state.value = r;
  sessions.value = r.sessions;
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    await refreshSessions();
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(sessionKey);
    } catch {}
    const id = sessions.value.some((s) => s.id === remembered)
      ? remembered!
      : (sessions.value[0]?.id ?? '');
    await run.load(id);
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
// A session created by the first message or upload joins the list.
watch(run.sessionId, async (id) => {
  if (!id) return;
  remember(id);
  if (!sessions.value.some((s) => s.id === id)) await refreshSessions().catch(() => {});
});
watch(run.busy, (busy, was) => {
  if (was && !busy) void refreshSessions().catch(() => {});
});

async function selectSession(id: string) {
  if (agentBusy.value) return;
  version.value = null;
  filePreview.value = null;
  await run.load(id);
  if (compact.value) pane.value = '';
}
async function createSession() {
  if (agentBusy.value || !state.value?.canEdit) return;
  try {
    version.value = null;
    await run.create();
    await refreshSessions();
    if (compact.value) pane.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function inspectFile(id: string) {
  try {
    filePreview.value = await api<AgentAttachment>(
      `${agentBase}/sessions/${run.sessionId.value}/attachments/${id}`,
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function openArtifact(a: AgentArtifactRef) {
  version.value = a.revision === props.config.latestRevision(run.detail.value) ? null : a.revision;
  openPanel('document');
}

async function safeLeave() {
  return (
    !agentBusy.value || (await askConfirmation('助手仍在运行，离开页面不会中断它。确认离开？'))
  );
}
onBeforeRouteLeave(safeLeave);
onBeforeRouteUpdate(safeLeave);
onMounted(() => void load());
onBeforeUnmount(() => controller.abort());

const compact = useMediaQuery('(max-width: 800px)');
const panelWidth = ref(400),
  shell = ref<HTMLElement | null>(null);
const panels = [
  { id: 'info', label: '开发项', icon: Info },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'document', label: '成果', icon: FileText },
  { id: 'sessions', label: '对话', icon: MessageSquare },
];
const changeTypeLabel = computed(
  () =>
    (OPTIONS.changeType as Record<string, string>)[state.value?.item.changeType ?? ''] ?? '未填写',
);
const currentTitle = computed(
  () => `${state.value?.item.name || '开发项'} · ${props.config.assistantName}`,
);
function openPanel(id: string) {
  if (pane.value !== id) panelWidth.value = id === 'document' ? 680 : 400;
  pane.value = id;
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
</script>
<template>
  <main class="item-workspace" :aria-busy="loading">
    <header class="item-work-header">
      <RouterLink to="/workspace/development-items" class="work-back" aria-label="返回开发清单"
        ><ArrowLeft :size="18" /><span>开发清单</span></RouterLink
      >
      <h1>{{ state?.item.code }} · {{ state?.item.name || '开发项' }}</h1>
      <span class="stage-label">{{ config.stageLabel }}</span>
      <div class="work-header-actions">
        <button
          class="work-icon"
          aria-label="打开资料面板"
          :aria-expanded="!!pane"
          @click="pane ? (pane = '') : openPanel('document')"
        >
          <PanelRight :size="19" />
        </button>
        <details class="work-more">
          <summary aria-label="更多操作"><MoreHorizontal :size="20" /></summary>
          <div><button :disabled="agentBusy" @click="load">重新加载最新内容</button></div>
        </details>
      </div>
    </header>
    <p v-if="error" role="alert" class="work-error">
      {{ error }}<button :disabled="agentBusy" @click="load">读取最新内容</button>
    </p>
    <p v-if="loading" role="status" class="work-loading">正在读取开发项…</p>
    <div v-else-if="state" ref="shell" class="work-body" :class="{ 'panel-open': !!pane }">
      <section class="work-chat" v-show="!compact || !pane" aria-label="对话工作区">
        <div class="work-chat-heading">
          <div>
            <span class="work-eyebrow">{{ state.project.name }}</span>
            <h2 :title="currentTitle">{{ currentTitle }}</h2>
          </div>
          <button :disabled="agentBusy || !state.canEdit" @click="createSession">
            <Plus :size="16" />新对话
          </button>
        </div>
        <p v-if="!state.canEdit" class="work-inline-note">
          {{ config.readonlyNote }}
        </p>
        <AgentWorkbench
          :base="agentBase"
          :session="run"
          :model-name="state.model"
          :editable="state.canEdit"
          :development="config.development"
          @busy="agentBusy = $event"
          @open-artifact="openArtifact"
          @files-changed="run.refresh()"
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
            <span class="work-eyebrow"
              >{{ state.item.code }} · {{ state.item.module }} ·
              {{ OPTIONS.kind[state.item.kind] ?? state.item.kind }}</span
            >
            <h2>{{ state.item.name }}</h2>
            <template v-if="config.development">
              <h3>变更类型</h3>
              <p>{{ changeTypeLabel }}</p>
              <h3>开发对象</h3>
              <p>
                {{
                  state.item.objects?.length
                    ? state.item.objects
                        .map((o) => `${o.pgmid} ${o.objectType} ${o.objectName}`)
                        .join('；')
                    : '尚未登记（同步代码需要在开发清单中登记程序对象）'
                }}
              </p>
              <h3>事务码</h3>
              <p>{{ state.item.transactionCode || '未登记' }}</p>
              <p v-if="state.supported === false" class="work-inline-note">
                当前版本只支持报表与功能类开发项生成代码。
              </p>
            </template>
            <h3>业务功能点</h3>
            <p>{{ richText(state.item.businessFunction) || '尚未填写业务功能点' }}</p>
            <h3>模型</h3>
            <p>{{ state.model ?? '尚未配置组织默认模型' }}</p>
          </section>
          <section v-if="pane === 'files'" class="work-files">
            <h2>本次对话的文件</h2>
            <p class="work-muted">上传的资料会提供给助手阅读；新对话不自动继承。</p>
            <p v-if="!run.attachments.value.length" class="work-empty">
              暂无文件，通过对话输入框添加。
            </p>
            <button
              class="work-file-row"
              v-for="f in run.attachments.value"
              :key="f.id"
              @click="inspectFile(f.id)"
            >
              <FileText :size="20" /><span
                ><strong>{{ f.fileName }}</strong
                ><small
                  >{{
                    f.parseState === 'ready'
                      ? '已读取'
                      : f.parseState === 'preview_only'
                        ? '仅预览'
                        : '未能读取'
                  }}
                  · {{ Math.ceil(f.size / 1024) }} KB</small
                ></span
              >
            </button>
            <section v-if="filePreview" class="file-extraction">
              <h3>{{ filePreview.fileName }}</h3>
              <p class="work-muted">提取内容预览，非原始文件。</p>
              <p v-for="w in filePreview.warnings" :key="w">{{ w }}</p>
              <pre>{{ filePreview.text || '此文件没有可提取文字。' }}</pre>
            </section>
          </section>
          <component
            :is="config.artifactPanel"
            v-if="pane === 'document'"
            :base="agentBase"
            :session="run"
            :can-edit="state.canEdit"
            :version="version"
            @version="version = $event"
          />
          <section v-if="pane === 'sessions'" class="work-sessions">
            <div class="work-section-heading">
              <h2>{{ config.sessionsHeading }}</h2>
              <button :disabled="agentBusy || !state.canEdit" @click="createSession">
                <Plus :size="16" />新建
              </button>
            </div>
            <p v-if="!sessions.length" class="work-empty">发送第一条消息后，对话会保存在这里。</p>
            <button
              v-for="s in sessions"
              :key="s.id"
              class="work-session-row"
              :class="{ selected: s.id === run.sessionId.value }"
              :disabled="agentBusy"
              @click="selectSession(s.id)"
            >
              <strong>{{ s.title?.slice(0, 50) || '新对话' }}</strong
              ><small
                >{{ new Date(s.updatedAt).toLocaleString('zh-CN') }}
                {{ config.sessionVersion(s) }}
                {{ s.id === run.sessionId.value ? ' · 当前' : '' }}</small
              >
            </button>
          </section>
        </div>
      </aside>
    </div>
  </main>
</template>
