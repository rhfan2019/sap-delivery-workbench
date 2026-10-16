<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
const { open, onChange } = useFileDialog({ multiple: true, reset: true });
onChange((files) => void addFiles(files));
const { isOverDropZone } = useDropZone(composer, { onDrop: () => {} });

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
</script>
<template>
  <section class="assistant-test assistant-elements embedded" aria-label="AI助手">
    <Splitpanes class="assistant-split" :horizontal="compact" :maximize-panes="false">
      <Pane v-if="!compact || !previewOpen" :size="previewOpen ? 55 : 100" :min-size="30">
        <div class="assistant-chat">
          <ConversationTimeline
            quiet
            :development="development"
            :readonly="blocked || !editable"
            :base="base"
            :messages="run.messages.value"
            :busy="sending"
            :status-label="run.statusLabel.value"
            :generation-note="run.generationNote.value"
            @suggestion="draft = $event"
            @open-artifact="emit('openArtifact', $event)"
          >
            <template #progress>
              <RunSteps :steps="run.steps.value" />
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
            <div class="composer-footnote">
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
