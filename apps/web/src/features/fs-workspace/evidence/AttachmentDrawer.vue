<script setup lang="ts">
import { ref } from 'vue';
import type { Attachment } from '../api';
const props = defineProps<{
  attachments: Attachment[];
  editable: boolean;
  busy: boolean;
  base: string;
  upload: (file: File) => Promise<boolean>;
}>();
defineEmits<{ parse: [attachment: Attachment] }>();
const selected = ref<File | null>(null),
  fileInput = ref<HTMLInputElement | null>(null);
const scanLabels = {
  quarantined: '待安全扫描',
  clean: '安全扫描通过',
  rejected: '安全扫描拒绝',
  failed: '安全扫描未完成',
};
function choose(event: Event) {
  selected.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}
async function submit() {
  const file = selected.value;
  if (file && (await props.upload(file))) {
    selected.value = null;
    if (fileInput.value) fileInput.value.value = '';
  }
}
</script>
<template>
  <details class="fs-attachments">
    <summary>附件与来源</summary>
    <p class="fs-muted">
      支持 PDF、PNG、JPEG，单个不超过 5 MiB。上传后需要安全扫描；扫描失败或未配置时不会读取材料。
    </p>
    <form v-if="editable" @submit.prevent="submit">
      <label for="fs-attachment">选择业务材料</label>
      <input
        id="fs-attachment"
        ref="fileInput"
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        :disabled="busy"
        @change="choose"
      />
      <button :disabled="busy || !selected">上传材料</button>
    </form>
    <p v-if="!attachments.length">暂无业务材料。</p>
    <ul>
      <li v-for="attachment in attachments" :key="attachment.id">
        <strong>{{ attachment.name }}</strong> · {{ Math.ceil(attachment.size_bytes / 1024) }} KiB
        <p>{{ scanLabels[attachment.scan_state] }}</p>
        <p v-if="attachment.parse_result">
          解析：{{
            attachment.parse_result.state === 'complete'
              ? '完整'
              : attachment.parse_result.state === 'partial'
                ? '部分可读'
                : '失败'
          }}，未读区域 {{ attachment.parse_result.unread_regions.length }} 处
        </p>
        <a
          v-if="attachment.scan_state === 'clean'"
          :href="'/api' + base + '/attachments/' + attachment.id + '/source'"
          >下载原文件</a
        >
        <button
          v-if="editable && attachment.scan_state !== 'rejected'"
          :disabled="busy"
          @click="$emit('parse', attachment)"
        >
          扫描并解析
        </button>
      </li>
    </ul>
  </details>
</template>
