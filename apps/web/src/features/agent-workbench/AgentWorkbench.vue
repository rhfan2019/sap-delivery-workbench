<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useDropZone, useFileDialog, useMediaQuery } from '@vueuse/core';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import DecisionCard from './DecisionCard.vue';
import TestDataCard from './TestDataCard.vue';
import TestSystemLogin from './TestSystemLogin.vue';
import SapSystemSelect from './SapSystemSelect.vue';
import RunSteps from './RunSteps.vue';
import ChatComposer from './ChatComposer.vue';
import ConversationTimeline from './ConversationTimeline.vue';
import AttachmentTray from './AttachmentTray.vue';
import AttachmentPreview from './AttachmentPreview.vue';
import { useAttachments } from './useAttachments';
import type { useAgentSession } from './useAgentSession';
import { api } from '../../services/session';
import { restoreDraft } from './presentation.mjs';
import { useShortcut } from '../../services/shortcuts';
import { Button } from '@/components/ui/button';
import type { ModelRecord } from '../models/types';
import type { AgentArtifactRef } from '@sap-delivery-workbench/contracts/agent-core/types';

const props = withDefaults(
  defineProps<{
    base: string;
    session: ReturnType<typeof useAgentSession>;
    modelName?: string | null;
    editable?: boolean;
    blocked?: boolean;
    development?: boolean;
    // Show the user's QAS login (contract 3.4) for agents that find or create test data.
    testSystem?: boolean;
  }>(),
  { editable: true, blocked: false, modelName: null, development: false, testSystem: false },
);
const emit = defineEmits<{
  busy: [value: boolean];
  openArtifact: [artifact: AgentArtifactRef];
  filesChanged: [];
}>();
const run = props.session;
// The agent always uses the organization's default model; the selector only shows it.
const models = computed(() =>
  props.modelName ? [{ id: 'default', name: props.modelName } as unknown as ModelRecord] : [],
);
const modelId = ref('default');
const draft = ref('');
const uploading = ref(false);
const error = ref('');
const composer = ref<HTMLElement | null>(null);
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
const sending = run.busy;
const notice = computed(() => error.value || attachmentError.value || run.error.value);
watch(
  () => sending.value || uploading.value || preparing.value,
  (value) => emit('busy', value),
);
watch(run.quoted, async (q) => {
  if (!q) return;
  draft.value = draft.value.trim() ? `${draft.value.trimEnd()}\n\n${q.text}` : q.text;
  await nextTick();
  const input = composer.value?.querySelector('textarea');
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
});
const { open, onChange } = useFileDialog({ multiple: true, reset: true });
onChange((files) => void addFiles(files));
const { isOverDropZone } = useDropZone(composer, { onDrop: () => {} });
// R puts the cursor in the composer, U opens the file picker (DESIGN.md 6.3).
useShortcut('R', () => composer.value?.querySelector('textarea')?.focus());
useShortcut('U', () => {
  if (props.editable && !props.blocked && !sending.value) open();
});

function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function uploadFiles() {
  if (uploading.value || preparing.value || sending.value || !props.editable || props.blocked)
    return;
  uploading.value = true;
  error.value = '';
  try {
    if (!run.sessionId.value) await run.create();
    for (const a of attachments.value.filter((a) => !a.remoteId)) {
      updateFile(a.id, { state: 'uploading', note: '上传与解析…' });
      try {
        const r = await api<{ id: string; parseState: string; warnings: string[] }>(
          `${props.base}/sessions/${run.sessionId.value}/attachments`,
          { fileName: a.file.name, contentBase64: await base64(a.file) },
          'POST',
        );
        updateFile(a.id, { remoteId: r.id, state: r.parseState, note: r.warnings.join('；') });
      } catch (e) {
        updateFile(a.id, { state: 'failed', note: e instanceof Error ? e.message : '上传失败' });
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '上传失败';
  } finally {
    uploading.value = false;
    emit('filesChanged');
  }
}

async function send() {
  if (sending.value) return run.stop();
  if (!draft.value.trim() || !props.editable || props.blocked || !models.value.length) return;
  if (uploading.value || preparing.value) return;
  if (attachments.value.some((a) => !a.remoteId)) await uploadFiles();
  if (attachments.value.some((a) => a.state === 'failed' || a.state === 'uploading')) {
    error.value = '附件处理失败，请移除后重新发送。';
    return;
  }
  const text = draft.value;
  draft.value = '';
  error.value = '';
  try {
    await run.send(text);
    for (const a of attachments.value) removeFile(a.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '发送失败';
    draft.value = restoreDraft(draft.value, text);
  }
}

async function answer(values: Record<string, string>) {
  if (props.blocked || !props.editable) return;
  try {
    await run.answer(values);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  }
}
async function authorize(decision: 'approve' | 'reject', note: string) {
  if (props.blocked || !props.editable) return;
  try {
    await run.authorize(decision, note);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  }
}
const previewOpen = computed(() => !!activeAttachment.value);
// A conversation with nothing in it opens on the start page: a greeting and the composer in
// the middle, suggestions below (DESIGN.md 6).
const empty = computed(() => !run.messages.value.length && !sending.value);
const suggestions = computed(() =>
  props.development
    ? [
        ['梳理需求并出开发方案', '请分析这个开发项的资料，先写开发方案，并列出需要我确认的问题。'],
        ['直接写方案和代码', '需求已经清楚，请查询 SAP 后直接写开发方案和代码。'],
      ]
    : [
        ['梳理需求与待确认问题', '请分析这个开发项的需求，先找出需要客户确认的问题。'],
        ['直接起草 FSD 初稿', '需求已经比较清楚，请直接查询 SAP 并起草 FSD 初稿。'],
      ],
);
</script>
<template>
  <section class="assistant-test assistant-elements embedded" aria-label="AI助手">
    <Splitpanes class="assistant-split" :horizontal="compact" :maximize-panes="false">
      <Pane v-if="!compact || !previewOpen" :size="previewOpen ? 55 : 100" :min-size="30">
        <div class="assistant-chat" :class="{ 'is-start': empty }">
          <div v-if="empty" class="start-greeting">
            <h1>{{ development ? '今天要开发什么？' : '今天要梳理哪个需求？' }}</h1>
            <p>
              {{
                development
                  ? '描述需求、上传 FSD 或资料，助手会查询 SAP、提出必要问题，写出开发方案和代码。'
                  : '描述需求或上传资料，助手会查询 SAP、提出必要问题并编写 FSD。'
              }}
            </p>
          </div>
          <ConversationTimeline
            v-else
            quiet
            :development="development"
            :readonly="blocked || !editable"
            :base="base"
            :messages="run.messages.value"
            :busy="sending"
            @suggestion="draft = $event"
            @open-artifact="emit('openArtifact', $event)"
          >
            <template #progress="{ message }">
              <RunSteps
                live
                :steps="run.steps.value"
                :note="run.liveNote.value"
                :started-at="message.createdAt"
                :clock-offset-ms="message.clockOffsetMs"
              />
            </template>
            <DecisionCard
              v-if="run.decision.value && !sending"
              :key="run.decision.value.id"
              :decision="run.decision.value"
              :busy="sending || blocked || !editable"
              @answer="answer"
            />
            <TestDataCard
              v-if="run.testData.value && !sending"
              :key="run.testData.value.id"
              :request="run.testData.value"
              :base="base"
              :busy="sending || blocked || !editable"
              @decide="authorize"
            />
          </ConversationTimeline>
          <div class="assistant-bottom">
            <TestSystemLogin v-if="testSystem && editable" compact :base="base" />
            <p v-if="notice" class="assistant-notice" role="alert">{{ notice }}</p>
            <p v-if="!models.length" class="assistant-notice">
              尚未配置组织默认模型。<RouterLink to="/workspace/models">前往大模型配置</RouterLink>
            </p>
            <div ref="composer">
              <p v-if="preparing" class="text-xs text-muted-foreground" role="status">
                正在读取附件…
              </p>
              <ChatComposer
                quiet
                v-model="draft"
                v-model:model-id="modelId"
                :models="models"
                :busy="sending"
                :loading="false"
                :blocked="preparing || uploading || !editable || blocked"
                :stopping="run.status.value === 'stopping'"
                :dragging="isOverDropZone"
                @send="send"
                @stop="run.stop"
                @attach="open()"
                @files="addFiles"
              >
                <template #tools>
                  <SapSystemSelect
                    v-model="run.sapEnvironment.value"
                    :base="base"
                    :disabled="sending || !editable || blocked"
                  />
                </template>
                <AttachmentTray
                  compact
                  v-if="attachments.length"
                  :items="attachments"
                  :busy="preparing || uploading || sending || !editable || blocked"
                  :selected-id="previewId"
                  @preview="previewId = $event"
                  @remove="removeFile"
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
                          ? '仅预览，不发给模型'
                          : a.state === 'failed'
                            ? '处理失败' + (a.note ? '：' + a.note : '')
                            : a.state === 'uploading'
                              ? '处理中'
                              : '发送时上传'
                    }}</span
                  >
                </div>
              </ChatComposer>
            </div>
            <div v-if="empty" class="start-suggestions">
              <button
                v-for="[label, text] in suggestions"
                :key="label"
                type="button"
                :disabled="blocked || !editable"
                @click="draft = text"
              >
                {{ label }}
              </button>
            </div>
            <div v-else class="composer-footnote">
              <span>内容由 AI 生成，请结合业务与系统证据核对</span>
            </div>
          </div>
        </div>
      </Pane>
      <Pane v-if="previewOpen" :size="compact ? 100 : 45" :min-size="25"
        ><AttachmentPreview
          v-if="activeAttachment"
          :attachment="activeAttachment"
          @close="previewId = ''"
      /></Pane>
    </Splitpanes>
  </section>
</template>
<style scoped src="./assistant-test.css"></style>
