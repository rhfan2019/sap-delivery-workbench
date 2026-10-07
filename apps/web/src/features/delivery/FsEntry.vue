<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import FsEditor from './FsEditor.vue';
import { api } from '../../services/session';
import type { Item } from './model';
import type { Snapshot } from '../../../../../packages/contracts/fs-workspace/generated/types';
const props = defineProps<{ path: string; item: Item; writable: boolean }>();
const emit = defineEmits<{ updated: [] }>();
const editor = ref<InstanceType<typeof FsEditor> | null>(null),
  snapshot = ref<Snapshot | null>(null),
  error = ref(''),
  loading = ref(true);
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
onMounted(async () => {
  try {
    snapshot.value = (
      await api<{ data: Snapshot }>(props.path + '/fs-workspace', undefined, undefined, {
        signal: controller.signal,
      })
    ).data;
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
defineExpose({
  dirty: computed(() => editor.value?.dirty ?? false),
  busy: computed(() => editor.value?.busy ?? false),
});
</script>
<template>
  <section>
    <p v-if="loading" role="status">正在检查 FS 工作区…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <template v-else>
      <div class="delivery-empty">
        <h3>{{ snapshot?.workspace ? 'FS 智能工作区已启用' : '进入 FS 智能工作区' }}</h3>
        <p>文档、讨论、版本和确认在项目权限范围内保存。</p>
        <RouterLink :to="path + '/fs/workspace'">{{
          snapshot?.workspace ? '继续编写' : '查看并启用工作区'
        }}</RouterLink>
      </div>
      <FsEditor
        v-if="!snapshot?.workspace"
        ref="editor"
        :path="path"
        :item="item"
        :writable="writable"
        @updated="emit('updated')"
      />
    </template>
  </section>
</template>
