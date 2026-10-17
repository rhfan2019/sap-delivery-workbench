<script setup lang="ts">
import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactAction,
} from '@/components/ai-elements/artifact';
import { ref, watch } from 'vue';
import { X, FileText } from '@lucide/vue';
import type { LocalAttachment } from './useAttachments';
const props = defineProps<{ attachment: LocalAttachment }>();
defineEmits<{ close: [] }>();
const broken = ref(false);
watch(
  () => props.attachment.id,
  () => (broken.value = false),
);
</script>
<template>
  <Artifact
    class="attachment-preview assistant-elements rounded-none border-0"
    aria-label="附件预览"
    @keydown.esc="$emit('close')"
  >
    <ArtifactHeader>
      <div>
        <ArtifactTitle :title="attachment.file.name">{{ attachment.file.name }}</ArtifactTitle>
        <p>
          {{
            attachment.state === 'ready'
              ? '已处理 · 发送消息时作为业务材料'
              : attachment.state === 'preview_only'
                ? '仅预览 · 不进入模型上下文'
                : '附件预览 · ' + (attachment.note || '等待处理')
          }}
        </p>
      </div>
      <ArtifactAction label="关闭附件预览" @click="$emit('close')">
        <X :size="20" />
      </ArtifactAction>
    </ArtifactHeader>
    <div class="preview-content">
      <img
        v-if="attachment.kind === 'image' && !broken"
        :src="attachment.url"
        :alt="attachment.file.name"
        @error="broken = true"
      />
      <pre v-else-if="attachment.kind === 'text'">{{ attachment.text || '（空文件）' }}</pre>
      <iframe
        v-else-if="attachment.kind === 'pdf'"
        :src="attachment.url"
        :title="attachment.file.name + ' PDF 预览'"
      />
      <div v-else class="preview-unavailable">
        <FileText :size="36" />
        <p>{{ broken ? '无法解码此图片。' : '此格式暂不支持内嵌预览。' }}</p>
        <p>文件仍保留在附件列表中。</p>
      </div>
    </div>
  </Artifact>
</template>
<style scoped>
.attachment-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4);
  border-bottom: 1px solid var(--border);
}
header > div {
  min-width: 0;
}
h2 {
  font-size: var(--font-14);
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
header p {
  font-size: var(--font-12);
  color: var(--text-muted);
  margin: var(--space-1-5) 0 0;
}
button {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  cursor: pointer;
  color: var(--text-muted);
}
button:hover {
  background: var(--neutral-fill-1);
}
button:focus-visible {
  outline: 2px solid var(--focus);
}
.preview-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-5);
}
.preview-content > img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: auto;
}
.preview-content pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--font-14)/1.9 var(--font-mono);
  margin: 0;
  color: var(--primary-hover);
}
.preview-content:has(iframe) {
  padding: 0;
}
.preview-content iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.preview-unavailable {
  text-align: center;
  color: var(--text-muted);
  margin-top: var(--space-16);
  font-size: var(--font-14);
}
</style>
