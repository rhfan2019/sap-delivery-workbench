<script setup lang="ts">
import type { FsExport } from '../api';
defineProps<{
  result: FsExport | null;
  revision: string;
  busy: boolean;
  enabled: boolean;
  base: string;
}>();
defineEmits<{ create: [format: 'docx' | 'pdf']; refresh: [] }>();
const states = {
  queued: '文件已排队',
  running: '文件正在生成',
  ready: '文件已生成并通过内容核对',
  failed: '文件生成失败',
};
const errors: Record<string, string> = {
  FONT_NOT_CONFIGURED: '请管理员配置中文字体。',
  FONT_VERSION_CHANGED: '字体配置已改变，请重新创建导出。',
  BROWSER_NOT_CONFIGURED: '请管理员配置 PDF 渲染浏览器。',
  EXPORT_AUTHORITY_CHANGED: '审批或发布状态已变化，请重新导出。',
  OUTPUT_VERIFICATION_FAILED: '生成文件未通过内容核对，请联系管理员处理。',
};
</script>
<template>
  <details class="fs-attachments">
    <summary>导出固定版本</summary>
    <p>导出固定当前草稿版本，后续编辑不会改变已排队文件。未批准内容保留讨论稿标识。</p>
    <div class="fs-actions">
      <button :disabled="busy || !enabled" @click="$emit('create', 'docx')">导出 Word</button>
      <button :disabled="busy || !enabled" @click="$emit('create', 'pdf')">导出 PDF</button>
    </div>
    <template v-if="result">
      <p>本次文件：修订 {{ revision }} · {{ result.format === 'docx' ? 'Word' : 'PDF' }}</p>
      <p role="status">{{ states[result.status] }}</p>
      <p v-if="result.error_code" role="alert">
        {{ errors[result.error_code] ?? '渲染未完成，请检查服务端任务状态。' }}
      </p>
      <button :disabled="busy" @click="$emit('refresh')">刷新导出状态</button>
      <a
        v-if="result.status === 'ready'"
        :href="'/api' + base + '/exports/' + result.id + '/download'"
        download
        >下载 {{ result.format === 'docx' ? 'Word' : 'PDF' }}</a
      >
    </template>
  </details>
</template>
