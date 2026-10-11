<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Plus, FileText, MessageSquare } from '@lucide/vue';
import { useDropZone, useFileDialog, useMediaQuery } from '@vueuse/core';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import DecisionCard from './DecisionCard.vue';
import WorkflowPanel from './WorkflowPanel.vue';
import { finalGenerationText } from './workflowActions.mjs';
import RunSteps from './RunSteps.vue';
import ChatComposer from './ChatComposer.vue';
import SpecificationPanel from './SpecificationPanel.vue';
import ConversationTimeline from './ConversationTimeline.vue';
import AttachmentTray from './AttachmentTray.vue';
import AttachmentPreview from './AttachmentPreview.vue';
import { useAttachments } from './useAttachments';
import { useAssistantRun } from './useAssistantRun';
import { api, identity } from '../../services/session';
import { restoreDraft } from './presentation.mjs';
import { Button } from '@/components/ui/button';
import type { ModelList, ModelRecord } from '../models/types';

import type {
  AgentArtifact,
  AgentSelection,
} from '@sap-delivery-workbench/contracts/abap-fsd-agent/types';
const props = withDefaults(
  defineProps<{
    base?: string;
    modelPath?: string;
    selection?: AgentSelection;
    scopeSelection?: AgentSelection;
    stage?: 'design' | 'development';
    storageScope?: string;
    initialRunId?: string | null;
    initialConversationId?: string | null;
    editable?: boolean;
    blocked?: boolean;
    embedded?: boolean;
  }>(),
  { base: '/admin/abap-fsd-agent', modelPath: '/admin/models', editable: true, blocked: false },
);
const emit = defineEmits<{
  artifact: [artifact: AgentArtifact];
  conversation: [id: string];
  busy: [value: boolean];
  openArtifact: [artifact: AgentArtifact];
  filesChanged: [id: string];
}>();
const viewedArtifact = ref<AgentArtifact | null>(null);
function openArtifact(artifact: AgentArtifact) {
  if (props.embedded) {
    emit('openArtifact', artifact);
    return;
  }
  viewedArtifact.value = artifact;
  showDocument.value = true;
  previewId.value = '';
}
const models = ref<ModelRecord[]>([]);
const selectedId = ref('');
const draft = ref('');
const showDocument = ref(false);
const run = useAssistantRun({
  base: props.base,
  storageScope: () =>
    props.stage
      ? (props.storageScope ?? '')
      : `sandbox:${props.scopeSelection?.projectId ?? ''}:${props.scopeSelection?.itemId ?? ''}`,
  selection: () => props.selection ?? props.scopeSelection,
});
const riceType = ref(''),
  action = ref<'dialogue' | 'draft'>('dialogue'),
  uploading = ref(false);

const { busy: sending, statusLabel } = run;
const loading = ref(false);
const workflowBusy = ref(false);
const finalRequested = ref(false);
function workflowArtifact(artifact: AgentArtifact) {
  run.artifact.value = artifact;
  if (!run.artifacts.value.some((a) => a.id === artifact.id)) run.artifacts.value.push(artifact);
}
function prepareFinal() {
  action.value = 'draft';
  finalRequested.value = true;
  draft.value = finalGenerationText(draft.value);
  void send();
}
watch(sending, (value) => {
  if (!value) emit('conversation', run.conversationId.value);
});
watch(run.artifact, (a) => {
  if (a && !loading.value) openArtifact(a);
});
const error = ref('');
const notice = computed(
  () =>
    error.value ||
    attachmentError.value ||
    (run.messages.value.some((message) => message.error === run.error.value)
      ? ''
      : run.error.value),
);
const selected = computed(() => models.value.find((model) => model.id === selectedId.value));
const controller = new AbortController();
const composer = ref<HTMLElement | null>(null);
const previewOpen = computed(
  () => !!activeAttachment.value || (showDocument.value && !!viewedArtifact.value),
);
const compact = useMediaQuery('(max-width: 900px)');
const {
  attachments,
  preparing,
  updateFile,
  selectedId: previewId,
  activeAttachment,
  attachmentError,
  addFiles,
  removeFile,
} = useAttachments();
watch(
  () => sending.value || uploading.value || loading.value || preparing.value || workflowBusy.value,
  (value) => emit('busy', value),
);
const { open, onChange } = useFileDialog({ multiple: true, reset: true });
onChange((files) => {
  void addFiles(files);
});
const { isOverDropZone } = useDropZone(composer, {
  onDrop: () => {},
});
async function uploadFiles() {
  if (uploading.value || preparing.value || sending.value || !props.editable || props.blocked)
    return;
  uploading.value = true;
  error.value = '';
  try {
    const id = await run.ensureConversation(props.selection ?? props.scopeSelection ?? {});
    for (const a of attachments.value.filter((a) => !a.remoteId)) {
      updateFile(a.id, { state: 'uploading', note: '上传与处理…' });
      const data = new FormData();
      data.append('file', a.file);
      try {
        const r = await api<{
          id: string;
          state: string;
          extraction: { warnings: string[]; coverage?: { characters: number } };
        }>(props.base + '/conversations/' + id + '/attachments', data, 'POST');
        updateFile(a.id, {
          remoteId: r.id,
          state: r.state,
          note: r.extraction.warnings.join('；'),
        });
      } catch (e) {
        updateFile(a.id, {
          state: 'failed',
          note: e instanceof Error ? e.message : '上传失败，可重试',
        });
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '上传失败';
  } finally {
    uploading.value = false;
    emit('filesChanged', run.conversationId.value);
    if (run.conversationId.value) emit('conversation', run.conversationId.value);
  }
}
async function removeAttachment(id: string) {
  if (sending.value || uploading.value || !props.editable || props.blocked) return;
  const a = attachments.value.find((a) => a.id === id);
  try {
    if (a?.remoteId)
      await api(
        props.base + '/conversations/' + run.conversationId.value + '/attachments/' + a.remoteId,
        {},
        'DELETE',
      );
    removeFile(id);
    emit('filesChanged', run.conversationId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除失败';
  }
}
async function newConversation() {
  if (
    workflowBusy.value ||
    uploading.value ||
    preparing.value ||
    sending.value ||
    loading.value ||
    !props.editable ||
    props.blocked
  )
    return;
  for (const a of attachments.value) removeFile(a.id);
  run.reset();
  finalRequested.value = false;
  viewedArtifact.value = null;
  showDocument.value = false;
  error.value = '';
  if (props.stage) {
    loading.value = true;
    try {
      await run.ensureConversation(props.selection ?? {});
      emit('conversation', run.conversationId.value);
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }
}
async function send() {
  if (sending.value) {
    await run.stop();
    return;
  }
  const model = selected.value;
  if (
    workflowBusy.value ||
    loading.value ||
    !model ||
    !draft.value.trim() ||
    !props.editable ||
    props.blocked
  )
    return;
  if (uploading.value || preparing.value) return;
  if (attachments.value.some((a) => !a.remoteId && a.state !== 'preview_only')) await uploadFiles();
  if (
    attachments.value.some((a) =>
      ['failed', 'local', 'uploading', 'processing'].includes(a.state ?? 'local'),
    )
  ) {
    error.value = '附件尚未就绪，请重试上传或移除失败附件后发送。';
    return;
  }
  const text = draft.value;
  draft.value = '';
  await run.send(model, text, props.selection ?? props.scopeSelection, {
    action: finalRequested.value ? 'draft' : props.stage ? 'auto' : action.value,
    riceType: riceType.value || null,
    attachmentIds: attachments.value
      .filter((a) => a.state === 'ready' && a.remoteId)
      .map((a) => a.remoteId!),
  });
  finalRequested.value = false;
  if (run.status.value === 'failed' && !run.responseText.value)
    draft.value = restoreDraft(draft.value, text);
}
async function loadModels() {
  if (loading.value || (!props.stage && !identity.value?.canManageOrganization)) return;
  loading.value = true;
  error.value = '';
  try {
    const result = await api<ModelList>(props.modelPath, undefined, undefined, {
      signal: controller.signal,
    });
    models.value = result.items;
    if (props.initialRunId) await run.restore(result.items, props.initialRunId);
    else if (props.initialConversationId) run.conversationId.value = props.initialConversationId;
    if (!result.items.some((model) => model.id === selectedId.value)) {
      selectedId.value =
        result.items.find((model) => model.id === result.defaultModel?.id)?.id ??
        result.items[0]?.id ??
        '';
    }
  } catch (cause) {
    if (controller.signal.aborted) return;
    models.value = [];
    selectedId.value = '';
    error.value = cause instanceof Error ? cause.message : '模型列表加载失败。';
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void loadModels();
});
onUnmounted(() => controller.abort());
</script>
<template>
  <section class="assistant-test assistant-elements" :class="{ embedded }" aria-label="AI助手">
    <header v-if="!embedded" class="assistant-header">
      <div class="assistant-title">
        <h1 id="assistant-test-title">{{ stage === 'development' ? '开发助手' : 'FS 助手' }}</h1>
        <span>需求 · 规格 · 核验</span>
      </div>
      <div class="header-actions">
        <Button
          variant="ghost"
          size="sm"
          v-if="!stage"
          :disabled="sending || loading || workflowBusy"
          @click="run.restore(models)"
        >
          恢复上次测试
        </Button>
        <Button
          variant="ghost"
          size="sm"
          v-if="stage && viewedArtifact"
          :disabled="sending || !editable || blocked"
          @click="emit('artifact', viewedArtifact)"
        >
          采用到当前草稿
        </Button>
        <Button
          variant="ghost"
          size="sm"
          v-if="run.artifact.value"
          :aria-pressed="showDocument"
          @click="showDocument = !showDocument"
        >
          <FileText :size="16" />说明书</Button
        ><Button
          variant="ghost"
          size="sm"
          :disabled="sending || preparing || uploading || workflowBusy || !editable || blocked"
          @click="newConversation"
        >
          <Plus :size="17" />新对话
        </Button>
      </div>
    </header>
    <p v-if="!stage && !identity?.canManageOrganization" class="assistant-notice" role="alert">
      此功能仅限企业管理员使用。
    </p>
    <Splitpanes v-else class="assistant-split" :horizontal="compact" :maximize-panes="false">
      <Pane v-if="!compact || !previewOpen" :size="previewOpen ? 55 : 100" :min-size="30">
        <div class="assistant-chat">
          <div v-if="!stage" class="chat-toolbar">
            <div class="mode-switch" aria-label="本次任务">
              <Button
                variant="ghost"
                size="sm"
                :class="{ active: action === 'dialogue' }"
                :aria-pressed="action === 'dialogue'"
                :disabled="sending || preparing || uploading || !editable || blocked"
                @click="action = 'dialogue'"
              >
                <MessageSquare :size="14" />需求讨论</Button
              ><Button
                variant="ghost"
                size="sm"
                :class="{ active: action === 'draft' }"
                :aria-pressed="action === 'draft'"
                :disabled="sending || preparing || uploading || !editable || blocked"
                @click="action = 'draft'"
              >
                <FileText :size="14" />{{ stage === 'development' ? '生成开发内容' : '生成说明书' }}
              </Button>
            </div>
            <label v-if="stage !== 'development'" class="type-picker"
              ><span class="sr-only">功能类型</span
              ><select
                aria-label="功能类型"
                v-model="riceType"
                :disabled="sending || preparing || uploading || !editable || blocked"
              >
                <option value="">自动识别类型</option>
                <option value="R">R · 报表</option>
                <option value="I">I · 接口</option>
                <option value="C">C · 转换</option>
                <option value="E">E · 增强</option>
              </select></label
            >
          </div>
          <WorkflowPanel
            v-if="stage !== 'development'"
            :base="base"
            :conversation-id="run.conversationId.value"
            :busy="sending"
            :readonly="blocked || !editable || loading || preparing || uploading"
            :revision="run.artifact.value?.id"
            @busy="workflowBusy = $event"
            @artifact="workflowArtifact"
            @open="openArtifact"
            @revise="action = 'draft'"
            @generate="prepareFinal"
          />
          <div v-if="!stage" class="task-state" aria-label="任务与版本状态">
            <span>本次运行：{{ statusLabel || '尚未开始' }}</span>
            <span>{{
              run.artifact.value
                ? '最新版本 v' + run.artifact.value.revision + ' 已保存 · 待审阅'
                : '暂无已保存说明书'
            }}</span>
            <Button
              variant="ghost"
              size="sm"
              v-for="a in run.artifacts.value"
              :key="a.id"
              @click="openArtifact(a)"
            >
              打开 v{{ a.revision }}
            </Button>
          </div>
          <ConversationTimeline
            :quiet="!!stage"
            :readonly="blocked || !editable || loading || workflowBusy"
            :base="base"
            :development="stage === 'development'"
            :messages="run.messages.value"
            :busy="sending"
            :status-label="statusLabel"
            :can-retry="run.canRetry.value"
            :generation-note="run.generationNote.value"
            @retry="!blocked && editable && !workflowBusy && run.retry()"
            @suggestion="draft = $event"
            @open-artifact="openArtifact"
          >
            <template #progress>
              <RunSteps :steps="run.steps.value" :reason="run.receipt.value?.plan?.type?.reason" />
            </template>
            <DecisionCard
              v-if="run.decision.value"
              :key="run.decision.value.id"
              :decision="run.decision.value"
              :busy="sending || blocked || !editable || workflowBusy"
              @answer="!blocked && editable && !workflowBusy && run.answer($event)"
            />
          </ConversationTimeline>
          <div class="assistant-bottom">
            <p v-if="notice" class="assistant-notice" role="alert">
              {{ notice }}
            </p>
            <p v-if="!loading && !models.length" class="assistant-notice">
              尚未配置模型。<RouterLink to="/workspace/models">前往大模型配置</RouterLink>
            </p>
            <div ref="composer">
              <p v-if="preparing" class="text-xs text-muted-foreground" role="status">
                正在读取附件…
              </p>
              <ChatComposer
                :quiet="!!stage"
                v-if="!run.decision.value"
                v-model="draft"
                v-model:model-id="selectedId"
                :models="models"
                :busy="sending"
                :loading="loading"
                :blocked="
                  preparing ||
                  workflowBusy ||
                  uploading ||
                  loading ||
                  !!run.decision.value ||
                  !editable ||
                  blocked
                "
                :stopping="run.status.value === 'stopping'"
                :dragging="isOverDropZone"
                @send="send"
                @stop="run.stop"
                @attach="open()"
                @files="addFiles"
              >
                <AttachmentTray
                  :compact="!!stage"
                  v-if="attachments.length"
                  :items="attachments"
                  :busy="preparing || uploading || sending || !editable || blocked"
                  :selected-id="previewId"
                  @preview="previewId = $event"
                  @remove="removeAttachment"
                />
                <div v-if="attachments.length" class="attachment-status">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="preparing || uploading || sending || !editable || blocked"
                    @click="uploadFiles"
                    type="button"
                  >
                    {{ uploading ? '正在处理附件…' : '处理附件' }}</Button
                  ><span v-for="a in attachments" :key="a.id"
                    >{{ a.file.name }} ·
                    {{
                      a.state === 'ready'
                        ? '已就绪'
                        : a.state === 'preview_only'
                          ? '仅预览'
                          : a.state === 'failed'
                            ? '处理失败'
                            : a.state === 'uploading'
                              ? '处理中'
                              : '待处理'
                    }}</span
                  >
                </div>
              </ChatComposer>
            </div>
            <div class="composer-footnote">
              <span>内容由 AI 生成，请结合业务与系统证据核对</span>
              <details v-if="run.receipt.value?.manifest">
                <summary>运行信息</summary>
                <p>编号：{{ run.diagnosticId.value }}</p>
                <p>
                  有效历史 {{ run.receipt.value.manifest.included.length }} 条 · 上下文
                  {{ run.receipt.value.manifest.bytes.toLocaleString() }} 字节
                </p>
                <p>{{ run.receipt.value.warnings?.join(' ') }}</p>
              </details>
            </div>
          </div>
        </div>
      </Pane>
      <Pane v-if="previewOpen" :size="compact ? 100 : 45" :min-size="25"
        ><AttachmentPreview
          v-if="activeAttachment"
          :attachment="activeAttachment"
          @close="previewId = ''" /><SpecificationPanel
          v-else-if="viewedArtifact"
          :artifact="viewedArtifact"
          :base="base"
          @close="showDocument = false"
      /></Pane>
    </Splitpanes>
  </section>
</template>
<style scoped src="./assistant-test.css"></style>
