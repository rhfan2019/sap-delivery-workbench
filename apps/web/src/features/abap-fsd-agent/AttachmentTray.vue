<script setup lang="ts">
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
} from '@/components/ai-elements/attachments';
import type { LocalAttachment } from './useAttachments';
defineProps<{ items: LocalAttachment[]; selectedId: string; busy?: boolean; compact?: boolean }>();
defineEmits<{ preview: [id: string]; remove: [id: string] }>();
</script>
<template>
  <Attachments variant="inline" class="flex-wrap gap-2" aria-label="已添加附件">
    <Attachment
      v-for="item in items"
      :key="item.id"
      :data="{
        id: item.id,
        type: 'file',
        filename: item.file.name,
        url: item.url,
        mediaType: item.kind === 'image' ? item.file.type : 'application/octet-stream',
      }"
      class="h-auto min-h-10 max-w-full py-1"
      :class="{ 'ring-2 ring-primary': selectedId === item.id }"
      @remove="$emit('remove', item.id)"
    >
      <button
        type="button"
        class="flex min-w-0 items-center gap-2 text-left"
        :aria-label="'预览 ' + item.file.name"
        @click="$emit('preview', item.id)"
      >
        <AttachmentPreview /><span class="max-w-48 truncate">{{ item.file.name }}</span>
      </button>
      <AttachmentRemove
        :label="'删除 ' + item.file.name"
        :disabled="busy"
        class="elements-attachment-remove"
      />
    </Attachment>
  </Attachments>
</template>
