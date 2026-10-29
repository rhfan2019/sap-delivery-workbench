<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Paperclip, Trash2, Upload } from '@lucide/vue';
import { askConfirmation } from '../../services/confirmation';
import { api } from '../../services/session';
import { columnLabel, type FieldDef } from './model';

// Drawer sections after the fields: attachments and recent activity.
const props = defineProps<{ path: string; readOnly: boolean; fields: FieldDef[] }>();
const files = ref<{ id: string; name: string; size: number; authorName: string }[]>([]);
const events = ref<
  {
    id: string;
    action: string;
    actorName: string;
    createdAt: string;
    changes: Record<string, unknown>;
  }[]
>([]);
const busy = ref(false);
const error = ref('');
const labels: Record<string, string> = {
  created: '创建了开发项',
  updated: '修改了',
  deleted: '删除了开发项',
  copied: '复制自',
  imported: '从 Excel 导入',
  test_copied: '创建测试副本',
  file_added: '上传了附件',
  file_removed: '删除了附件',
};
function describe(e: (typeof events.value)[number]) {
  if (e.action === 'updated') {
    const names = Object.keys(e.changes)
      .map((key) => props.fields.find((f) => f.key === key))
      .filter(Boolean)
      .map((f) => columnLabel(f!));
    const via = e.changes.import ? '（Excel 导入）' : e.changes.batch ? '（批量修改）' : '';
    return names.length ? `修改了 ${names.join('、')}${via}` : '修改了字段' + via;
  }
  if (e.action === 'copied') return `复制自 ${e.changes.sourceCode ?? ''}`;
  if (e.action === 'file_added') return `上传了附件 ${e.changes.name ?? ''}`;
  if (e.action === 'file_removed') return `删除了附件 ${e.changes.name ?? ''}`;
  return labels[e.action] ?? e.action;
}
const time = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false }).replace(/:\d{2}$/, '');
async function load() {
  error.value = '';
  try {
    files.value = await api<typeof files.value>(props.path + '/files');
    events.value = await api<typeof events.value>(props.path + '/events');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  error.value = '';
  if (!file.size || file.size > 5242880) {
    error.value = '单个文件须为 1 字节至 5 MiB。';
    input.value = '';
    return;
  }
  busy.value = true;
  try {
    const content = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]!);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsDataURL(file);
    });
    await api(props.path + '/files', { name: file.name, content });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    input.value = '';
  }
}
async function remove(f: (typeof files.value)[number]) {
  if (!(await askConfirmation(`删除附件“${f.name}”？删除后不能恢复。`))) return;
  busy.value = true;
  error.value = '';
  try {
    await api(props.path + '/files/' + f.id, {}, 'DELETE');
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const size = (n: number) =>
  n < 1024 * 1024 ? Math.ceil(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
defineExpose({ busy, load });
onMounted(load);
watch(() => props.path, load);
</script>

<template>
  <section class="drawer-section">
    <header class="section-title">
      <h3>关联附件</h3>
      <label v-if="!readOnly" class="text-button upload-control"
        ><Upload :size="14" />{{ busy ? '上传中…' : '上传附件'
        }}<input
          type="file"
          class="sr-only"
          aria-label="上传附件"
          :disabled="busy"
          @change="upload"
      /></label>
    </header>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <ul v-if="files.length" class="file-list">
      <li v-for="f in files" :key="f.id">
        <Paperclip :size="14" /><a :href="'/api' + path + '/files/' + f.id">{{ f.name }}</a
        ><small>{{ size(f.size) }} · {{ f.authorName }}</small
        ><button
          v-if="!readOnly"
          type="button"
          class="icon-button file-remove"
          :aria-label="'删除附件 ' + f.name"
          :title="'删除附件 ' + f.name"
          :disabled="busy"
          @click="remove(f)"
        >
          <Trash2 :size="14" />
        </button>
      </li>
    </ul>
    <p v-else class="empty-value">暂无附件，单个文件不超过 5 MB。</p>
  </section>
  <section class="drawer-section">
    <header class="section-title"><h3>最近活动</h3></header>
    <ol v-if="events.length" class="activity-list">
      <li v-for="e in events" :key="e.id">
        <span>{{ e.actorName }} {{ describe(e) }}</span
        ><time>{{ time(e.createdAt) }}</time>
      </li>
    </ol>
    <p v-else class="empty-value">暂无活动记录。</p>
  </section>
</template>
<style scoped>
.file-remove {
  width: 26px;
  height: 26px;
  margin-left: auto;
}
</style>
