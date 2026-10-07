<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../services/session';
const props = defineProps<{ path: string; readOnly: boolean }>();
const files = ref<{ id: string; name: string; size: number }[]>([]);
const events = ref<{ id: string; action: string; actorName: string; createdAt: string }[]>([]);
const busy = ref(false);
const error = ref('');
const labels: Record<string, string> = {
  created: '创建开发项',
  updated: '更新概览字段',
  fs_saved: '保存 FS 草稿',
  fs_version: '保存 FS 版本',
  fs_submitted: '提交 FS 开发基线',
  file_added: '上传附件',
};
async function load() {
  try {
    [files.value, events.value] = await Promise.all([
      api<typeof files.value>(props.path + '/files'),
      api<typeof events.value>(props.path + '/events'),
    ]);
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
    error.value = '单文件须为 1 字节至 5 MiB。';
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
defineExpose({ busy, load });
onMounted(load);
</script>
<template>
  <section class="overview-extras">
    <h3>关联附件 <small>单文件 ≤ 5 MiB</small></h3>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <label v-if="!readOnly" class="upload-control"
      >{{ busy ? '上传中…' : '上传需求说明 / 参考资料'
      }}<input type="file" aria-label="上传附件" :disabled="busy" @change="upload"
    /></label>
    <ul class="file-list">
      <li v-for="f in files" :key="f.id">
        <a :href="'/api' + path + '/files/' + f.id">{{ f.name }}</a
        ><small>{{ Math.ceil(f.size / 1024) }} KB</small>
      </li>
    </ul>
    <p v-if="!files.length" class="delivery-hint">暂无附件</p>
    <h3>最近活动</h3>
    <ol class="activity-list">
      <li v-for="e in events.slice(0, 8)" :key="e.id">
        <span>{{ e.actorName }} · {{ labels[e.action] ?? e.action }}</span
        ><time>{{ new Date(e.createdAt).toLocaleString() }}</time>
      </li>
    </ol>
  </section>
</template>
