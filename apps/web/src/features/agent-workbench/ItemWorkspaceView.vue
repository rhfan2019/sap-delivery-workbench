<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { onClickOutside, useMediaQuery } from '@vueuse/core';
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
  Check,
  ChevronDown,
  FileText,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  PanelRight,
  Pencil,
  Plus,
  X,
} from '@lucide/vue';
import { OPTIONS, richText } from '@sap-delivery-workbench/contracts/delivery/fields';
import './workspace.css';

// The item workspace of one assistant: the conversation on the left, what it produced on the
// right. Conversations are switched in the chat heading and named in the address (?session=).
const props = defineProps<{ projectId: string; itemId: string; config: StageConfig }>();
const route = useRoute(),
  router = useRouter();
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
  version = ref<number | null>(null),
  filePreview = ref<AgentAttachment | null>(null);
const sessionKey = `${props.config.agent}-session:${identity.value?.organization.id}:${identity.value?.user.id}:${props.projectId}:${props.itemId}`;
const panelKey = `${props.config.agent}-panel`;
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const controller = new AbortController();
const compact = useMediaQuery('(max-width: 800px)');

async function refreshSessions() {
  const r = await api<any>(agentBase + '/sessions', undefined, undefined, {
    signal: controller.signal,
  });
  state.value = r;
  sessions.value = r.sessions;
}
const querySession = () => (typeof route.query.session === 'string' ? route.query.session : '');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    await refreshSessions();
    // The address names the conversation; the last one used here is the fallback.
    const wanted = [querySession(), recall(sessionKey)].find((id) =>
      sessions.value.some((s) => s.id === id),
    );
    await run.load(wanted ?? sessions.value[0]?.id ?? '');
    restorePanel();
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
// A session created by the first message or upload joins the list and the address. A switch
// the reader made is a history entry (Back returns to the previous conversation).
let pushNext = false;
watch(run.sessionId, async (id) => {
  if (!id) return;
  remember(sessionKey, id);
  if (querySession() !== id) {
    const to = { query: { ...route.query, session: id } };
    void (pushNext ? router.push(to) : router.replace(to)).catch(() => {});
  }
  pushNext = false;
  if (!sessions.value.some((s) => s.id === id)) await refreshSessions().catch(() => {});
});
// Back and forward between conversations.
watch(querySession, (id) => {
  if (id && id !== run.sessionId.value && sessions.value.some((s) => s.id === id))
    void selectSession(id);
});
watch(run.busy, (busy, was) => {
  if (was && !busy) void refreshSessions().catch(() => {});
});

// --- Conversation switcher --------------------------------------------------------------------
const switcherOpen = ref(false),
  switcher = ref<HTMLElement | null>(null),
  renaming = ref(''),
  newTitle = ref(''),
  renameError = ref('');
onClickOutside(switcher, () => {
  switcherOpen.value = false;
  renaming.value = '';
});
const current = computed(() => sessions.value.find((s) => s.id === run.sessionId.value));
const currentTitle = computed(() =>
  run.sessionId.value ? current.value?.title?.trim() || '未命名对话' : '新对话',
);
const time = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

async function selectSession(id: string) {
  if (agentBusy.value) return;
  switcherOpen.value = false;
  version.value = null;
  filePreview.value = null;
  pushNext = true;
  await run.load(id);
  restorePanel();
}
async function createSession() {
  if (agentBusy.value || !state.value?.canEdit) return;
  switcherOpen.value = false;
  try {
    version.value = null;
    filePreview.value = null;
    pushNext = true;
    await run.create();
    await refreshSessions();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function startRename(s: AgentSession) {
  renaming.value = s.id;
  newTitle.value = s.title ?? '';
  renameError.value = '';
}
async function saveRename() {
  const id = renaming.value;
  if (!id || !newTitle.value.trim()) return;
  try {
    await api(`${agentBase}/sessions/${id}`, { title: newTitle.value.trim() }, 'PATCH');
    renaming.value = '';
    await refreshSessions();
  } catch (e) {
    renameError.value = (e as Error).message;
  }
}

// --- Item card and files ----------------------------------------------------------------------
const infoOpen = ref(false),
  info = ref<HTMLElement | null>(null),
  filesOpen = ref(false),
  files = ref<HTMLElement | null>(null);
onClickOutside(info, () => (infoOpen.value = false));
onClickOutside(files, () => (filesOpen.value = false));
const changeTypeLabel = computed(
  () =>
    (OPTIONS.changeType as Record<string, string>)[state.value?.item.changeType ?? ''] ?? '未填写',
);
async function inspectFile(id: string) {
  filesOpen.value = false;
  try {
    filePreview.value = await api<AgentAttachment>(
      `${agentBase}/sessions/${run.sessionId.value}/attachments/${id}`,
    );
    openPanel();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// --- The artifact panel -----------------------------------------------------------------------
// Open by default once the conversation has a result, unless the reader closed it last time.
const panelOpen = ref(false);
const hasArtifact = computed(() => props.config.latestRevision(run.detail.value) !== undefined);
function restorePanel() {
  if (compact.value) panelOpen.value = false;
  else panelOpen.value = recall(panelKey) !== 'closed' && hasArtifact.value;
}
function openPanel() {
  panelOpen.value = true;
}
function togglePanel() {
  panelOpen.value = !panelOpen.value;
  if (!panelOpen.value) filePreview.value = null;
  remember(panelKey, panelOpen.value ? 'open' : 'closed');
}
function openArtifact(a: AgentArtifactRef) {
  version.value = a.revision === props.config.latestRevision(run.detail.value) ? null : a.revision;
  filePreview.value = null;
  openPanel();
}
// A new version arriving opens the panel unless the reader closed it on purpose.
watch(hasArtifact, (has, had) => {
  if (has && !had && !compact.value && recall(panelKey) !== 'closed') panelOpen.value = true;
});

const panelWidth = ref(680),
  shell = ref<HTMLElement | null>(null);
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

async function safeLeave() {
  return (
    !agentBusy.value || (await askConfirmation('助手仍在运行，离开页面不会中断它。确认离开？'))
  );
}
onBeforeRouteLeave(safeLeave);
// Switching conversations only changes the query; that is not leaving.
onBeforeRouteUpdate((to, from) => to.path === from.path || safeLeave());
onMounted(() => void load());
onBeforeUnmount(() => controller.abort());
</script>
<template>
  <main class="item-workspace" :aria-busy="loading">
    <header class="item-work-header">
      <RouterLink to="/workspace/development-items" class="work-back" aria-label="返回开发清单"
        ><ArrowLeft :size="18" /><span>开发清单</span></RouterLink
      >
      <div ref="info" class="work-popover-anchor work-item-title">
        <button
          class="work-title-button"
          :aria-expanded="infoOpen"
          aria-haspopup="dialog"
          @click="infoOpen = !infoOpen"
        >
          <h1>{{ state?.item.code }} · {{ state?.item.name || '开发项' }}</h1>
          <ChevronDown :size="16" />
        </button>
        <section v-if="infoOpen && state" class="work-popover work-info" aria-label="开发项信息">
          <span class="work-eyebrow"
            >{{ state.project.name }} · {{ state.item.module }} ·
            {{ OPTIONS.kind[state.item.kind] ?? state.item.kind }}</span
          >
          <h2>{{ state.item.code }} · {{ state.item.name }}</h2>
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
        </section>
      </div>
      <span class="stage-label">{{ config.stageLabel }}</span>
      <div class="work-header-actions">
        <button
          class="work-panel-toggle"
          :aria-label="panelOpen ? '关闭成果面板' : '打开成果面板'"
          :aria-expanded="panelOpen"
          @click="togglePanel"
        >
          <PanelRight :size="18" /><span>成果</span>
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
    <div v-else-if="state" ref="shell" class="work-body" :class="{ 'panel-open': panelOpen }">
      <section class="work-chat" v-show="!compact || !panelOpen" aria-label="对话工作区">
        <div class="work-chat-heading">
          <div ref="switcher" class="work-popover-anchor work-switcher">
            <span class="work-eyebrow">{{ config.assistantName }}</span>
            <button
              class="work-title-button"
              :aria-expanded="switcherOpen"
              aria-haspopup="listbox"
              :title="currentTitle"
              @click="switcherOpen = !switcherOpen"
            >
              <h2>{{ currentTitle }}</h2>
              <ChevronDown :size="16" />
            </button>
            <section v-if="switcherOpen" class="work-popover work-sessions" aria-label="切换对话">
              <h3>{{ config.sessionsHeading }}</h3>
              <p v-if="!sessions.length" class="work-empty">发送第一条消息后，对话会保存在这里。</p>
              <ul role="listbox">
                <li
                  v-for="s in sessions"
                  :key="s.id"
                  role="option"
                  :aria-selected="s.id === run.sessionId.value"
                  class="work-session-row"
                  :class="{ selected: s.id === run.sessionId.value }"
                >
                  <form v-if="renaming === s.id" class="work-rename" @submit.prevent="saveRename">
                    <input v-model="newTitle" aria-label="对话名称" maxlength="200" autofocus />
                    <button class="work-icon" aria-label="保存名称" :disabled="!newTitle.trim()">
                      <Check :size="16" />
                    </button>
                    <button
                      type="button"
                      class="work-icon"
                      aria-label="取消改名"
                      @click="renaming = ''"
                    >
                      <X :size="16" />
                    </button>
                    <small v-if="renameError" role="alert">{{ renameError }}</small>
                  </form>
                  <template v-else>
                    <button
                      class="work-session-pick"
                      :disabled="agentBusy && s.id !== run.sessionId.value"
                      @click="selectSession(s.id)"
                    >
                      <strong>{{ s.title?.trim() || '未命名对话' }}</strong>
                      <small
                        >{{ time(s.updatedAt) }}{{ config.sessionVersion(s)
                        }}{{ s.id === run.sessionId.value ? ' · 当前' : '' }}</small
                      >
                    </button>
                    <button
                      v-if="state.canEdit"
                      class="work-icon"
                      aria-label="重命名对话"
                      @click="startRename(s)"
                    >
                      <Pencil :size="14" />
                    </button>
                  </template>
                </li>
              </ul>
            </section>
          </div>
          <div class="work-chat-actions">
            <div v-if="run.attachments.value.length" ref="files" class="work-popover-anchor">
              <button :aria-expanded="filesOpen" @click="filesOpen = !filesOpen">
                <Paperclip :size="15" />资料 {{ run.attachments.value.length }}
              </button>
              <section
                v-if="filesOpen"
                class="work-popover work-popover-right work-files"
                aria-label="本次对话的文件"
              >
                <p class="work-muted">上传的资料会提供给助手阅读；新对话不自动继承。</p>
                <button
                  v-for="f in run.attachments.value"
                  :key="f.id"
                  class="work-file-row"
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
              </section>
            </div>
            <button :disabled="agentBusy || !state.canEdit" @click="createSession">
              <Plus :size="16" />新对话
            </button>
          </div>
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
        v-if="panelOpen && !compact"
        class="work-divider"
        role="separator"
        tabindex="0"
        aria-label="调整成果面板宽度"
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
        v-if="panelOpen"
        class="work-panel"
        :style="{ width: compact ? '100%' : panelWidth + 'px' }"
        aria-label="成果面板"
      >
        <header class="work-panel-header">
          <button v-if="filePreview" class="work-panel-back" @click="filePreview = null">
            <ArrowLeft :size="16" />返回成果
          </button>
          <h2 v-else class="work-panel-title">
            <FileText :size="16" />{{ config.development ? '开发方案与代码' : '功能说明书' }}
          </h2>
          <button
            class="work-icon expand-panel"
            aria-label="调整面板宽度"
            @click="panelWidth = panelWidth > 500 ? 400 : 680"
          >
            <Maximize2 :size="16" /></button
          ><button class="work-icon" aria-label="关闭成果面板" @click="togglePanel">
            <X :size="18" />
          </button>
        </header>
        <div class="work-panel-scroll">
          <section v-if="filePreview" class="file-extraction">
            <h3>{{ filePreview.fileName }}</h3>
            <p class="work-muted">提取内容预览，非原始文件。</p>
            <p v-for="w in filePreview.warnings" :key="w">{{ w }}</p>
            <pre>{{ filePreview.text || '此文件没有可提取文字。' }}</pre>
          </section>
          <component
            :is="config.artifactPanel"
            v-else
            :base="agentBase"
            :session="run"
            :can-edit="state.canEdit"
            :version="version"
            @version="version = $event"
          />
        </div>
      </aside>
    </div>
  </main>
</template>
