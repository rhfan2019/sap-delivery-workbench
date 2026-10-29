<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useMediaQuery } from '@vueuse/core';
import { api, ApiError, identity } from '../../services/session';
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
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Info,
  Paperclip,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from '@lucide/vue';
import BaseBanner from '../../components/base/BaseBanner.vue';
import BaseButton from '../../components/base/BaseButton.vue';
import BaseIconButton from '../../components/base/BaseIconButton.vue';
import BaseMenu from '../../components/base/BaseMenu.vue';
import BaseMenuItem from '../../components/base/BaseMenuItem.vue';
import BasePopover from '../../components/base/BasePopover.vue';
import BasePropertyRow from '../../components/base/BasePropertyRow.vue';
import BaseSection from '../../components/base/BaseSection.vue';
import BaseSkeleton from '../../components/base/BaseSkeleton.vue';
import BaseTag from '../../components/base/BaseTag.vue';
import {
  DEV_AGENT_KINDS,
  OPTIONS,
  richText,
} from '@sap-delivery-workbench/contracts/delivery/fields';
import './workspace.css';

// The item workspace of one assistant: the conversation on the left, what it produced on the
// right. Conversations are switched in the chat heading and named in the address (?session=).
const props = defineProps<{ projectId: string; itemId: string; config: StageConfig }>();
const route = useRoute(),
  router = useRouter();
const agentBase = `/projects/${props.projectId}/development-items/${props.itemId}/${props.config.agent}`;
const run = useAgentSession(agentBase);
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
  // Whether the reader may use each assistant on this item (the other tab, spec 5).
  stages?: { design: boolean; development: boolean };
  model: string | null;
} | null>(null);
const sessions = ref<AgentSession[]>([]);
const error = ref(''),
  // Without agent.*:run the page is closed; the outputs are in the item drawer (spec 6.3).
  denied = ref(false),
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
    // The address names the conversation, archived or not; the last open one used here, then
    // the newest open one, is the fallback.
    const named = sessions.value.find((s) => s.id === querySession());
    const last = openSessions.value.find((s) => s.id === recall(sessionKey));
    await run.load(named?.id ?? last?.id ?? openSessions.value[0]?.id ?? '');
    restorePanel();
  } catch (e) {
    if (controller.signal.aborted) return;
    if (e instanceof ApiError && e.status === 403) denied.value = true;
    else error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function showOutputs() {
  void router.push({
    path: '/workspace/development-items',
    query: { project: props.projectId, item: props.itemId, section: 'outputs' },
  });
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
  renaming = ref(''),
  newTitle = ref(''),
  renameError = ref('');
watch(switcherOpen, (open) => {
  if (!open) renaming.value = '';
});
const current = computed(() => sessions.value.find((s) => s.id === run.sessionId.value));
// Archived conversations fold into a group at the bottom of the switcher (discipline 5).
const openSessions = computed(() => sessions.value.filter((s) => !s.archivedAt));
const archivedSessions = computed(() => sessions.value.filter((s) => s.archivedAt));
const currentArchived = computed(() => !!current.value?.archivedAt);
const archivedOpen = ref(false),
  archiving = ref('');
watch(switcherOpen, (open) => {
  if (open) archivedOpen.value = currentArchived.value;
});
// "新对话" is the button on the right; the switcher only names the current conversation.
const currentTitle = computed(() =>
  run.sessionId.value ? current.value?.title?.trim() || '未命名对话' : '对话',
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
// Archiving the open conversation moves to the newest open one, or the new-conversation state.
async function setArchived(s: AgentSession, archived: boolean) {
  if (archiving.value) return;
  archiving.value = s.id;
  error.value = '';
  try {
    await api(`${agentBase}/sessions/${s.id}`, { archived }, 'PATCH');
    await refreshSessions();
    if (archived && s.id === run.sessionId.value) {
      version.value = null;
      filePreview.value = null;
      const next = openSessions.value[0]?.id ?? '';
      await run.load(next);
      if (!next) {
        const query = { ...route.query };
        delete query.session;
        void router.replace({ query }).catch(() => {});
      }
      restorePanel();
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    archiving.value = '';
  }
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

// --- Item details and files -------------------------------------------------------------------
// The item's fields sit in a details panel on the right (DESIGN.md 4.3), open by choice.
const detailsKey = 'item-details-panel';
const detailsOpen = ref(recall(detailsKey) === 'open'),
  filesOpen = ref(false);
function toggleDetails() {
  detailsOpen.value = !detailsOpen.value;
  if (detailsOpen.value && compact.value) panelOpen.value = false;
  remember(detailsKey, detailsOpen.value ? 'open' : 'closed');
}
// The same item in the other assistant: the record page has a design and a development tab.
// A tab the reader cannot use stays visible but disabled, with the reason (spec 5).
const stages = computed(() => {
  const root = `/projects/${props.projectId}/development-items/${props.itemId}`;
  const kind = state.value?.item.kind ?? '';
  return [
    { id: 'abap-fsd-agent', label: '设计', to: `${root}/design`, blocked: '' },
    {
      id: 'abap-dev-agent',
      label: '开发',
      to: `${root}/development`,
      blocked: kind && !DEV_AGENT_KINDS.includes(kind) ? '当前版本只支持报表与功能类开发项' : '',
    },
  ];
});
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
  if (compact.value) detailsOpen.value = false;
}
function togglePanel() {
  panelOpen.value = !panelOpen.value;
  if (panelOpen.value && compact.value) detailsOpen.value = false;
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
    <header class="record-bar">
      <BaseIconButton label="返回开发清单" to="/workspace/development-items" side="bottom"
        ><ArrowLeft :size="16"
      /></BaseIconButton>
      <div class="record-title">
        <BaseTag v-if="state" variant="outline">{{ state.item.code }}</BaseTag>
        <h1>{{ state?.item.name || '开发项' }}</h1>
      </div>
      <nav class="record-tabs" aria-label="助手">
        <template v-for="s in stages" :key="s.id">
          <span
            v-if="s.blocked && s.id !== config.agent"
            class="record-tab disabled"
            aria-disabled="true"
            :title="s.blocked"
            >{{ s.label }}</span
          >
          <RouterLink
            v-else
            :to="s.to"
            class="record-tab"
            :class="{ selected: s.id === config.agent }"
            :aria-current="s.id === config.agent ? 'page' : undefined"
            >{{ s.label }}</RouterLink
          >
        </template>
      </nav>
      <BasePopover v-model:open="switcherOpen" align="start">
        <template #trigger>
          <button class="record-switcher" :title="currentTitle" :disabled="!state">
            <MessageSquare :size="14" /><span>{{ currentTitle }}</span
            ><ChevronDown :size="14" />
          </button>
        </template>
        <section v-if="state" class="work-sessions" aria-label="切换对话">
          <h3>{{ config.sessionsHeading }}</h3>
          <p v-if="!openSessions.length" class="work-empty">发送第一条消息后，对话会保存在这里。</p>
          <ul role="listbox">
            <li
              v-for="s in openSessions"
              :key="s.id"
              role="option"
              :aria-selected="s.id === run.sessionId.value"
              class="work-session-row"
              :class="{ selected: s.id === run.sessionId.value }"
            >
              <form v-if="renaming === s.id" class="work-rename" @submit.prevent="saveRename">
                <input v-model="newTitle" aria-label="对话名称" maxlength="200" autofocus />
                <button class="work-icon" aria-label="保存名称" :disabled="!newTitle.trim()">
                  <Check :size="14" />
                </button>
                <button
                  type="button"
                  class="work-icon"
                  aria-label="取消改名"
                  @click="renaming = ''"
                >
                  <X :size="14" />
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
                <button
                  v-if="state.canEdit"
                  class="work-icon"
                  aria-label="归档对话"
                  :title="
                    s.activeTurnId || (agentBusy && s.id === run.sessionId.value)
                      ? '对话正在运行，结束后再归档'
                      : '归档'
                  "
                  :disabled="
                    !!archiving || !!s.activeTurnId || (agentBusy && s.id === run.sessionId.value)
                  "
                  @click="setArchived(s, true)"
                >
                  <Archive :size="14" />
                </button>
              </template>
            </li>
          </ul>
          <template v-if="archivedSessions.length">
            <button
              type="button"
              class="work-archived-toggle"
              :aria-expanded="archivedOpen"
              @click="archivedOpen = !archivedOpen"
            >
              <component :is="archivedOpen ? ChevronDown : ChevronRight" :size="14" />已归档（{{
                archivedSessions.length
              }}）
            </button>
            <ul v-if="archivedOpen" role="listbox" aria-label="已归档的对话">
              <li
                v-for="s in archivedSessions"
                :key="s.id"
                role="option"
                :aria-selected="s.id === run.sessionId.value"
                class="work-session-row"
                :class="{ selected: s.id === run.sessionId.value }"
              >
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
                <BaseButton
                  v-if="state.canEdit"
                  variant="ghost"
                  size="sm"
                  :disabled="!!archiving"
                  @click="setArchived(s, false)"
                  >恢复</BaseButton
                >
              </li>
            </ul>
          </template>
        </section>
      </BasePopover>
      <div class="record-actions">
        <BasePopover
          v-if="state && run.attachments.value.length"
          v-model:open="filesOpen"
          align="end"
        >
          <template #trigger>
            <BaseButton variant="ghost" size="sm"
              ><template #icon><Paperclip :size="14" /></template
              ><span class="record-label">资料 {{ run.attachments.value.length }}</span></BaseButton
            >
          </template>
          <section class="work-files" aria-label="本次对话的文件">
            <p class="work-muted">上传的资料会提供给助手阅读；新对话不自动继承。</p>
            <button
              v-for="f in run.attachments.value"
              :key="f.id"
              class="work-file-row"
              @click="inspectFile(f.id)"
            >
              <FileText :size="16" /><span
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
        </BasePopover>
        <BaseButton
          variant="ghost"
          size="sm"
          :disabled="agentBusy || !state?.canEdit"
          @click="createSession"
          ><template #icon><Plus :size="14" /></template
          ><span class="record-label">新对话</span></BaseButton
        >
        <span class="record-divider" aria-hidden="true" />
        <BaseIconButton
          :label="detailsOpen ? '关闭开发项信息' : '开发项信息'"
          :pressed="detailsOpen"
          side="bottom"
          @click="toggleDetails"
          ><Info :size="16"
        /></BaseIconButton>
        <BaseIconButton
          :label="
            panelOpen ? '关闭成果面板' : hasArtifact ? '打开成果面板' : '助手写出第一版后可查看成果'
          "
          :pressed="panelOpen"
          :disabled="!panelOpen && !hasArtifact"
          side="bottom"
          @click="togglePanel"
          ><PanelRight :size="16"
        /></BaseIconButton>
        <BaseMenu align="end">
          <template #trigger>
            <BaseIconButton label="更多操作" side="bottom"
              ><MoreHorizontal :size="16"
            /></BaseIconButton>
          </template>
          <BaseMenuItem :disabled="agentBusy" @select="load"
            ><template #icon><RefreshCw :size="14" /></template>重新加载最新内容</BaseMenuItem
          >
        </BaseMenu>
      </div>
    </header>
    <BaseBanner v-if="error" tone="red" role="alert" class="record-banner">
      {{ error }}
      <template #action
        ><BaseButton size="sm" variant="ghost" :disabled="agentBusy" @click="load"
          >读取最新内容</BaseButton
        ></template
      >
    </BaseBanner>
    <div v-if="loading" role="status" class="work-loading" aria-label="正在读取开发项">
      <BaseSkeleton v-for="n in 4" :key="n" />
    </div>
    <section v-else-if="denied" class="work-denied" aria-label="无权使用助手">
      <h2>你没有使用{{ config.assistantName }}的权限</h2>
      <p>
        需要“{{ config.development ? '使用开发助手' : '使用设计助手' }}”，并在你的模块范围内。{{
          config.development ? '开发方案与代码' : '功能说明书'
        }}可以在开发项的“成果”中查看。
      </p>
      <BaseButton @click="showOutputs"
        >查看{{ config.development ? '开发成果' : '功能说明书' }}</BaseButton
      >
    </section>
    <div v-else-if="state" ref="shell" class="work-body">
      <section
        v-show="!compact || (!panelOpen && !detailsOpen)"
        class="work-chat"
        aria-label="对话工作区"
      >
        <BaseBanner v-if="!state.canEdit" tone="yellow" class="record-banner"
          >项目已归档，只能查看。</BaseBanner
        >
        <AgentWorkbench
          :base="agentBase"
          :session="run"
          :model-name="state.model"
          :editable="state.canEdit && !currentArchived"
          :archived="currentArchived"
          :restorable="state.canEdit"
          :development="config.development"
          @restore="current && setArchived(current, false)"
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
      />
      <aside
        v-if="panelOpen"
        class="work-panel"
        :style="{ width: compact ? '100%' : panelWidth + 'px' }"
        aria-label="成果面板"
      >
        <header class="work-panel-header">
          <BaseButton v-if="filePreview" variant="ghost" size="sm" @click="filePreview = null"
            ><template #icon><ArrowLeft :size="14" /></template>返回成果</BaseButton
          >
          <h2 v-else class="work-panel-title">
            <FileText :size="14" />{{ config.development ? '开发方案与代码' : '功能说明书' }}
          </h2>
          <span class="work-panel-tools">
            <span v-if="!compact"
              ><BaseIconButton
                label="调整面板宽度"
                size="sm"
                side="bottom"
                @click="panelWidth = panelWidth > 500 ? 400 : 680"
                ><Maximize2 :size="14" /></BaseIconButton
            ></span>
            <BaseIconButton label="关闭成果面板" size="sm" side="bottom" @click="togglePanel"
              ><X :size="16"
            /></BaseIconButton>
          </span>
        </header>
        <div class="work-panel-scroll" :class="{ 'work-panel-fill': !filePreview }">
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
            :can-edit="state.canEdit && !currentArchived"
            :version="version"
            @version="version = $event"
          />
        </div>
      </aside>
      <aside v-if="detailsOpen" class="record-details" aria-label="开发项信息">
        <header class="work-panel-header">
          <h2 class="work-panel-title">开发项信息</h2>
          <BaseIconButton label="关闭开发项信息" size="sm" side="bottom" @click="toggleDetails"
            ><X :size="16"
          /></BaseIconButton>
        </header>
        <div class="record-details-body">
          <BaseSection title="基本信息">
            <dl>
              <BasePropertyRow label="编号">{{ state.item.code }}</BasePropertyRow>
              <BasePropertyRow label="项目">{{ state.project.name }}</BasePropertyRow>
              <BasePropertyRow label="模块" :empty="!state.item.module">{{
                state.item.module
              }}</BasePropertyRow>
              <BasePropertyRow label="类型" :empty="!state.item.kind">
                <BaseTag>{{ OPTIONS.kind[state.item.kind] ?? state.item.kind }}</BaseTag>
              </BasePropertyRow>
              <template v-if="config.development">
                <BasePropertyRow label="变更类型" :empty="!state.item.changeType">{{
                  changeTypeLabel
                }}</BasePropertyRow>
                <BasePropertyRow label="事务码" :empty="!state.item.transactionCode">{{
                  state.item.transactionCode
                }}</BasePropertyRow>
              </template>
            </dl>
          </BaseSection>
          <BaseSection v-if="config.development" title="开发对象">
            <ul v-if="state.item.objects?.length" class="record-objects">
              <li v-for="o in state.item.objects" :key="o.pgmid + o.objectType + o.objectName">
                <BaseTag variant="outline">{{ o.objectType }}</BaseTag
                ><span>{{ o.objectName }}</span>
              </li>
            </ul>
            <p v-else class="work-muted">尚未登记（同步代码需要在开发清单中登记程序对象）</p>
            <p v-if="state.supported === false" class="work-muted">
              当前版本只支持报表与功能类开发项生成代码。
            </p>
          </BaseSection>
          <BaseSection title="业务功能点">
            <p class="record-text">
              {{ richText(state.item.businessFunction) || '尚未填写业务功能点' }}
            </p>
          </BaseSection>
        </div>
      </aside>
    </div>
  </main>
</template>
