import { computed, onScopeDispose, ref, shallowRef } from 'vue';

export interface LocalAttachment {
  id: string;
  file: File;
  url: string;
  kind: 'image' | 'text' | 'pdf' | 'file';
  text: string;
  contentHash?: string;
  remoteId?: string;
  state?: string;
  note?: string;
}
const MB = 1024 * 1024;
export function useAttachments() {
  const attachments = shallowRef<LocalAttachment[]>([]);
  const selectedId = ref('');
  const attachmentError = ref('');
  const pendingBatches = ref(0);
  const preparing = computed(() => pendingBatches.value > 0);
  const activeAttachment = computed(() => attachments.value.find((a) => a.id === selectedId.value));
  let disposed = false;
  let queue = Promise.resolve();
  function addFiles(files: File[] | FileList | null) {
    if (!files) return;
    const batch = Array.from(files);
    pendingBatches.value++;
    queue = queue
      .then(async () => {
        attachmentError.value = '';
        for (const file of batch) {
          if (disposed) return;
          if (
            attachments.value.length >= 10 ||
            file.size > 10 * MB ||
            attachments.value.reduce((n, a) => n + a.file.size, 0) + file.size > 50 * MB
          ) {
            attachmentError.value = '最多添加 10 个附件，单个不超过 10 MB，总计不超过 50 MB。';
            continue;
          }
          const contentHash = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
          )
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('');
          if (
            attachments.value.some(
              (a) => a.file.name === file.name && a.contentHash === contentHash,
            )
          )
            continue;
          let kind: LocalAttachment['kind'] = 'file',
            text = '',
            type = 'application/octet-stream';
          // Only passive raster image formats enter an image element; HTML/SVG are never embedded.
          if (/^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(file.type)) {
            kind = 'image';
            type = file.type;
          } else if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
            if ((await file.slice(0, 5).text()) === '%PDF-') {
              kind = 'pdf';
              type = 'application/pdf';
            }
          } else if (
            /\.(txt|md|csv|json|xml|log|abap|yaml|yml)$/i.test(file.name) ||
            file.type.startsWith('text/')
          ) {
            kind = 'text';
            text = await file.slice(0, MB).text();
            if (file.size > MB) text += '\n\n[预览仅显示前 1 MB，原文件未改变]';
          }
          if (disposed) return;
          attachments.value = [
            ...attachments.value,
            {
              id: crypto.randomUUID(),
              file,
              contentHash,
              kind,
              text,
              url: URL.createObjectURL(new Blob([file], { type })),
            },
          ];
        }
      })
      .catch(() => {
        if (!disposed) attachmentError.value = '无法读取该文件，请重新选择。';
      })
      .finally(() => {
        pendingBatches.value--;
      });
    return queue;
  }
  function updateFile(id: string, patch: Partial<LocalAttachment>) {
    attachments.value = attachments.value.map((a) => (a.id === id ? { ...a, ...patch } : a));
  }
  function removeFile(id: string) {
    const item = attachments.value.find((a) => a.id === id);
    if (item) URL.revokeObjectURL(item.url);
    attachments.value = attachments.value.filter((a) => a.id !== id);
    if (selectedId.value === id) selectedId.value = '';
  }
  function pasteFiles(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  }
  onScopeDispose(() => {
    disposed = true;
    attachments.value.forEach((a) => URL.revokeObjectURL(a.url));
  });
  return {
    attachments,
    preparing,
    updateFile,
    selectedId,
    activeAttachment,
    attachmentError,
    addFiles,
    removeFile,
    pasteFiles,
  };
}
